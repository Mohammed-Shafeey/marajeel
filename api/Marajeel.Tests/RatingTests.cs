using Marajeel.Core.Analytics;
using Marajeel.Core.Domain;

namespace Marajeel.Tests;

public class TrueSkillTests
{
    [Fact]
    public void Even_teams_have_fifty_percent_win_probability()
    {
        var team = Enumerable.Repeat(TrueSkill.Default, 6).ToList();
        Assert.Equal(0.5, TrueSkill.WinProbability(team, team), 6);
    }

    [Fact]
    public void Winners_go_up_losers_go_down_and_everyone_gets_more_certain()
    {
        var team = Enumerable.Repeat(TrueSkill.Default, 6).ToList();
        var (w, l) = TrueSkill.Update(team, team);
        Assert.All(w, r => Assert.True(r.Mu > TrueSkill.InitialMu));
        Assert.All(l, r => Assert.True(r.Mu < TrueSkill.InitialMu));
        Assert.All(w.Concat(l), r => Assert.True(r.Sigma < TrueSkill.InitialSigma));
        // Symmetric for equal teams.
        Assert.Equal(w[0].Mu - 25, 25 - l[0].Mu, 9);
    }

    [Fact]
    public void Upset_moves_ratings_more_than_expected_result()
    {
        var strong = Enumerable.Repeat(new Rating(30, 3), 6).ToList();
        var weak = Enumerable.Repeat(new Rating(20, 3), 6).ToList();
        var (expectedWin, _) = TrueSkill.Update(strong, weak);
        var (upsetWin, _) = TrueSkill.Update(weak, strong);
        Assert.True(upsetWin[0].Mu - 20 > expectedWin[0].Mu - 30);
    }

    [Theory]
    [InlineData(1, 1.0)]
    [InlineData(2, 1.0)]
    [InlineData(6, 1.25)]
    [InlineData(10, 1.5)]
    [InlineData(15, 1.5)]
    public void Margin_weight_is_capped_at_one_and_a_half(int margin, double expected) =>
        Assert.Equal(expected, TrueSkill.MarginWeight(margin), 9);

    [Fact]
    public void Blowout_moves_mu_at_most_one_and_a_half_times_a_close_game()
    {
        var team = Enumerable.Repeat(TrueSkill.Default, 6).ToList();
        var (close, _) = TrueSkill.Update(team, team, TrueSkill.MarginWeight(2));
        var (blowout, _) = TrueSkill.Update(team, team, TrueSkill.MarginWeight(15));
        Assert.Equal(1.5, (blowout[0].Mu - 25) / (close[0].Mu - 25), 6);
    }

    [Fact]
    public void Display_mapping_matches_documented_points()
    {
        Assert.Equal(40, TrueSkill.ToDisplay(TrueSkill.Default));
        Assert.Equal(82, TrueSkill.ToDisplay(new Rating(33.4, 1.8)));
        Assert.Equal(0, TrueSkill.ToDisplay(new Rating(-50, 5)));
        Assert.Equal(100, TrueSkill.ToDisplay(new Rating(80, 1)));
    }
}

public class ReplayTests
{
    [Fact]
    public void Replay_is_deterministic_and_order_independent_of_input_list()
    {
        var f = new Fixture();
        for (var i = 0; i < 8; i++) f.Add(Fixture.TeamA, Fixture.TeamB, i % 3 == 0 ? 12 : 15, i % 3 == 0 ? 15 : 10);
        var r1 = AnalyticsEngine.Compute(f.Players, f.Games, GroupSettings.Default);
        var shuffled = f.Games.OrderBy(_ => Guid.NewGuid()).ToList();
        var r2 = AnalyticsEngine.Compute(f.Players, shuffled, GroupSettings.Default);
        foreach (var p in r1.Players)
        {
            var q = r2.Players.Single(x => x.PlayerId == p.PlayerId);
            Assert.Equal(p.Mu, q.Mu, 12);
            Assert.Equal(p.Sigma, q.Sigma, 12);
        }
    }

