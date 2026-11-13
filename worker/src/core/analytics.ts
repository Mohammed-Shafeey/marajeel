import type { GroupSettings } from './settings.ts';
import { applyJudgeRating, defaultRating, marginWeight, toDisplay, update, winProbability, type Rating } from './trueskill.ts';

export type Side = 'A' | 'B';

export interface ParticipantRecord {
  playerId: string;
  side: Side;
  position: number;
}

export interface GameRecord {
  id: string;
  sessionId: string;
  playedAt: string; // ISO UTC
  createdAt: string;
  scoreA: number;
  scoreB: number;
  mvpPlayerId: string;
  participants: ParticipantRecord[];
  /** Judges' 1–5 star ratings of individual players in this game (optional). */
  judgeRatings?: { playerId: string; stars: number }[];
}

export interface RatingPoint {
  gameId: string;
  playedAt: string;
  rating: number;
}

export interface PositionStats {
  position: number;
  mu: number;
  sigma: number;
  rating: number;
  games: number;
  wins: number;
  established: boolean;
}

export interface PlayerStats {
  playerId: string;
  mu: number;
  sigma: number;
  rating: number;
  provisional: boolean;
  games: number;
  wins: number;
  losses: number;
  winPct: number;
  mvps: number;
  currentStreak: number;
  longestStreak: number;
  bestPosition: number | null;
  positions: PositionStats[];
  ratingHistory: RatingPoint[];
  gamesBySession: Record<string, number>;
  ratingDelta: number;
  lastPlayedAt: string | null;
  /** Number of judge star ratings received (all time) and their average, or null if none. */
  judgeRatings: number;
  judgeAvg: number | null;
}

export interface PairStats {
  /** a < b by string order. */
  a: string;
  b: string;
  together: { games: number; wins: number; chemistry: number; enough: boolean };
  against: { games: number; aWins: number; bWins: number };
}

export interface AnalyticsResult {
  players: PlayerStats[];
  pairs: PairStats[];
  sessionMvps: Record<string, string>;
  gameCount: number;
  from: string | null;
  to: string | null;
}

/** Shrinkage constant for chemistry: chem = mean residual · n/(n+k). */
export const CHEMISTRY_K = 5;

export const chronological = (games: readonly GameRecord[]) =>
  games.slice().sort((x, y) => cmp(x.playedAt, y.playedAt) || cmp(x.createdAt, y.createdAt) || cmp(x.id, y.id));

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const time = (iso: string) => Date.parse(iso);

export const orderPair = (x: string, y: string): [string, string] => (x <= y ? [x, y] : [y, x]);

/** Shrunk chemistry for a list of residuals (exposed for tests/documentation). */
export const shrinkChemistry = (residuals: readonly number[]) =>
  residuals.length === 0 ? 0 : (residuals.reduce((s, r) => s + r, 0) / residuals.length) * (residuals.length / (residuals.length + CHEMISTRY_K));

interface PosAcc {
  rating: Rating;
  games: number;
  wins: number;
}

class Acc {
  overall: Rating = defaultRating();
  positions = new Map<number, PosAcc>();
  games = 0;
  wins = 0;
  losses = 0;
  mvps = 0;
  streak = 0;
  longest = 0;
  totalGames = 0;
  ratingAtWindowStart: number | null = null;
  lastPlayedAt: string | null = null;
  bySession: Record<string, number> = {};
  history: RatingPoint[] = [];
  judgeCount = 0;
  judgeSum = 0;
  pos(p: number): PosAcc {
    let x = this.positions.get(p);
    if (!x) this.positions.set(p, (x = { rating: defaultRating(), games: 0, wins: 0 }));
    return x;
  }
}

interface PairAcc {
  togetherGames: number;
  togetherWins: number;
  againstGames: number;
  aWins: number;
  bWins: number;
  residualSum: number;
}

