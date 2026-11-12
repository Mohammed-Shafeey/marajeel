import type { Analytics, PairStats, PlayerStats } from '../api/types';
import { DEFAULT_SETTINGS } from '../api/types';
import { mulberry32 } from './rng';
import { buildContext } from './teamRating';

/** Synthetic analytics for tests: `n` established players with ratings and per-position tracks. */
export function syntheticAnalytics(n: number, seed = 1, opts: { provisionalEvery?: number } = {}): Analytics {
  const rng = mulberry32(seed);
  const players: PlayerStats[] = Array.from({ length: n }, (_, i) => {
    const base = Math.round(50 + rng() * 35);
    const provisional = opts.provisionalEvery ? i % opts.provisionalEvery === 0 : false;
    return {
      playerId: `p${String(i).padStart(2, '0')}`,
      mu: 25,
      sigma: 3,
      rating: base,
      provisional,
      games: provisional ? 2 : 30,
      wins: 15,
      losses: 15,
      winPct: 0.5,
      mvps: 0,
      currentStreak: 0,
      longestStreak: 0,
      bestPosition: null,
      positions: [1, 2, 3, 4, 5, 6].map((pos) => ({
        position: pos,
        mu: 25,
        sigma: 3,
        rating: Math.round(base + (rng() - 0.5) * 16),
        games: rng() < 0.6 ? 8 : 1,
        wins: 4,
        established: true,
      })),
      ratingHistory: [],
      gamesBySession: {},
      ratingDelta: 0,
      lastPlayedAt: null,
    };
  });
  return { players, pairs: [], sessionMvps: {}, gameCount: 0, from: null, to: null };
}

export function withPairs(a: Analytics, pairs: Array<[string, string, number]>): Analytics {
  const ps: PairStats[] = pairs.map(([x, y, chem]) => ({
    a: x < y ? x : y,
    b: x < y ? y : x,
    together: { games: 10, wins: 5, chemistry: chem, enough: true },
    against: { games: 0, aWins: 0, bWins: 0 },
  }));
  return { ...a, pairs: ps };
}

export const ctxFor = (a: Analytics) => buildContext(a, DEFAULT_SETTINGS);
