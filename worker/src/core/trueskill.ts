/** A Gaussian skill belief: mean μ and standard deviation σ. */
export interface Rating {
  mu: number;
  sigma: number;
}

/**
 * Two-team TrueSkill (Herbrich, Minka & Graepel 2006), no draws.
 * For two teams the factor graph has an exact closed form (as in Moserware.Skills'
 * TwoTeamTrueSkillCalculator with draw probability 0 and full partial-play weights).
 */
export const INITIAL_MU = 25;
export const INITIAL_SIGMA = INITIAL_MU / 3; // 8.333
export const BETA = INITIAL_SIGMA / 2; // 4.1667: skill gap that gives ~76% win chance
export const TAU = INITIAL_SIGMA / 100; // dynamics: keeps σ from collapsing to 0

export const defaultRating = (): Rating => ({ mu: INITIAL_MU, sigma: INITIAL_SIGMA });

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * 0–100 display scale: clamp(round(40 + 1.5·(μ − 3σ)), 0, 100).
 * New player (μ=25, σ=8.33) → 40; strong established (μ≈33, σ≈1.8) → ≈81; weak (μ≈17) → ≈57.
 */
export const toDisplay = (r: Rating) => clamp(Math.round(40 + 1.5 * (r.mu - 3 * r.sigma)), 0, 100);

/** Margin weight: ≤2 points → 1.0×, linear to 1.5× at 10+ points, never more. */
export const marginWeight = (margin: number) => 1 + 0.5 * clamp((margin - 2) / 8, 0, 1);

const sum = (xs: readonly Rating[], f: (r: Rating) => number) => xs.reduce((s, r) => s + f(r), 0);

/** Probability team A beats team B. */
export function winProbability(a: readonly Rating[], b: readonly Rating[]): number {
  const n = a.length + b.length;
  const deltaMu = sum(a, (r) => r.mu) - sum(b, (r) => r.mu);
  const sumSigma2 = sum(a, (r) => r.sigma * r.sigma) + sum(b, (r) => r.sigma * r.sigma);
  return cdf(deltaMu / Math.sqrt(n * BETA * BETA + sumSigma2));
}

/**
 * Updates both teams after `winners` beat `losers`. `weight` scales the step from the prior (after
 * dynamics) toward the TrueSkill posterior: μ' = μ + w·Δμ, σ'² = σ² + w·Δσ².
 */
export function update(winners: readonly Rating[], losers: readonly Rating[], weight = 1): { winners: Rating[]; losers: Rating[] } {
  const inflate = (r: Rating): Rating => ({ mu: r.mu, sigma: Math.sqrt(r.sigma * r.sigma + TAU * TAU) });
  const w = winners.map(inflate);
  const l = losers.map(inflate);

  const n = w.length + l.length;
  const c2 = sum(w, (r) => r.sigma * r.sigma) + sum(l, (r) => r.sigma * r.sigma) + n * BETA * BETA;
  const c = Math.sqrt(c2);
  const t = (sum(w, (r) => r.mu) - sum(l, (r) => r.mu)) / c;
  const v = vExceedsMargin(t);
  const ww = v * (v + t);

  const step = (r: Rating, sign: number): Rating => {
    const s2 = r.sigma * r.sigma;
    const muNew = r.mu + ((sign * s2) / c) * v;
    const s2New = s2 * Math.max(1 - (s2 / c2) * ww, 1e-4);
    const mu = r.mu + weight * (muNew - r.mu);
    const variance = Math.max(s2 + weight * (s2New - s2), 1e-4);
    return { mu, sigma: Math.sqrt(variance) };
  };
  return { winners: w.map((r) => step(r, +1)), losers: l.map((r) => step(r, -1)) };
}

export const pdf = (x: number) => Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);
export const cdf = (x: number) => 0.5 * erfc(-x / Math.SQRT2);

/** V(t) = φ(t)/Φ(t): mean additive correction for a win (draw margin 0). */
export function vExceedsMargin(t: number) {
  const denom = cdf(t);
  return denom < 2.222758749e-162 ? -t : pdf(t) / denom;
}

/** Complementary error function (Numerical Recipes Chebyshev fit, |error| < 1.2e-7). */
export function erfc(x: number) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const ans =
    t *
    Math.exp(
      -z * z - 1.26551223 +
        t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? ans : 2 - ans;
}
