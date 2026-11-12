using System.Net;
using Marajeel.Core.Analytics;
using Marajeel.Core.Data;
using Marajeel.Core.Domain;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Marajeel.Api.Functions;

public class AnalyticsFunctions(MarajeelDb db, SettingsStore settings, ILogger<AnalyticsFunctions> log)
{
    /// <summary>
    /// Every derived number (ratings, positions, chemistry, streaks, head-to-head) recomputed from the full
    /// game history on each read. Optional <c>from</c>/<c>to</c> (ISO dates) limit the counting stats
    /// to a window, e.g. "this month"; ratings always come from the full history.
    /// </summary>
    [Function("analytics")]
    public Task<HttpResponseData> Get([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "analytics")] HttpRequestData req) =>
        req.Handle(log, admin: false, async () =>
        {
            var q = System.Web.HttpUtility.ParseQueryString(req.Url.Query);
            var from = ParseDate(q["from"], "from");
            var to = ParseDate(q["to"], "to");

            var players = await db.Players.AsNoTracking().Select(p => p.Id).ToListAsync();
            var games = await db.Games.AsNoTracking().Include(g => g.Participants).AsSplitQuery().ToListAsync();
            var records = games.Select(g => new GameRecord(g.Id, g.SessionId, g.PlayedAt, g.CreatedAt, g.ScoreA, g.ScoreB, g.MvpPlayerId,
                g.Participants.Select(p => new ParticipantRecord(p.PlayerId, p.Side, p.Position)).ToList()));

            var result = AnalyticsEngine.Compute(players, records, await settings.GetAsync(), from, to);
            return await req.Ok(result);
        });

    [Function("settings-get")]
    public Task<HttpResponseData> GetSettings([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "settings")] HttpRequestData req) =>
        req.Handle(log, admin: false, async () => await req.Ok(await settings.GetAsync()));

    [Function("settings-put")]
    public Task<HttpResponseData> PutSettings([HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "settings")] HttpRequestData req) =>
        req.Handle(log, admin: true, async () =>
        {
            var s = await req.Body<GroupSettings>();
            var errs = new List<Core.Validation.ValidationError>();
            if (s.PositionTemplate is null || s.PositionTemplate.Length is < 2 or > 6 || s.PositionTemplate.Any(p => !Positions.IsValid(p)))
                errs.Add(new("settings.template", "The position template needs 2–6 positions, each between 1 and 6."));
            if (s.AllowedTeamCounts is null || s.AllowedTeamCounts.Length == 0 || s.AllowedTeamCounts.Any(c => c is < 2 or > 4))
                errs.Add(new("settings.teamCounts", "Allowed team counts must be between 2 and 4."));
            if (s.TargetScore is < 5 or > 50) errs.Add(new("settings.targetScore", "Target score must be between 5 and 50."));
            if (s.ProvisionalGames is < 1 or > 50 || s.MinPositionGames is < 1 or > 50 || s.MinChemistryGames is < 1 or > 50)
                errs.Add(new("settings.thresholds", "Game thresholds must be between 1 and 50."));
            if (s.GoldThreshold is < 1 or > 100 || s.SilverThreshold is < 1 or > 100 || s.SilverThreshold >= s.GoldThreshold)
                errs.Add(new("settings.tiers", "Card thresholds must be 1–100, silver below gold."));
            Http.ThrowIfInvalid(errs);
            await settings.SaveAsync(s);
            return await req.Ok(s);
        });

    [Function("me")]
    public async Task<HttpResponseData> Me([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "me")] HttpRequestData req)
    {
        var p = ClientPrincipal.From(req);
        return await req.Ok(new { signedIn = p is not null, isAdmin = p?.IsAdmin ?? false, name = p?.UserDetails });
    }

    static DateTimeOffset? ParseDate(string? s, string name) =>
        string.IsNullOrEmpty(s) ? null
        : DateTimeOffset.TryParse(s, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AssumeUniversal, out var d) ? d
        : throw new ApiException(HttpStatusCode.BadRequest, "request.invalidDate", $"'{name}' must be an ISO date.");
}
