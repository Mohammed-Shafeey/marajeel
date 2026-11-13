import type { PlayerStats } from '../api/types';

/**
 * Who to ask the judge about after a game: someone on court who isn't the MVP and has the least
 * data — fewest judge ratings first, then fewest games, then the most uncertain rating. Ties are
 * broken by `random` so the same person isn't always asked.
 */
export function pickRatingCandidate(
  participants: readonly { playerId: string }[],
  mvpId: string | null,
  stats: ReadonlyMap<string, PlayerStats>,
  random: () => number = Math.random,
): string | null {
  const pool = participants
    .map((p) => p.playerId)
    .filter((id) => id !== mvpId)
    .map((id) => {
      const s = stats.get(id);
      return {
        id,
        ratings: s?.judgeRatings ?? 0,
        games: s ? s.positions.reduce((n, p) => n + p.games, 0) : 0,
        sigma: s?.sigma ?? 99, // unknown = most uncertain (finite, so the sort comparator never yields NaN)
        tie: random(),
      };
    });
  pool.sort((a, b) => a.ratings - b.ratings || a.games - b.games || b.sigma - a.sigma || a.tie - b.tie);
  return pool[0]?.id ?? null;
}
