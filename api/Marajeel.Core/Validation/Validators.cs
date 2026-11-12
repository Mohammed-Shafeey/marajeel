using Marajeel.Core.Domain;

namespace Marajeel.Core.Validation;

/// <summary>
/// A validation problem. <see cref="Code"/> is stable and translated by the client;
/// <see cref="Message"/> is an English fallback for API consumers.
/// </summary>
public record ValidationError(string Code, string Message, IReadOnlyDictionary<string, object?>? Params = null);

public class ValidationException(IReadOnlyList<ValidationError> errors) : Exception(string.Join("; ", errors.Select(e => e.Message)))
{
    public IReadOnlyList<ValidationError> Errors { get; } = errors;
}

public record RosterEntry(Guid PlayerId, Guid? TeamId, int? Position, bool IsBench);
public record RosterTeam(Guid Id, string Label, string Color);
public record RosterInput(IReadOnlyList<RosterTeam> Teams, IReadOnlyList<RosterEntry> Players);

public record GameInput(
    Guid Id, Guid SessionId, Guid TeamAId, Guid TeamBId, int ScoreA, int ScoreB, Guid MvpPlayerId,
    IReadOnlyList<GameParticipantInput> Participants);
public record GameParticipantInput(Guid PlayerId, char Side, int Position);

public static class Validators
{
    static readonly HashSet<string> TeamColors = ["a", "b", "c", "d"];

    static ValidationError E(string code, string msg, params (string k, object? v)[] p) =>
        new(code, msg, p.Length == 0 ? null : p.ToDictionary(x => x.k, x => x.v));

    public static List<ValidationError> ValidatePlayer(string? name, int preferredPosition)
    {
        var errs = new List<ValidationError>();
        if (string.IsNullOrWhiteSpace(name)) errs.Add(E("player.nameRequired", "Name is required."));
        else if (name.Trim().Length > 80) errs.Add(E("player.nameTooLong", "Name must be at most 80 characters.", ("max", 80)));
        if (!Positions.IsValid(preferredPosition))
            errs.Add(E("position.invalid", $"Position {preferredPosition} is not valid (1–6).", ("position", preferredPosition)));
        return errs;
    }

    /// <summary>
    /// Validates a session roster (check-in + base lineup).
    /// <paramref name="playersWithGames"/> = players who already appear in a game of this session;
    /// they can't be checked out (rule 3 would break for the existing game).
    /// </summary>
    public static List<ValidationError> ValidateRoster(
        RosterInput roster, GroupSettings s, ISet<Guid> knownPlayerIds, ISet<Guid> playersWithGames,
        ISet<Guid>? teamsUsedByGames = null)
    {
        var errs = new List<ValidationError>();

        // Rule 1: a player appears at most once (→ at most one team).
        foreach (var dup in roster.Players.GroupBy(p => p.PlayerId).Where(g => g.Count() > 1))
            errs.Add(E("roster.duplicatePlayer", "A player can be on at most one team in a session.", ("playerId", dup.Key)));

        foreach (var p in roster.Players.Where(p => !knownPlayerIds.Contains(p.PlayerId)))
            errs.Add(E("player.notFound", "Unknown player.", ("playerId", p.PlayerId)));

        var inRoster = roster.Players.Select(p => p.PlayerId).ToHashSet();
        foreach (var missing in playersWithGames.Where(id => !inRoster.Contains(id)))
            errs.Add(E("roster.playerHasGames", "This player already played a game in this session and can't be removed.", ("playerId", missing)));

        var teamIds = roster.Teams.Select(t => t.Id).ToHashSet();
        if (teamIds.Count != roster.Teams.Count) errs.Add(E("roster.duplicateTeam", "Duplicate team id."));
        foreach (var t in roster.Teams)
        {
            if (string.IsNullOrWhiteSpace(t.Label)) errs.Add(E("team.labelRequired", "Team name is required.", ("teamId", t.Id)));
            if (!TeamColors.Contains(t.Color)) errs.Add(E("team.colorInvalid", "Team colour must be one of a, b, c, d.", ("teamId", t.Id)));
        }
        if (roster.Teams.Select(t => t.Color).Distinct().Count() != roster.Teams.Count)
            errs.Add(E("team.colorDuplicate", "Each team needs a distinct colour."));

        foreach (var used in (teamsUsedByGames ?? new HashSet<Guid>()).Where(id => !teamIds.Contains(id)))
            errs.Add(E("roster.teamHasGames", "This team has recorded games and can't be removed.", ("teamId", used)));

        foreach (var p in roster.Players)
        {
            if (p.TeamId is { } tid && !teamIds.Contains(tid))
                errs.Add(E("roster.unknownTeam", "Player assigned to an unknown team.", ("playerId", p.PlayerId)));
            if (p.IsBench && p.Position is not null)
                errs.Add(E("roster.benchHasPosition", "Bench players don't have a position.", ("playerId", p.PlayerId)));
            if (p.Position is { } pos && !Positions.IsValid(pos))
                errs.Add(E("position.invalid", $"Position {pos} is not valid (1–6).", ("position", pos)));
        }

        if (roster.Teams.Count == 0)
        {
            // Check-in only: nobody may be on a team or in a position yet.
            if (roster.Players.Any(p => p.TeamId is not null || p.Position is not null))
                errs.Add(E("roster.noTeams", "Create teams before assigning players."));
            return errs;
        }

        if (!s.AllowedTeamCounts.Contains(roster.Teams.Count))
            errs.Add(E("roster.teamCount", $"A session needs {string.Join(" or ", s.AllowedTeamCounts)} teams.",
                ("allowed", s.AllowedTeamCounts)));

        // With teams: every checked-in player is either playing (team + position) or on the bench.
        foreach (var p in roster.Players.Where(p => !p.IsBench && (p.TeamId is null || p.Position is null)))
            errs.Add(E("roster.unassigned", "Every checked-in player must be on a team or on the bench.", ("playerId", p.PlayerId)));

        var active = roster.Players.Where(p => !p.IsBench).ToList();
        var expected = roster.Teams.Count * s.TeamSize;
        if (active.Count != expected)
            errs.Add(E("roster.activeCount", $"Exactly {expected} players must be playing ({active.Count} now); bench the rest.",
                ("expected", expected), ("actual", active.Count)));

        foreach (var t in roster.Teams)
        {
            var positions = active.Where(p => p.TeamId == t.Id && p.Position is not null).Select(p => p.Position!.Value);
            if (!SameMultiset(positions, s.PositionTemplate))
                errs.Add(E("roster.templateMismatch", $"Team {t.Label} must fill positions {string.Join(",", s.PositionTemplate.Order())}.",
                    ("teamId", t.Id), ("template", s.PositionTemplate)));
        }
        return errs;
    }

