import type { Analytics, GroupSettings, PairStats, PlayerStats } from '../api/types';
import { positionPenalty } from './positions';

/**
 * The ONE team-rating function used by the court view, the balancer and the dream team.
 *
 *   teamRating = mean(player rating at their assigned position) + chemistryBonus
 *
 * - Player rating at a position: their rating for that position, from the first game there (the API already
 *   blends a secondary position with the main one, so few games there still give a sensible number). For a
 *   position never played, the same starting point the API would use: main position minus the out-of-position
 *   penalty, with a little extra uncertainty. Players with < provisionalGames overall fall back to the
 *   group prior (mean rating of established players, or 60 when nobody is established yet).
 * - chemistryBonus = clamp(CHEM_SCALE × mean pairwise chemistry, ±CHEM_CAP). Pairs without enough
 *   games together count as 0. Chemistry is an over/under-performance in win probability
 *   (≈ −0.3…+0.3), so ×20 turns a strong +0.15 pair average into +3 rating points.
 */
export const CHEM_SCALE = 20;
export const CHEM_CAP = 3;
export const FALLBACK_PRIOR = 60;

export interface RatingContext {
  stats: Map<string, PlayerStats>;
  chemistry: Map<string, PairStats>;
  settings: GroupSettings;
  prior: number;
}

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function buildContext(analytics: Analytics | undefined, settings: GroupSettings): RatingContext {
  const stats = new Map((analytics?.players ?? []).map((p) => [p.playerId, p]));
  const chemistry = new Map((analytics?.pairs ?? []).map((p) => [pairKey(p.a, p.b), p]));
  const established = (analytics?.players ?? []).filter((p) => !p.provisional);
  const prior = established.length ? established.reduce((s, p) => s + p.rating, 0) / established.length : FALLBACK_PRIOR;
  return { stats, chemistry, settings, prior };
}

export function isProvisional(ctx: RatingContext, playerId: string) {
  const s = ctx.stats.get(playerId);
  return !s || s.provisional;
}

export function positionRating(ctx: RatingContext, playerId: string, position: number): number {
  const s = ctx.stats.get(playerId);
  if (!s || s.provisional) return ctx.prior;
  const pos = s.positions.find((p) => p.position === position);
  if (pos && pos.games > 0) return pos.rating;
  const main = s.positions.reduce<PlayerStats['positions'][number] | null>(
    (m, p) => (p.games > 0 && (!m || p.games > m.games || (p.games === m.games && p.mu > m.mu)) ? p : m),
    null,
  );
  if (!main) return s.rating;
  // Mirrors positionPrior in worker/src/core/analytics.ts (transfer σ 1.5, display = 40 + 1.5·(μ − 3σ)).
  const mu = main.mu - positionPenalty(main.position, position) / 1.5;
  const sigma = Math.min(25 / 3, Math.sqrt(main.sigma ** 2 + 1.5 ** 2));
  return Math.max(0, Math.min(100, Math.round(40 + 1.5 * (mu - 3 * sigma))));
}

/** Chemistry for display/bonus; null when there isn't enough data. */
export function pairChemistry(ctx: RatingContext, a: string, b: string): number | null {
  const p = ctx.chemistry.get(pairKey(a, b));
  if (!p || p.together.games < ctx.settings.minChemistryGames) return null;
  return p.together.chemistry;
}

export function chemistryBonus(ctx: RatingContext, playerIds: string[]): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < playerIds.length; i++)
    for (let j = i + 1; j < playerIds.length; j++) {
      sum += pairChemistry(ctx, playerIds[i], playerIds[j]) ?? 0;
      n++;
    }
  if (n === 0) return 0;
  return Math.max(-CHEM_CAP, Math.min(CHEM_CAP, (sum / n) * CHEM_SCALE));
}

export interface Slot {
  playerId: string;
  position: number;
}

export function teamRating(ctx: RatingContext, slots: Slot[]): number {
  if (slots.length === 0) return 0;
  const base = slots.reduce((s, x) => s + positionRating(ctx, x.playerId, x.position), 0) / slots.length;
  return base + chemistryBonus(ctx, slots.map((s) => s.playerId));
}

/**
 * Win probability from two team ratings, consistent with the TrueSkill display mapping
 * (display = 40 + 1.5·(μ − 3σ)): a 1-point team-average gap ≈ n/1.5 μ-units of team skill,
 * against performance noise √(2n)·√2·β. For 6-a-side, +1 rating ≈ 58 %, +5 ≈ 84 %.
 */
const BETA = 25 / 6;
export function winProbability(ratingA: number, ratingB: number, teamSize = 6): number {
  const deltaMu = (teamSize * (ratingA - ratingB)) / 1.5;
  const sd = Math.sqrt(2 * teamSize) * Math.SQRT2 * BETA;
  return normalCdf(deltaMu / sd);
}

export function normalCdf(x: number): number {
  // Abramowitz–Stegun 7.1.26 via erf
  const t = 1 / (1 + 0.3275911 * Math.abs(x / Math.SQRT2));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

export function tierOf(rating: number, provisional: boolean, s: GroupSettings): 'gold' | 'silver' | 'bronze' | 'prov' {
  if (provisional) return 'prov';
  if (rating >= s.goldThreshold) return 'gold';
  if (rating >= s.silverThreshold) return 'silver';
  return 'bronze';
}
