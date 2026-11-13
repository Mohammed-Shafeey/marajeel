import type { GroupSettings } from './settings.ts';
import { applyJudgeRating, defaultRating, INITIAL_SIGMA, marginWeight, toDisplay, update, winProbability, type Rating } from './trueskill.ts';

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

/** Court zones grouped by role: 1/5 receivers, 2/4 hitters, 3 setter, 6 libero. */
const ROLE: Record<number, 'receiver' | 'hitter' | 'setter' | 'libero'> = { 1: 'receiver', 5: 'receiver', 2: 'hitter', 4: 'hitter', 3: 'setter', 6: 'libero' };

/**
 * "Out of position" penalty, in 0–100 display points, when a player starts a new position: the same role on the
 * other side (left ↔ right hitter, left ↔ right receiver) 2, hitter ↔ receiver 3, anything involving setter or libero 6.
 */
export function positionPenalty(from: number, to: number): number {
  if (from === to) return 0;
  const a = ROLE[from];
  const b = ROLE[to];
  if (!a || !b) return 6;
  if (a === b) return 2;
  if (a === 'setter' || b === 'setter' || a === 'libero' || b === 'libero') return 6;
  return 3;
}

/** Extra uncertainty for how well skill carries over to another position. */
export const POSITION_TRANSFER_SIGMA = 1.5;

/** Starting belief for a position, derived from the player's main position: μ minus the penalty, σ widened a little. */
export function positionPrior(main: { position: number; rating: Rating }, position: number): Rating {
  return {
    mu: main.rating.mu - positionPenalty(main.position, position) / 1.5,
    sigma: Math.min(INITIAL_SIGMA, Math.sqrt(main.rating.sigma ** 2 + POSITION_TRANSFER_SIGMA ** 2)),
  };
}

/**
 * Rating at a secondary position = what the player's main position says about it, combined with the games
 * actually played there. Each position track is replayed on its own from the default start, so its evidence is the
 * track with that default prior divided out (Gaussian natural parameters: η = μ/σ², λ = 1/σ²). We then multiply
 * in the prior from the main position's *current* rating (see positionPrior). Few games there → close to the main
 * position minus the penalty; many games → mostly their own results.
 * Example: 85 at left hitter, 8 average games at right hitter → about 80 at right hitter, not ~50.
 */
export function combineWithMain(track: Rating, main: { position: number; rating: Rating }, position: number): Rating {
  const d = defaultRating();
  let lam = 1 / track.sigma ** 2 - 1 / d.sigma ** 2;
  let eta = track.mu / track.sigma ** 2 - d.mu / d.sigma ** 2;
  if (lam <= 1e-6) lam = eta = 0; // no usable evidence (dynamics can leave σ at the default)
  const prior = positionPrior(main, position);
  const lamP = 1 / prior.sigma ** 2;
  const L = lamP + lam;
  return { mu: (prior.mu * lamP + eta) / L, sigma: 1 / Math.sqrt(L) };
}

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
    // Main position = most games there (ties: higher μ); other positions lean on it (see combineWithMain).
    let main: { position: number; rating: Rating; games: number } | null = null;
    for (const [position, p] of a.positions)
      if (p.games > 0 && (!main || p.games > main.games || (p.games === main.games && p.rating.mu > main.rating.mu))) main = { position, rating: p.rating, games: p.games };
    const positions: PositionStats[] = [...a.positions]
      .sort(([x], [y]) => x - y)
      .map(([position, p]) => {
        const r = main && position !== main.position ? combineWithMain(p.rating, main, position) : p.rating;
        return { position, p, r };
      })
      .map(({ position, p, r }) => ({
        position,
        mu: r.mu,
        sigma: r.sigma,
        rating: toDisplay(r),
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
