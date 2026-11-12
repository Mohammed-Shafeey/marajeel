import { mulberry32, type Rng } from './rng';
import { positionRating, teamRating, type RatingContext, type Slot } from './teamRating';

export interface BalanceInput {
  playerIds: string[];
  teamCount: number;
  template: number[];
  /** playerId → team index the player must stay on. */
  locks?: Record<string, number>;
  /** Preferred positions help the draft put people where they're used to playing. */
  preferred?: Record<string, number>;
  seed: number;
  iterations?: number;
}

export interface BalanceResult {
  teams: Slot[][];
  ratings: number[];
  spread: number;
}

/** Penalty (rating points) for playing someone at a position they have no history at and don't prefer. */
const UNFAMILIAR_PENALTY = 1.5;

/**
 * Balanced team generator.
 *  1. Snake draft by position: for each template position, the best remaining candidates for that
 *     position are dealt to teams snake-style (direction alternates per round).
 *  2. Simulated annealing over cross-team player swaps and in-team position swaps, minimising
 *     (max − min team rating) + variance + a small position-familiarity penalty.
 * Deterministic for a given seed; "shuffle" just changes the seed.
 */
export function balanceTeams(ctx: RatingContext, input: BalanceInput): BalanceResult {
  const { playerIds, teamCount, template } = input;
  const size = template.length;
  if (playerIds.length !== teamCount * size) throw new Error(`Need exactly ${teamCount * size} players, got ${playerIds.length}`);
  const rng = mulberry32(input.seed);
  const locks = input.locks ?? {};
  const preferred = input.preferred ?? {};

  const familiarity = (id: string, pos: number) => {
    const s = ctx.stats.get(id);
    const played = s?.positions.find((p) => p.position === pos)?.games ?? 0;
    return played > 0 || preferred[id] === pos ? 0 : UNFAMILIAR_PENALTY;
  };
  const fit = (id: string, pos: number) => positionRating(ctx, id, pos) - familiarity(id, pos) + (preferred[id] === pos ? 0.5 : 0);

  // --- 1. snake draft by position -------------------------------------------------------------
  const teams: Slot[][] = Array.from({ length: teamCount }, () => []);
  const remaining = new Set(playerIds);
  const openPositions = Array.from({ length: teamCount }, () => template.slice());

  // Locked players first, at their best open position on their team.
  for (const [id, t] of Object.entries(locks)) {
    if (!remaining.has(id) || t < 0 || t >= teamCount) continue;
    const pos = openPositions[t].slice().sort((a, b) => fit(id, b) - fit(id, a))[0];
    if (pos === undefined) continue;
    teams[t].push({ playerId: id, position: pos });
    openPositions[t].splice(openPositions[t].indexOf(pos), 1);
    remaining.delete(id);
  }

  let forward = rng() < 0.5;
  for (const pos of template) {
    const order = Array.from({ length: teamCount }, (_, i) => i);
    if (!forward) order.reverse();
    forward = !forward;
    for (const t of order) {
      const idx = openPositions[t].indexOf(pos);
      if (idx < 0) continue;
      const pick = [...remaining].sort((a, b) => fit(b, pos) - fit(a, pos) || (rng() < 0.5 ? -1 : 1))[0];
      teams[t].push({ playerId: pick, position: pos });
      openPositions[t].splice(idx, 1);
      remaining.delete(pick);
    }
  }

  // --- 2. simulated annealing -----------------------------------------------------------------
  const ratingOf = (team: Slot[]) => teamRating(ctx, team);
  const penaltyOf = (team: Slot[]) => team.reduce((s, x) => s + familiarity(x.playerId, x.position), 0);
  const cost = (rs: number[], penalties: number[]) => {
    const mean = rs.reduce((s, r) => s + r, 0) / rs.length;
    const variance = rs.reduce((s, r) => s + (r - mean) ** 2, 0) / rs.length;
    return Math.max(...rs) - Math.min(...rs) + variance + 0.15 * penalties.reduce((s, p) => s + p, 0);
  };

  let ratings = teams.map(ratingOf);
  let penalties = teams.map(penaltyOf);
  let current = cost(ratings, penalties);
  let best = { teams: teams.map((t) => t.slice()), cost: current };
  const iterations = input.iterations ?? 6000;
  let temp = 2.0;
  const cooling = Math.pow(0.001 / temp, 1 / iterations);

  for (let i = 0; i < iterations; i++, temp *= cooling) {
    const move = proposeMove(teams, teamCount, size, locks, rng);
    if (!move) continue;
    const touched = [...new Set([move.t1, move.t2])];
    apply(teams, move);
    const newRatings = ratings.slice();
    const newPenalties = penalties.slice();
    for (const t of touched) {
      newRatings[t] = ratingOf(teams[t]);
      newPenalties[t] = penaltyOf(teams[t]);
    }
    const next = cost(newRatings, newPenalties);
    if (next <= current || rng() < Math.exp((current - next) / temp)) {
      current = next;
      ratings = newRatings;
      penalties = newPenalties;
      if (current < best.cost) best = { teams: teams.map((t) => t.slice()), cost: current };
    } else {
      apply(teams, move); // swaps are their own inverse
    }
  }

  const finalTeams = best.teams.map((t) => t.slice().sort((a, b) => template.indexOf(a.position) - template.indexOf(b.position)));
  const finalRatings = finalTeams.map(ratingOf);
  return { teams: finalTeams, ratings: finalRatings, spread: Math.max(...finalRatings) - Math.min(...finalRatings) };
}

interface Move {
  t1: number;
  i1: number;
  t2: number;
  i2: number;
}

/** Swap the players in two slots. Cross-team: players trade places (positions stay with the slot). Same team: two players trade positions. */
function proposeMove(teams: Slot[][], teamCount: number, size: number, locks: Record<string, number>, rng: Rng): Move | null {
  for (let attempt = 0; attempt < 10; attempt++) {
    const t1 = Math.floor(rng() * teamCount);
    const sameTeam = rng() < 0.25;
    const t2 = sameTeam ? t1 : (t1 + 1 + Math.floor(rng() * (teamCount - 1))) % teamCount;
    const i1 = Math.floor(rng() * size);
    const i2 = Math.floor(rng() * size);
    if (t1 === t2 && i1 === i2) continue;
    if (t1 !== t2 && (teams[t1][i1].playerId in locks || teams[t2][i2].playerId in locks)) continue;
    return { t1, i1, t2, i2 };
  }
  return null;
}

function apply(teams: Slot[][], m: Move) {
  const a = teams[m.t1][m.i1].playerId;
  teams[m.t1][m.i1] = { ...teams[m.t1][m.i1], playerId: teams[m.t2][m.i2].playerId };
  teams[m.t2][m.i2] = { ...teams[m.t2][m.i2], playerId: a };
}

/** A naive random split (for comparison/tests). */
export function randomSplit(ctx: RatingContext, playerIds: string[], teamCount: number, template: number[], seed: number): BalanceResult {
  const rng = mulberry32(seed);
  const ids = playerIds.slice().sort(() => rng() - 0.5);
  const teams = Array.from({ length: teamCount }, (_, t) => template.map((pos, i) => ({ playerId: ids[t * template.length + i], position: pos })));
  const ratings = teams.map((t) => teamRating(ctx, t));
  return { teams, ratings, spread: Math.max(...ratings) - Math.min(...ratings) };
}
