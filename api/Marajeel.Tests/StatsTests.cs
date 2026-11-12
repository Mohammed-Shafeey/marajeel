using Marajeel.Core.Analytics;
using Marajeel.Core.Domain;
using Marajeel.Core.Simulation;

namespace Marajeel.Tests;

public class ChemistryTests
{
    [Fact]
    public void Shrinkage_pulls_small_samples_toward_zero()
    {
        // Mean residual 0.5 with n=5 → 0.5 * 5/10 = 0.25
        Assert.Equal(0.25, AnalyticsEngine.ShrinkChemistry([0.5, 0.5, 0.5, 0.5, 0.5]), 9);
        // n=1 → 0.5 * 1/6
        Assert.Equal(0.5 / 6, AnalyticsEngine.ShrinkChemistry([0.5]), 9);
        // n=45 → 0.5 * 45/50 = 0.45
        Assert.Equal(0.45, AnalyticsEngine.ShrinkChemistry(Enumerable.Repeat(0.5, 45).ToList()), 9);
        Assert.Equal(0, AnalyticsEngine.ShrinkChemistry([]));
    }

    [Fact]
    public void First_game_between_equal_teams_gives_half_residual()
    {
        var f = new Fixture();
        f.Add(Fixture.TeamA, Fixture.TeamB, 15, 10);
        var r = AnalyticsEngine.Compute(f.Players, f.Games, GroupSettings.Default);
        var pair = r.Pairs.Single(p => p.Together.Games == 1 && new[] { p.A, p.B }.Contains(f[0]) && new[] { p.A, p.B }.Contains(f[1]));
        // residual = 1 − 0.5 = 0.5, shrunk by 1/(1+5)
        Assert.Equal(0.5 / 6, pair.Together.Chemistry, 6);
        Assert.False(pair.Together.Enough);
        var losers = r.Pairs.Single(p => new[] { p.A, p.B }.Contains(f[6]) && new[] { p.A, p.B }.Contains(f[7]));
        Assert.Equal(-0.5 / 6, losers.Together.Chemistry, 6);
    }

    [Fact]
    public void Chemistry_is_marked_enough_from_five_games_together()
    {
        var f = new Fixture();
        for (var i = 0; i < 5; i++) f.Add(Fixture.TeamA, Fixture.TeamB, 15, 12);
        var r = AnalyticsEngine.Compute(f.Players, f.Games, GroupSettings.Default);
        var pair = r.Pairs.Single(p => new[] { p.A, p.B }.Contains(f[0]) && new[] { p.A, p.B }.Contains(f[1]));
        Assert.Equal(5, pair.Together.Games);
        Assert.True(pair.Together.Enough);
        Assert.True(pair.Together.Chemistry > 0);
    }

    [Fact]
    public void Pair_that_beats_expectations_has_positive_chemistry_pair_that_underperforms_negative()
    {
        // Players 0 & 1 win together whenever paired; 2 & 3 lose together whenever paired, with
        // the rest of the lineup rotating so individual ratings stay roughly level.
        var f = new Fixture(16);
        var rng = new Random(1);
        for (var i = 0; i < 40; i++)
        {
            var others = Enumerable.Range(4, 12).OrderBy(_ => rng.Next()).ToArray();
            var good = new[] { 0, 1, others[0], others[1], others[2], others[3] };
            var bad = new[] { 2, 3, others[4], others[5], others[6], others[7] };
            f.Add(good, bad, 15, 11);
            // Split them up in a second game with a random result.
            var a = new[] { 0, 2, others[8], others[9], others[10], others[11] };
            var b = new[] { 1, 3, others[0], others[1], others[2], others[3] };
            if (rng.Next(2) == 0) f.Add(a, b, 15, 13); else f.Add(a, b, 13, 15);
        }
        var r = AnalyticsEngine.Compute(f.Players, f.Games, GroupSettings.Default);
        double Chem(int x, int y) => r.Pairs.Single(p => new[] { p.A, p.B }.Contains(f[x]) && new[] { p.A, p.B }.Contains(f[y])).Together.Chemistry;
        Assert.True(Chem(0, 1) > 0.05, $"good pair {Chem(0, 1)}");
        Assert.True(Chem(2, 3) < -0.05, $"bad pair {Chem(2, 3)}");
    }
}

public class StreakTests
{
    [Fact]
    public void Current_and_longest_streak()
    {
        var f = new Fixture();
        int[] results = [1, 1, 0, 1, 1, 1, 0, 1, 1];   // from team A's view
        foreach (var w in results) f.Add(Fixture.TeamA, Fixture.TeamB, w == 1 ? 15 : 10, w == 1 ? 10 : 15);
        var r = AnalyticsEngine.Compute(f.Players, f.Games, GroupSettings.Default);
        var a = r.Players.Single(p => p.PlayerId == f[0]);
        Assert.Equal(2, a.CurrentStreak);
        Assert.Equal(3, a.LongestStreak);
        var b = r.Players.Single(p => p.PlayerId == f[6]);
        Assert.Equal(0, b.CurrentStreak);
        Assert.Equal(1, b.LongestStreak);
    }

    [Fact]
    public void Streak_follows_chronological_order_not_insertion_order()
    {
        var f = new Fixture();
        var t0 = new DateTimeOffset(2026, 3, 1, 18, 0, 0, TimeSpan.Zero);
        f.Add(Fixture.TeamA, Fixture.TeamB, 10, 15, at: t0.AddMinutes(30)); // latest: loss
        f.Add(Fixture.TeamA, Fixture.TeamB, 15, 10, at: t0);
        f.Add(Fixture.TeamA, Fixture.TeamB, 15, 10, at: t0.AddMinutes(15));
        var a = AnalyticsEngine.Compute(f.Players, f.Games, GroupSettings.Default).Players.Single(p => p.PlayerId == f[0]);
        Assert.Equal(0, a.CurrentStreak);
        Assert.Equal(2, a.LongestStreak);
    }