    [Fact]
    public void Correcting_a_score_recomputes_everything_consistently()
    {
        var f = new Fixture();
        var g = f.Add(Fixture.TeamA, Fixture.TeamB, 15, 3);
        f.Add(Fixture.TeamA, Fixture.TeamB, 15, 13);
        var wrong = AnalyticsEngine.Compute(f.Players, f.Games, GroupSettings.Default);

        // Fix the first game: B actually won.
        f.Games[0] = g with { ScoreA = 3, ScoreB = 15 };
        var fixedResult = AnalyticsEngine.Compute(f.Players, f.Games, GroupSettings.Default);

        // A replay from scratch with the corrected data must equal the "fixed" result exactly.
        var fresh = AnalyticsEngine.Compute(f.Players, f.Games.ToList(), GroupSettings.Default);
        Assert.Equal(fresh.Players.Select(p => p.Mu), fixedResult.Players.Select(p => p.Mu));
        var a0 = fixedResult.Players.Single(p => p.PlayerId == f[0]);
        Assert.Equal(1, a0.Wins);
        Assert.Equal(1, a0.Losses);
        Assert.NotEqual(wrong.Players.Single(p => p.PlayerId == f[0]).Mu, a0.Mu);
    }

    [Fact]
    public void Position_track_only_updates_from_games_at_that_position()
    {
        var f = new Fixture();
        // Player 0 always plays position 1 (first slot) in these games.
        for (var i = 0; i < 5; i++) f.Add(Fixture.TeamA, Fixture.TeamB, 15, 10);
        var r = AnalyticsEngine.Compute(f.Players, f.Games, GroupSettings.Default);
        var p0 = r.Players.Single(p => p.PlayerId == f[0]);
        Assert.Single(p0.Positions);
        Assert.Equal(1, p0.Positions[0].Position);
        Assert.Equal(5, p0.Positions[0].Games);
        Assert.Equal(1, p0.BestPosition);
    }

    [Fact]
    public void Best_position_requires_enough_games_at_that_position()
    {
        var f = new Fixture();
        for (var i = 0; i < 4; i++) f.Add(Fixture.TeamA, Fixture.TeamB, 15, 10);
        var r = AnalyticsEngine.Compute(f.Players, f.Games, GroupSettings.Default);
        Assert.Null(r.Players.Single(p => p.PlayerId == f[0]).BestPosition);
        Assert.True(r.Players.Single(p => p.PlayerId == f[0]).Provisional);
    }

    [Fact]
    public void Rating_history_has_one_point_per_game_played()
    {
        var f = new Fixture(14);
        f.Add(Fixture.TeamA, Fixture.TeamB, 15, 10);
        f.Add([0, 1, 2, 3, 4, 12], [6, 7, 8, 9, 10, 13], 15, 10);
        var r = AnalyticsEngine.Compute(f.Players, f.Games, GroupSettings.Default);
        Assert.Equal(2, r.Players.Single(p => p.PlayerId == f[0]).RatingHistory.Count);
        Assert.Single(r.Players.Single(p => p.PlayerId == f[5]).RatingHistory);
    }

    [Fact]
    public void Window_counts_only_games_inside_but_ratings_use_full_history()
    {
        var f = new Fixture();
        var jan = new DateTimeOffset(2026, 1, 10, 18, 0, 0, TimeSpan.Zero);
        var feb = new DateTimeOffset(2026, 2, 10, 18, 0, 0, TimeSpan.Zero);
        f.Add(Fixture.TeamA, Fixture.TeamB, 15, 5, at: jan);
        f.Add(Fixture.TeamA, Fixture.TeamB, 5, 15, at: feb);
        var all = AnalyticsEngine.Compute(f.Players, f.Games, GroupSettings.Default);
        var month = AnalyticsEngine.Compute(f.Players, f.Games, GroupSettings.Default,
            new DateTimeOffset(2026, 2, 1, 0, 0, 0, TimeSpan.Zero), new DateTimeOffset(2026, 3, 1, 0, 0, 0, TimeSpan.Zero));
        var a = all.Players.Single(p => p.PlayerId == f[0]);
        var m = month.Players.Single(p => p.PlayerId == f[0]);
        Assert.Equal(2, a.Games);
        Assert.Equal(1, m.Games);
        Assert.Equal(0, m.Wins);
        Assert.Equal(a.Mu, m.Mu);
        Assert.True(m.RatingDelta < 0);
    }
}
