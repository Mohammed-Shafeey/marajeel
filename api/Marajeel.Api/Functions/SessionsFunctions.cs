using System.Net;
using Marajeel.Core.Data;
using Marajeel.Core.Domain;
using Marajeel.Core.Validation;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Marajeel.Api.Functions;

public record SessionSummaryDto(Guid Id, DateOnly Date, string? Notes, SessionStatus Status, int PlayerCount, int BenchCount, int TeamCount, int GameCount);
public record TeamDto(Guid Id, string Label, string Color, int SortOrder);
public record RosterPlayerDto(Guid PlayerId, Guid? TeamId, int? Position, bool IsBench);
public record ParticipantDto(Guid PlayerId, char Side, int Position);
public record GameDto(Guid Id, Guid SessionId, Guid TeamAId, Guid TeamBId, int ScoreA, int ScoreB, Guid MvpPlayerId, DateTimeOffset PlayedAt, IReadOnlyList<ParticipantDto> Participants)
{
    public static GameDto From(Game g) => new(g.Id, g.SessionId, g.TeamAId, g.TeamBId, g.ScoreA, g.ScoreB, g.MvpPlayerId, g.PlayedAt,
        g.Participants.OrderBy(p => p.Side).ThenBy(p => p.Position).Select(p => new ParticipantDto(p.PlayerId, p.Side, p.Position)).ToList());
}
public record SessionDetailDto(Guid Id, DateOnly Date, string? Notes, SessionStatus Status, IReadOnlyList<TeamDto> Teams,
    IReadOnlyList<RosterPlayerDto> Players, IReadOnlyList<GameDto> Games);

public record SessionInput(DateOnly Date, string? Notes, SessionStatus? Status);

