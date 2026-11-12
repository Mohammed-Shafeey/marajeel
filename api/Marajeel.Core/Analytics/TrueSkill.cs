namespace Marajeel.Core.Analytics;

/// <summary>A Gaussian skill belief: mean μ and standard deviation σ.</summary>
public readonly record struct Rating(double Mu, double Sigma)
{
    public double Conservative => Mu - 3 * Sigma;
}

/// <summary>
/// Two-team TrueSkill (Herbrich, Minka &amp; Graepel 2006), no draws.
/// For two teams the factor graph has an exact closed form, identical to Moserware.Skills'
/// <c>TwoTeamTrueSkillCalculator</c> with draw probability 0 and full partial-play weights.
/// </summary>
public static class TrueSkill
{
    public const double InitialMu = 25.0;
    public const double InitialSigma = InitialMu / 3.0;      // 8.333
    public const double Beta = InitialSigma / 2.0;            // 4.1667: skill gap that gives ~76% win chance
    public const double Tau = InitialSigma / 100.0;           // dynamics: keeps σ from collapsing to 0

    public static Rating Default => new(InitialMu, InitialSigma);

    /// <summary>
    /// Maps a rating to the 0–100 display scale shown on cards:
    /// <c>display = clamp(round(40 + 1.5 · (μ − 3σ)), 0, 100)</c>.
    /// A brand-new player (μ=25, σ=8.33 → μ−3σ = 0) shows 40; an established strong player
    /// (μ≈33, σ≈1.8 → ≈27.6) shows ≈81; a weak one (μ≈17, σ≈1.8 → ≈11.6) shows ≈57.
    /// The conservative estimate means ratings climb as the system grows confident.
    /// </summary>
    public static int ToDisplay(Rating r) => (int)Math.Clamp(Math.Round(40 + 1.5 * r.Conservative), 0, 100);

    /// <summary>
    /// Margin-of-victory weight applied to the update: a 2-point game (or closer) counts 1.0×,
    /// growing linearly to 1.5× at a 10+ point margin, never more.
    /// </summary>
    public static double MarginWeight(int margin) => 1.0 + 0.5 * Math.Clamp((margin - 2) / 8.0, 0.0, 1.0);

    /// <summary>Probability team A beats team B.</summary>
    public static double WinProbability(IReadOnlyList<Rating> a, IReadOnlyList<Rating> b)
    {
        var n = a.Count + b.Count;
        var deltaMu = a.Sum(r => r.Mu) - b.Sum(r => r.Mu);
        var sumSigma2 = a.Sum(r => r.Sigma * r.Sigma) + b.Sum(r => r.Sigma * r.Sigma);
        return Gaussian.Cdf(deltaMu / Math.Sqrt(n * Beta * Beta + sumSigma2));
    }

    /// <summary>
    /// Updates both teams after <paramref name="winners"/> beat <paramref name="losers"/>.
    /// <paramref name="weight"/> scales the step taken from the prior (after dynamics) toward the
    /// TrueSkill posterior: μ' = μ + w·Δμ, σ'² = σ² + w·Δσ².
    /// </summary>
    public static (Rating[] Winners, Rating[] Losers) Update(IReadOnlyList<Rating> winners, IReadOnlyList<Rating> losers, double weight = 1.0)
    {
        // Dynamics: inflate uncertainty slightly before each game.
        var w = winners.Select(r => r with { Sigma = Math.Sqrt(r.Sigma * r.Sigma + Tau * Tau) }).ToArray();
        var l = losers.Select(r => r with { Sigma = Math.Sqrt(r.Sigma * r.Sigma + Tau * Tau) }).ToArray();

        var n = w.Length + l.Length;
        var c2 = w.Concat(l).Sum(r => r.Sigma * r.Sigma) + n * Beta * Beta;
        var c = Math.Sqrt(c2);
        var t = (w.Sum(r => r.Mu) - l.Sum(r => r.Mu)) / c;
        var v = Gaussian.VExceedsMargin(t);
        var ww = v * (v + t);

        Rating Step(Rating r, double sign)
        {
            var s2 = r.Sigma * r.Sigma;
            var muNew = r.Mu + sign * s2 / c * v;
            var s2New = s2 * Math.Max(1 - s2 / c2 * ww, 1e-4);
            var mu = r.Mu + weight * (muNew - r.Mu);
            var var = Math.Max(s2 + weight * (s2New - s2), 1e-4);
            return new Rating(mu, Math.Sqrt(var));
        }

        return (w.Select(r => Step(r, +1)).ToArray(), l.Select(r => Step(r, -1)).ToArray());
    }
}

public static class Gaussian
{
    public static double Pdf(double x) => Math.Exp(-x * x / 2) / Math.Sqrt(2 * Math.PI);

    public static double Cdf(double x) => 0.5 * Erfc(-x / Math.Sqrt(2));

    /// <summary>V(t) = φ(t)/Φ(t): the mean additive correction for a win (draw margin 0).</summary>
    public static double VExceedsMargin(double t)
    {
        var denom = Cdf(t);
        return denom < 2.222758749e-162 ? -t : Pdf(t) / denom;
    }

    /// <summary>Complementary error function (Numerical Recipes Chebyshev fit, |error| &lt; 1.2e-7).</summary>
    public static double Erfc(double x)
    {
        var z = Math.Abs(x);
        var t = 1.0 / (1.0 + 0.5 * z);
        var ans = t * Math.Exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
                  t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 +
                  t * (-0.82215223 + t * 0.17087277)))))))));
        return x >= 0 ? ans : 2.0 - ans;
    }
}
