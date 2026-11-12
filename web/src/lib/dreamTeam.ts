import { teamRating, type RatingContext, type Slot } from './teamRating';

export interface DreamTeamResult {
  slots: Slot[];
  rating: number;
  /** Positions that had no eligible candidate. */
  missing: number[];
}

/**
 * Best possible line-up: one distinct player per template position, maximising teamRating
 * (which includes the chemistry bonus). Eligible = not provisional and ≥ minPositionGames at that position.
 *  1. Prune to the top `perPosition` candidates per position by position rating.
 *  2. Exhaustive depth-first search over valid combinations (no duplicates). 6^6 ≈ 47k leaves.
 */
export function dreamTeam(ctx: RatingContext, template: number[], perPosition = 6): DreamTeamResult {
  const candidates = template.map((pos) =>
    [...ctx.stats.values()]
      .filter((s) => !s.provisional)
      .map((s) => ({ id: s.playerId, pos: s.positions.find((p) => p.position === pos) }))
      .filter((c) => c.pos && c.pos.games >= ctx.settings.minPositionGames)
      .sort((a, b) => b.pos!.rating - a.pos!.rating)
      .slice(0, perPosition)
      .map((c) => c.id),
  );

  const missing = template.filter((_, i) => candidates[i].length === 0);
  const searchable = template.map((pos, i) => ({ pos, ids: candidates[i] })).filter((x) => x.ids.length > 0);

  // Search the most constrained positions first: prunes duplicate conflicts earlier.
  searchable.sort((a, b) => a.ids.length - b.ids.length);

  let best: Slot[] = [];
  let bestRating = -Infinity;
  const chosen: Slot[] = [];
  const used = new Set<string>();

  const dfs = (k: number) => {
    if (k === searchable.length) {
      const r = teamRating(ctx, chosen);
      if (r > bestRating) {
        bestRating = r;
        best = chosen.slice();
      }
      return;
    }
    const { pos, ids } = searchable[k];
    let placed = false;
    for (const id of ids) {
      if (used.has(id)) continue;
      placed = true;
      used.add(id);
      chosen.push({ playerId: id, position: pos });
      dfs(k + 1);
      chosen.pop();
      used.delete(id);
    }
    // Every candidate for this position is already used elsewhere: leave the position empty.
    if (!placed) dfs(k + 1);
  };
  dfs(0);

  best.sort((a, b) => template.indexOf(a.position) - template.indexOf(b.position));
  const filled = new Set(best.map((s) => s.position));
  return { slots: best, rating: best.length ? bestRating : 0, missing: template.filter((p) => !filled.has(p) && !missing.includes(p)).concat(missing) };
}