    [Fact]
    public void Mvps_win_pct_and_games_per_session()
    {
        var f = new Fixture();
        f.Add(Fixture.TeamA, Fixture.TeamB, 15, 10, mvp: 0);
        f.Add(Fixture.TeamA, Fixture.TeamB, 10, 15, mvp: 6);
        f.Add(Fixture.TeamA, Fixture.TeamB, 15, 10, mvp: 0);
        var r = AnalyticsEngine.Compute(f.Players, f.Games, GroupSettings.Default);
        var a = r.Players.Single(p => p.PlayerId == f[0]);
        Assert.Equal(2, a.Mvps);
        Assert.Equal(2.0 / 3, a.WinPct, 9);
        Assert.Equal(3, a.GamesBySession[f.Session]);
        Assert.Equal(f[0], r.SessionMvps[f.Session]);
    }
}

public class HeadToHeadTests
{
    [Fact]
    public void Records_opponent_and_teammate_results()
    {
        var f = new Fixture();
        f.Add(Fixture.TeamA, Fixture.TeamB, 15, 10);             // 0 beats 6
        f.Add(Fixture.TeamA, Fixture.TeamB, 15, 12);             // 0 beats 6
        f.Add(Fixture.TeamA, Fixture.TeamB, 9, 15);              // 6 beats 0
        f.Add([0, 6, 2, 3, 4, 5], [1, 7, 8, 9, 10, 11], 15, 8);  // 0 & 6 teammates, win
        var r = AnalyticsEngine.Compute(f.Players, f.Games, GroupSettings.Default);
        var pair = r.Pairs.Single(p => new[] { p.A, p.B }.Contains(f[0]) && new[] { p.A, p.B }.Contains(f[6]));
        Assert.Equal(3, pair.Against.Games);
        var zeroWins = pair.A == f[0] ? pair.Against.AWins : pair.Against.BWins;
        var sixWins = pair.A == f[6] ? pair.Against.AWins : pair.Against.BWins;
        Assert.Equal(2, zeroWins);
        Assert.Equal(1, sixWins);
        Assert.Equal(1, pair.Together.Games);
        Assert.Equal(1, pair.Together.Wins);
    }
}

public class SimulationTests
{
    [Fact]
    public void Ratings_roughly_recover_hidden_true_skills()
    {
        // ~15 sessions → ~50 games per player. Balanced 6v6 games carry little information per game,
        // so we expect a clear but imperfect correlation (≈0.6), averaged over seeds to avoid flakiness.
        var rhos = Enumerable.Range(1, 5).Select(seed =>
        {
            var world = DemoData.Generate(seed);
            var r = AnalyticsEngine.Compute(world.Players.Select(p => p.Player.Id), world.GameRecords, GroupSettings.Default);
            var pairs = world.Players
                .Select(p => (truth: p.TrueSkill, est: r.Players.Single(x => x.PlayerId == p.Player.Id)))
                .Where(x => x.est.Games >= 10).ToList();
            return Spearman(pairs.Select(x => x.truth).ToArray(), pairs.Select(x => x.est.Mu).ToArray());
        }).ToList();
        Assert.True(rhos.Average() > 0.5, $"Spearman ρ = {string.Join(", ", rhos.Select(x => x.ToString("F2")))}");
        Assert.All(rhos, rho => Assert.True(rho > 0.3, $"ρ = {rho:F2}"));
    }

    [Fact]
    public void Simulated_games_pass_validation()
    {
        var world = DemoData.Generate(seed: 3);
        foreach (var s in world.Sessions)
        {
            var roster = new Core.Validation.RosterInput(
                s.Teams.Select(t => new Core.Validation.RosterTeam(t.Id, t.Label, t.Color)).ToList(),
                s.Roster.Select(p => new Core.Validation.RosterEntry(p.PlayerId, p.TeamId, p.Position, p.IsBench)).ToList());
            Assert.Empty(Core.Validation.Validators.ValidateRoster(roster, GroupSettings.Default,
                world.Players.Select(p => p.Player.Id).ToHashSet(), new HashSet<Guid>()));
            foreach (var g in s.Games)
            {
                var input = new Core.Validation.GameInput(g.Id, g.SessionId, g.TeamAId, g.TeamBId, g.ScoreA, g.ScoreB, g.MvpPlayerId,
                    g.Participants.Select(p => new Core.Validation.GameParticipantInput(p.PlayerId, p.Side, p.Position)).ToList());
                Assert.Empty(Core.Validation.Validators.ValidateGame(input, GroupSettings.Default,
                    s.Teams.Select(t => t.Id).ToHashSet(), s.Roster.Select(p => p.PlayerId).ToHashSet()));
            }
        }
    }

    static double Spearman(double[] x, double[] y)
    {
        double[] Rank(double[] v)
        {
            var idx = v.Select((val, i) => (val, i)).OrderBy(t => t.val).ToArray();
            var ranks = new double[v.Length];
            for (var i = 0; i < idx.Length; i++) ranks[idx[i].i] = i;
            return ranks;
        }
        var rx = Rank(x); var ry = Rank(y);
        var mx = rx.Average(); var my = ry.Average();
        var cov = rx.Zip(ry).Sum(t => (t.First - mx) * (t.Second - my));
        return cov / Math.Sqrt(rx.Sum(a => (a - mx) * (a - mx)) * ry.Sum(b => (b - my) * (b - my)));
    }
}
