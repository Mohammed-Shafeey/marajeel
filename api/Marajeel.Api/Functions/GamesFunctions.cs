using System.Net;
using Marajeel.Core.Data;
using Marajeel.Core.Domain;
using Marajeel.Core.Validation;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Marajeel.Api.Functions;

public record GameRequest(Guid SessionId, Guid TeamAId, Guid TeamBId, int ScoreA, int ScoreB, Guid MvpPlayerId,
    DateTimeOffset? PlayedAt, IReadOnlyList<GameParticipantInput> Participants);

public class GamesFunctions(MarajeelDb db, SettingsStore settings, ILogger<GamesFunctions> log)
{
    /// <summary>
    /// Idempotent upsert keyed by the client-generated id: replaying a queued offline submission is safe.
    /// Derived stats are recomputed from the full history on read, so nothing else needs updating.
    /// </summary>
    [Function("games-put")]
    public Task<HttpResponseData> Put([HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "games/{id:guid}")] HttpRequestData req, Guid id) =>
        req.Handle(log, admin: true, async () =>
        {
            var body = await req.Body<GameRequest>();
            var input = new GameInput(id, body.SessionId, body.TeamAId, body.TeamBId, body.ScoreA, body.ScoreB, body.MvpPlayerId, body.Participants ?? []);

            var session = await db.Sessions.AsNoTracking().Include(s => s.Teams).Include(s => s.Players)
                .FirstOrDefaultAsync(s => s.Id == body.SessionId) ?? throw Http.NotFound("session");
            Http.ThrowIfInvalid(Validators.ValidateGame(input, await settings.GetAsync(),
                session.Teams.Select(t => t.Id).ToHashSet(), session.Players.Select(p => p.PlayerId).ToHashSet()));

            var game = await db.Games.Include(g => g.Participants).FirstOrDefaultAsync(g => g.Id == id);
            var created = game is null;
            if (game is null)
            {
                game = new Game { Id = id, CreatedAt = DateTimeOffset.UtcNow, PlayedAt = body.PlayedAt ?? DateTimeOffset.UtcNow };
                db.Games.Add(game);
            }
            else
            {
                if (game.SessionId != body.SessionId)
                    throw new ApiException(HttpStatusCode.Conflict, "game.sessionMismatch", "A game can't be moved to another session.");
                if (body.PlayedAt is { } at) game.PlayedAt = at;
            }

            game.SessionId = body.SessionId;
            game.TeamAId = body.TeamAId;
            game.TeamBId = body.TeamBId;
            game.ScoreA = body.ScoreA;
            game.ScoreB = body.ScoreB;
            game.MvpPlayerId = body.MvpPlayerId;

            // Diff participants (same composite key can't be removed and re-added in one unit of work).
            var wanted = input.Participants.ToDictionary(p => p.PlayerId);
            foreach (var existing in game.Participants.ToList())
            {
                if (wanted.Remove(existing.PlayerId, out var w)) { existing.Side = w.Side; existing.Position = w.Position; }
                else { game.Participants.Remove(existing); db.GameParticipants.Remove(existing); }
            }
            game.Participants.AddRange(wanted.Values.Select(p => new GameParticipant { GameId = id, PlayerId = p.PlayerId, Side = p.Side, Position = p.Position }));

            try { await db.SaveChangesAsync(); }
            catch (DbUpdateException) when (created)
            {
                // Two retries of the same offline submission raced; the other one won. Treat as success.
                db.ChangeTracker.Clear();
            }
            var saved = await db.Games.AsNoTracking().Include(g => g.Participants).FirstAsync(g => g.Id == id);
            return await req.Ok(GameDto.From(saved), created ? HttpStatusCode.Created : HttpStatusCode.OK);
        });

    /// <summary>All games with lineups, oldest first (public; used for CSV export).</summary>
    [Function("games-list")]
    public Task<HttpResponseData> List([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "games")] HttpRequestData req) =>
        req.Handle(log, admin: false, async () =>
            await req.Ok((await db.Games.AsNoTracking().Include(g => g.Participants).AsSplitQuery()
                .OrderBy(g => g.PlayedAt).ThenBy(g => g.CreatedAt).ToListAsync()).Select(GameDto.From)));

    [Function("games-delete")]
    public Task<HttpResponseData> Delete([HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "games/{id:guid}")] HttpRequestData req, Guid id) =>
        req.Handle(log, admin: true, async () =>
        {
            var game = await db.Games.Include(g => g.Participants).FirstOrDefaultAsync(g => g.Id == id);
            if (game is not null)
            {
                db.Games.Remove(game);
                await db.SaveChangesAsync();
            }
            return req.NoContent();
        });
}