    /// <summary>Validates a game. <paramref name="sessionPlayerIds"/> = players checked into the game's session (rule 3).</summary>
    public static List<ValidationError> ValidateGame(GameInput g, GroupSettings s, ISet<Guid> sessionTeamIds, ISet<Guid> sessionPlayerIds)
    {
        var errs = new List<ValidationError>();
        if (g.Id == Guid.Empty) errs.Add(E("game.idRequired", "Game id is required."));

        if (g.TeamAId == g.TeamBId) errs.Add(E("game.sameTeam", "Choose two different teams."));
        if (!sessionTeamIds.Contains(g.TeamAId) || !sessionTeamIds.Contains(g.TeamBId))
            errs.Add(E("game.unknownTeam", "Both teams must belong to this session."));

        // Rule 4: non-negative integers, no ties.
        if (g.ScoreA < 0 || g.ScoreB < 0) errs.Add(E("game.negativeScore", "Scores can't be negative."));
        if (g.ScoreA > 99 || g.ScoreB > 99) errs.Add(E("game.scoreTooHigh", "Scores must be below 100."));
        if (g.ScoreA == g.ScoreB) errs.Add(E("game.tie", "A game can't end in a tie."));

        // Rule 2: no duplicates across both sides.
        foreach (var dup in g.Participants.GroupBy(p => p.PlayerId).Where(x => x.Count() > 1))
            errs.Add(E("game.duplicatePlayer", "A player can appear only once in a game.", ("playerId", dup.Key)));

        // Rule 3: participants must be checked into the session.
        foreach (var p in g.Participants.Where(p => !sessionPlayerIds.Contains(p.PlayerId)))
            errs.Add(E("game.playerNotInSession", "Every player must be checked into this session.", ("playerId", p.PlayerId)));

        foreach (var p in g.Participants)
        {
            if (p.Side is not ('A' or 'B')) errs.Add(E("game.sideInvalid", "Side must be A or B.", ("playerId", p.PlayerId)));
            if (!Positions.IsValid(p.Position)) errs.Add(E("position.invalid", $"Position {p.Position} is not valid (1–6).", ("position", p.Position)));
        }
        foreach (var side in new[] { 'A', 'B' })
        {
            var pos = g.Participants.Where(p => p.Side == side).Select(p => p.Position);
            if (!SameMultiset(pos, s.PositionTemplate))
                errs.Add(E("game.templateMismatch", $"Side {side} must fill positions {string.Join(",", s.PositionTemplate.Order())}.",
                    ("side", side.ToString()), ("template", s.PositionTemplate)));
        }

        // Rule 5: MVP must have played.
        if (!g.Participants.Any(p => p.PlayerId == g.MvpPlayerId))
            errs.Add(E("game.mvpNotParticipant", "The MVP must be one of this game's players."));

        return errs;
    }

    static bool SameMultiset(IEnumerable<int> a, IEnumerable<int> b) =>
        a.Order().SequenceEqual(b.Order());
}
