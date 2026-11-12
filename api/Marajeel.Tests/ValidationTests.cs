using Marajeel.Core.Domain;
using Marajeel.Core.Validation;

namespace Marajeel.Tests;

public class GameValidationTests
{
    readonly GroupSettings _s = GroupSettings.Default;
    readonly Guid _teamA = Guid.NewGuid(), _teamB = Guid.NewGuid();
    readonly List<Guid> _players = Enumerable.Range(0, 14).Select(_ => Guid.NewGuid()).ToList();

    GameInput Valid(Func<GameInput, GameInput>? mutate = null)
    {
        var parts = _players.Take(6).Select((p, i) => new GameParticipantInput(p, 'A', i + 1))
            .Concat(_players.Skip(6).Take(6).Select((p, i) => new GameParticipantInput(p, 'B', i + 1))).ToList();
        var g = new GameInput(Guid.NewGuid(), Guid.NewGuid(), _teamA, _teamB, 15, 12, _players[0], parts);
        return mutate is null ? g : mutate(g);
    }

    List<ValidationError> Check(GameInput g, IEnumerable<Guid>? sessionPlayers = null) =>
        Validators.ValidateGame(g, _s, new HashSet<Guid> { _teamA, _teamB }, (sessionPlayers ?? _players.Take(13)).ToHashSet());

    [Fact] public void Valid_game_passes() => Assert.Empty(Check(Valid()));

    [Fact]
    public void Rule2_player_cannot_appear_twice_across_sides()
    {
        var g = Valid(g => g with { Participants = g.Participants.Select((p, i) => i == 6 ? p with { PlayerId = _players[0] } : p).ToList() });
        Assert.Contains(Check(g), e => e.Code == "game.duplicatePlayer");
    }

    [Fact]
    public void Rule3_participants_must_be_checked_in()
    {
        Assert.Contains(Check(Valid(), _players.Take(11)), e => e.Code == "game.playerNotInSession");
    }

    [Theory]
    [InlineData(15, 15, "game.tie")]
    [InlineData(-1, 15, "game.negativeScore")]
    [InlineData(15, 100, "game.scoreTooHigh")]
    public void Rule4_scores(int a, int b, string code) =>
        Assert.Contains(Check(Valid(g => g with { ScoreA = a, ScoreB = b })), e => e.Code == code);

    [Fact]
    public void Rule4_deuce_scores_are_fine() => Assert.Empty(Check(Valid(g => g with { ScoreA = 17, ScoreB = 19 })));

    [Fact]
    public void Rule5_mvp_must_be_participant() =>
        Assert.Contains(Check(Valid(g => g with { MvpPlayerId = _players[12] })), e => e.Code == "game.mvpNotParticipant");

    [Fact]
    public void Teams_must_differ_and_belong_to_session()
    {
        Assert.Contains(Check(Valid(g => g with { TeamBId = _teamA })), e => e.Code == "game.sameTeam");
        Assert.Contains(Check(Valid(g => g with { TeamBId = Guid.NewGuid() })), e => e.Code == "game.unknownTeam");
    }

    [Fact]
    public void Each_side_must_fill_the_position_template()
    {
        var g = Valid(g => g with { Participants = g.Participants.Select((p, i) => i == 0 ? p with { Position = 2 } : p).ToList() });
        Assert.Contains(Check(g), e => e.Code == "game.templateMismatch");
        var shortSide = Valid(g => g with { Participants = g.Participants.Skip(1).ToList(), MvpPlayerId = _players[1] });
        Assert.Contains(Check(shortSide), e => e.Code == "game.templateMismatch");
    }
}

public class RosterValidationTests
{
    readonly GroupSettings _s = GroupSettings.Default;
    readonly List<Guid> _players = Enumerable.Range(0, 20).Select(_ => Guid.NewGuid()).ToList();
    readonly List<RosterTeam> _teams = [new(Guid.NewGuid(), "الأزرق", "a"), new(Guid.NewGuid(), "البرتقالي", "b"), new(Guid.NewGuid(), "البنفسجي", "c")];

    RosterInput Valid()
    {
        var entries = new List<RosterEntry>();
        for (var i = 0; i < 18; i++) entries.Add(new RosterEntry(_players[i], _teams[i / 6].Id, i % 6 + 1, false));
        entries.Add(new RosterEntry(_players[18], _teams[0].Id, null, true));
        entries.Add(new RosterEntry(_players[19], null, null, true));
        return new RosterInput(_teams, entries);
    }

    List<ValidationError> Check(RosterInput r, ISet<Guid>? withGames = null) =>
        Validators.ValidateRoster(r, _s, _players.ToHashSet(), withGames ?? new HashSet<Guid>());

    [Fact] public void Valid_roster_passes() => Assert.Empty(Check(Valid()));

    [Fact]
    public void Checkin_only_roster_passes()
    {
        var r = new RosterInput([], _players.Select(p => new RosterEntry(p, null, null, false)).ToList());
        Assert.Empty(Check(r));
    }

    [Fact]
    public void Rule1_player_on_at_most_one_team()
    {
        var r = Valid();
        r = r with { Players = [.. r.Players, new RosterEntry(_players[0], _teams[1].Id, 1, false)] };
        Assert.Contains(Check(r), e => e.Code == "roster.duplicatePlayer");
    }

    [Fact]
    public void Active_players_must_be_teams_times_template()
    {
        var r = Valid();
        // Move one player from team 3 to the bench → 17 active.
        r = r with { Players = r.Players.Select((p, i) => i == 17 ? p with { IsBench = true, Position = null } : p).ToList() };
        var errs = Check(r);
        Assert.Contains(errs, e => e.Code == "roster.activeCount");
        Assert.Contains(errs, e => e.Code == "roster.templateMismatch");
    }

    [Fact]
    public void Team_count_must_be_allowed()
    {
        var one = new RosterInput([_teams[0]], _players.Take(6).Select((p, i) => new RosterEntry(p, _teams[0].Id, i + 1, false)).ToList());
        Assert.Contains(Check(one), e => e.Code == "roster.teamCount");
    }

    [Fact]
    public void Players_with_games_cannot_be_removed()
    {
        var r = Valid();
        r = r with { Players = r.Players.Where(p => p.PlayerId != _players[19]).ToList() };
        Assert.Contains(Check(r, new HashSet<Guid> { _players[19] }), e => e.Code == "roster.playerHasGames");
    }

    [Fact]
    public void Team_colours_must_be_distinct()
    {
        var r = Valid();
        r = r with { Teams = [_teams[0], _teams[1], _teams[2] with { Color = "a" }] };
        Assert.Contains(Check(r), e => e.Code == "team.colorDuplicate");
    }

    [Fact]
    public void Player_validation()
    {
        Assert.Contains(Validators.ValidatePlayer(" ", 3), e => e.Code == "player.nameRequired");
        Assert.Contains(Validators.ValidatePlayer("محمد", 7), e => e.Code == "position.invalid");
        Assert.Empty(Validators.ValidatePlayer("محمد", 6));
    }
}