/**
 * Replays the full game history in chronological order and derives every statistic.
 * Pure and deterministic: same games in → same numbers out. Never updated incrementally.
 *
 * Ratings always use the full history. Counting stats (games, wins, MVPs, streaks, chemistry,
 * head-to-head, rating delta) only include games with from ≤ playedAt < to.
 */
export function compute(
  playerIds: Iterable<string>,
  games: readonly GameRecord[],
  settings: GroupSettings,
  from: string | null = null,
  to: string | null = null,
): AnalyticsResult {
  const acc = new Map<string, Acc>();
  const get = (id: string) => {
    let a = acc.get(id);
    if (!a) acc.set(id, (a = new Acc()));
    return a;
  };
  for (const id of playerIds) get(id);

  const pairs = new Map<string, PairAcc>();
  const pair = (x: string, y: string) => {
    const key = orderPair(x, y).join('|');
    let p = pairs.get(key);
    if (!p) pairs.set(key, (p = { togetherGames: 0, togetherWins: 0, againstGames: 0, aWins: 0, bWins: 0, residualSum: 0 }));
    return p;
  };

  const fromT = from ? time(from) : null;
  const toT = to ? time(to) : null;
  const sessionMvpCounts = new Map<string, Map<string, number>>();
  let windowGames = 0;

  const addTeammates = (side: ParticipantRecord[], residual: number, won: boolean) => {
    for (let i = 0; i < side.length; i++)
      for (let j = i + 1; j < side.length; j++) {
        const pr = pair(side[i].playerId, side[j].playerId);
        pr.togetherGames++;
        if (won) pr.togetherWins++;
        pr.residualSum += residual;
      }
  };

  for (const g of chronological(games)) {
    const t = time(g.playedAt);
    const inWindow = (fromT === null || t >= fromT) && (toT === null || t < toT);
    const sideA = g.participants.filter((p) => p.side === 'A');
    const sideB = g.participants.filter((p) => p.side === 'B');
    if (sideA.length === 0 || sideB.length === 0) continue;

    // Pre-game expectation from overall ratings.
    const pA = winProbability(sideA.map((p) => get(p.playerId).overall), sideB.map((p) => get(p.playerId).overall));
    const aWon = g.scoreA > g.scoreB;

    if (inWindow) {
      windowGames++;
      for (const p of g.participants) {
        const a = get(p.playerId);
        a.ratingAtWindowStart ??= toDisplay(a.overall);
        const won = (p.side === 'A') === aWon;
        a.games++;
        if (won) {
          a.wins++;
          a.streak++;
          a.longest = Math.max(a.longest, a.streak);
        } else {
          a.losses++;
          a.streak = 0;
        }
        a.bySession[g.sessionId] = (a.bySession[g.sessionId] ?? 0) + 1;
        a.lastPlayedAt = g.playedAt;
      }
      if (g.participants.some((p) => p.playerId === g.mvpPlayerId)) {
        get(g.mvpPlayerId).mvps++;
        let counts = sessionMvpCounts.get(g.sessionId);
        if (!counts) sessionMvpCounts.set(g.sessionId, (counts = new Map()));
        counts.set(g.mvpPlayerId, (counts.get(g.mvpPlayerId) ?? 0) + 1);
      }

      // Chemistry residuals: actual (1/0) − expected win probability, per teammate pair.
      addTeammates(sideA, (aWon ? 1 : 0) - pA, aWon);
      addTeammates(sideB, (aWon ? 0 : 1) - (1 - pA), !aWon);

      // Head-to-head on opposite sides.
      for (const x of sideA)
        for (const y of sideB) {
          const pr = pair(x.playerId, y.playerId);
          pr.againstGames++;
          const winnerId = aWon ? x.playerId : y.playerId;
          if (orderPair(x.playerId, y.playerId)[0] === winnerId) pr.aWins++;
          else pr.bWins++;
        }
    }

    const weight = marginWeight(Math.abs(g.scoreA - g.scoreB));
    const winners = aWon ? sideA : sideB;
    const losers = aWon ? sideB : sideA;

    // Overall track.
    const o = update(winners.map((p) => get(p.playerId).overall), losers.map((p) => get(p.playerId).overall), weight);
    winners.forEach((p, i) => (get(p.playerId).overall = o.winners[i]));
    losers.forEach((p, i) => (get(p.playerId).overall = o.losers[i]));

    // Per-position tracks: each player's track at the position they played in this game.
    const ps = update(winners.map((p) => get(p.playerId).pos(p.position).rating), losers.map((p) => get(p.playerId).pos(p.position).rating), weight);
    winners.forEach((p, i) => {
      const x = get(p.playerId).pos(p.position);
      x.rating = ps.winners[i];
      x.games++;
      x.wins++;
    });
    losers.forEach((p, i) => {
      const x = get(p.playerId).pos(p.position);
      x.rating = ps.losers[i];
      x.games++;
    });

    // Judge ratings nudge both the overall and the position track for the position played.
    for (const jr of g.judgeRatings ?? []) {
      const part = g.participants.find((p) => p.playerId === jr.playerId);
      if (!part) continue; // lineup was edited after rating: ignore
      const a = get(jr.playerId);
      a.overall = applyJudgeRating(a.overall, jr.stars);
      const x = a.pos(part.position);
      x.rating = applyJudgeRating(x.rating, jr.stars);
      a.judgeCount++;
      a.judgeSum += jr.stars;
    }

    for (const p of g.participants) {
      const a = get(p.playerId);
      a.totalGames++;
      a.history.push({ gameId: g.id, playedAt: g.playedAt, rating: toDisplay(a.overall) });
    }
  }

  const players: PlayerStats[] = [...acc].map(([id, a]) => {
    const positions: PositionStats[] = [...a.positions]
      .sort(([x], [y]) => x - y)
      .map(([position, p]) => ({
        position,
        mu: p.rating.mu,
        sigma: p.rating.sigma,
        rating: toDisplay(p.rating),
        games: p.games,
        wins: p.wins,
        established: p.games >= settings.minPositionGames,
      }));
    const best = positions
      .filter((p) => p.established)
      .sort((x, y) => y.rating - x.rating || y.games - x.games || x.position - y.position)[0];
    const rating = toDisplay(a.overall);
    return {
      playerId: id,
      mu: a.overall.mu,
      sigma: a.overall.sigma,
      rating,
      provisional: a.totalGames < settings.provisionalGames,
      games: a.games,
      wins: a.wins,
      losses: a.losses,
      winPct: a.games === 0 ? 0 : a.wins / a.games,
      mvps: a.mvps,
      currentStreak: a.streak,
      longestStreak: a.longest,
      bestPosition: best?.position ?? null,
      positions,
      ratingHistory: a.history,
      gamesBySession: a.bySession,
      ratingDelta: a.ratingAtWindowStart !== null ? rating - a.ratingAtWindowStart : 0,
      lastPlayedAt: a.lastPlayedAt,
      judgeRatings: a.judgeCount,
      judgeAvg: a.judgeCount ? a.judgeSum / a.judgeCount : null,
    };
  });

  const pairList: PairStats[] = [...pairs].map(([key, p]) => {
    const [a, b] = key.split('|');
    const n = p.togetherGames;
    const chemistry = n === 0 ? 0 : (p.residualSum / n) * (n / (n + CHEMISTRY_K));
    return {
      a,
      b,
      together: { games: n, wins: p.togetherWins, chemistry, enough: n >= settings.minChemistryGames },
      against: { games: p.againstGames, aWins: p.aWins, bWins: p.bWins },
    };
  });

  const sessionMvps: Record<string, string> = {};
  for (const [sessionId, counts] of sessionMvpCounts) {
    sessionMvps[sessionId] = [...counts].sort(
      ([xa, xc], [ya, yc]) => yc - xc || toDisplay(get(ya).overall) - toDisplay(get(xa).overall) || cmp(xa, ya),
    )[0][0];
  }

  return { players, pairs: pairList, sessionMvps, gameCount: windowGames, from, to };
}