public class SessionsFunctions(MarajeelDb db, SettingsStore settings, ILogger<SessionsFunctions> log)
{
    [Function("sessions-list")]
    public Task<HttpResponseData> List([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "sessions")] HttpRequestData req) =>
        req.Handle(log, admin: false, async () =>
            await req.Ok(await db.Sessions.AsNoTracking().OrderByDescending(s => s.Date).ThenByDescending(s => s.CreatedAt)
                .Select(s => new SessionSummaryDto(s.Id, s.Date, s.Notes, s.Status,
                    s.Players.Count(p => !p.IsBench), s.Players.Count(p => p.IsBench), s.Teams.Count, s.Games.Count))
                .ToListAsync()));

    [Function("sessions-get")]
    public Task<HttpResponseData> Get([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "sessions/{id:guid}")] HttpRequestData req, Guid id) =>
        req.Handle(log, admin: false, async () => await req.Ok(await LoadDetail(id)));

    [Function("sessions-create")]
    public Task<HttpResponseData> Create([HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "sessions")] HttpRequestData req) =>
        req.Handle(log, admin: true, async () =>
        {
            var input = await req.Body<SessionInput>();
            ValidateSession(input);
            var s = new Session { Id = Guid.NewGuid(), Date = input.Date, Notes = input.Notes?.Trim(), Status = SessionStatus.Open, CreatedAt = DateTimeOffset.UtcNow };
            db.Sessions.Add(s);
            await db.SaveChangesAsync();
            return await req.Ok(await LoadDetail(s.Id), HttpStatusCode.Created);
        });

    [Function("sessions-update")]
    public Task<HttpResponseData> Update([HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "sessions/{id:guid}")] HttpRequestData req, Guid id) =>
        req.Handle(log, admin: true, async () =>
        {
            var input = await req.Body<SessionInput>();
            ValidateSession(input);
            var s = await db.Sessions.FindAsync(id) ?? throw Http.NotFound("session");
            s.Date = input.Date;
            s.Notes = input.Notes?.Trim();
            if (input.Status is { } st) s.Status = st;
            await db.SaveChangesAsync();
            return await req.Ok(await LoadDetail(id));
        });

    [Function("sessions-delete")]
    public Task<HttpResponseData> Delete([HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "sessions/{id:guid}")] HttpRequestData req, Guid id) =>
        req.Handle(log, admin: true, async () =>
        {
            var s = await db.Sessions.Include(x => x.Games).ThenInclude(g => g.Participants)
                .Include(x => x.Players).Include(x => x.Teams).FirstOrDefaultAsync(x => x.Id == id);
            if (s is null) return req.NoContent();
            db.GameParticipants.RemoveRange(s.Games.SelectMany(g => g.Participants));
            db.Games.RemoveRange(s.Games);
            db.SessionPlayers.RemoveRange(s.Players);
            await db.SaveChangesAsync();
            db.SessionTeams.RemoveRange(s.Teams);
            db.Sessions.Remove(s);
            await db.SaveChangesAsync();
            return req.NoContent();
        });

    /// <summary>
    /// Replaces the session roster: who is checked in, the teams, and the base lineup (team + position or bench).
    /// With no teams this is plain check-in.
    /// </summary>
    [Function("sessions-roster")]
    public Task<HttpResponseData> Roster([HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "sessions/{id:guid}/roster")] HttpRequestData req, Guid id) =>
        req.Handle(log, admin: true, async () =>
        {
            var input = await req.Body<RosterInput>();
            input = input with { Teams = input.Teams ?? [], Players = input.Players ?? [] };
            var s = await db.Sessions.Include(x => x.Teams).Include(x => x.Players).FirstOrDefaultAsync(x => x.Id == id)
                    ?? throw Http.NotFound("session");

            var games = await db.Games.Where(g => g.SessionId == id).Include(g => g.Participants).ToListAsync();
            var withGames = games.SelectMany(g => g.Participants.Select(p => p.PlayerId)).ToHashSet();
            var teamsUsed = games.SelectMany(g => new[] { g.TeamAId, g.TeamBId }).ToHashSet();
            var known = (await db.Players.Select(p => p.Id).ToListAsync()).ToHashSet();
            var errors = Validators.ValidateRoster(input, await settings.GetAsync(), known, withGames, teamsUsed);
            // Team ids must be new or belong to this session.
            var otherSessionTeam = await db.SessionTeams.AnyAsync(t => t.SessionId != id && input.Teams.Select(x => x.Id).Contains(t.Id));
            if (otherSessionTeam) errors.Add(new ValidationError("roster.unknownTeam", "Team belongs to another session."));
            Http.ThrowIfInvalid(errors);

            await using var tx = await db.Database.BeginTransactionAsync();
            db.SessionPlayers.RemoveRange(s.Players);
            await db.SaveChangesAsync();

            var inputTeamIds = input.Teams.Select(t => t.Id).ToHashSet();
            db.SessionTeams.RemoveRange(s.Teams.Where(t => !inputTeamIds.Contains(t.Id)));
            for (var i = 0; i < input.Teams.Count; i++)
            {
                var t = input.Teams[i];
                var existing = s.Teams.FirstOrDefault(x => x.Id == t.Id);
                if (existing is null) db.SessionTeams.Add(new SessionTeam { Id = t.Id, SessionId = id, Label = t.Label.Trim(), Color = t.Color, SortOrder = i });
                else { existing.Label = t.Label.Trim(); existing.Color = t.Color; existing.SortOrder = i; }
            }
            await db.SaveChangesAsync();

            var now = DateTimeOffset.UtcNow;
            db.SessionPlayers.AddRange(input.Players.Select(p => new SessionPlayer
            {
                SessionId = id, PlayerId = p.PlayerId, TeamId = p.TeamId, Position = p.IsBench ? null : p.Position,
                IsBench = p.IsBench, CheckedInAt = now,
            }));
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return await req.Ok(await LoadDetail(id));
        });

    async Task<SessionDetailDto> LoadDetail(Guid id)
    {
        var s = await db.Sessions.AsNoTracking()
            .Include(x => x.Teams).Include(x => x.Players).Include(x => x.Games).ThenInclude(g => g.Participants)
            .AsSplitQuery().FirstOrDefaultAsync(x => x.Id == id) ?? throw Http.NotFound("session");
        return new SessionDetailDto(s.Id, s.Date, s.Notes, s.Status,
            s.Teams.OrderBy(t => t.SortOrder).Select(t => new TeamDto(t.Id, t.Label, t.Color, t.SortOrder)).ToList(),
            s.Players.Select(p => new RosterPlayerDto(p.PlayerId, p.TeamId, p.Position, p.IsBench)).ToList(),
            s.Games.OrderBy(g => g.PlayedAt).ThenBy(g => g.CreatedAt).Select(GameDto.From).ToList());
    }

    static void ValidateSession(SessionInput input)
    {
        var errs = new List<ValidationError>();
        if (input.Date == default) errs.Add(new("session.dateRequired", "Date is required."));
        if (input.Notes?.Length > 500) errs.Add(new("session.notesTooLong", "Notes must be at most 500 characters."));
        Http.ThrowIfInvalid(errs);
    }
}
