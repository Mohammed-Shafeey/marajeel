using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Azure.Storage.Blobs;
using Marajeel.Core.Data;
using Marajeel.Core.Domain;
using Marajeel.Core.Validation;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Marajeel.Api;

public static class Json
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };
}

/// <summary>Thrown inside handlers to produce a clean 4xx response.</summary>
public class ApiException(HttpStatusCode status, string code, string message) : Exception(message)
{
    public HttpStatusCode Status { get; } = status;
    public string Code { get; } = code;
}

/// <summary>
/// Static Web Apps injects the signed-in user as base64 JSON in <c>x-ms-client-principal</c>.
/// SWA strips this header from incoming client requests, so only the platform can set it.
/// </summary>
public record ClientPrincipal(string? IdentityProvider, string? UserId, string? UserDetails, string[] UserRoles)
{
    public bool IsAdmin => UserRoles.Contains("admin", StringComparer.OrdinalIgnoreCase);

    public static ClientPrincipal? From(HttpRequestData req)
    {
        if (!req.Headers.TryGetValues("x-ms-client-principal", out var values)) return null;
        try
        {
            var json = Encoding.UTF8.GetString(Convert.FromBase64String(values.First()));
            return JsonSerializer.Deserialize<ClientPrincipal>(json, Json.Options) is { } p
                ? p with { UserRoles = p.UserRoles ?? [] } : null;
        }
        catch { return null; }
    }
}

public static class Http
{
    public static async Task<HttpResponseData> Ok(this HttpRequestData req, object? body, HttpStatusCode status = HttpStatusCode.OK)
    {
        var res = req.CreateResponse(status);
        res.Headers.Add("Content-Type", "application/json; charset=utf-8");
        res.Headers.Add("Cache-Control", "no-store");
        await res.WriteStringAsync(JsonSerializer.Serialize(body, Json.Options));
        return res;
    }

    public static Task<HttpResponseData> Error(this HttpRequestData req, HttpStatusCode status, string code, string message, object? errors = null) =>
        req.Ok(new { error = code, message, errors }, status);

    public static HttpResponseData NoContent(this HttpRequestData req) => req.CreateResponse(HttpStatusCode.NoContent);

    public static async Task<T> Body<T>(this HttpRequestData req)
    {
        try
        {
            return await JsonSerializer.DeserializeAsync<T>(req.Body, Json.Options)
                   ?? throw new ApiException(HttpStatusCode.BadRequest, "request.emptyBody", "Request body is required.");
        }
        catch (JsonException e)
        {
            throw new ApiException(HttpStatusCode.BadRequest, "request.invalidJson", $"Invalid JSON: {e.Message}");
        }
    }

    /// <summary>
    /// Wraps a handler: enforces the admin role for writes (server-side, not just hidden in the UI),
    /// maps validation and API exceptions to clear JSON errors.
    /// </summary>
    public static async Task<HttpResponseData> Handle(this HttpRequestData req, ILogger log, bool admin, Func<Task<HttpResponseData>> handler)
    {
        if (admin)
        {
            var principal = ClientPrincipal.From(req);
            if (principal is null) return await req.Error(HttpStatusCode.Unauthorized, "auth.required", "Sign in as an admin to make changes.");
            if (!principal.IsAdmin) return await req.Error(HttpStatusCode.Forbidden, "auth.forbidden", "Only admins can make changes.");
        }
        try { return await handler(); }
        catch (ValidationException v) { return await req.Error(HttpStatusCode.BadRequest, "validation", v.Message, v.Errors); }
        catch (ApiException a) { return await req.Error(a.Status, a.Code, a.Message); }
        catch (DbUpdateConcurrencyException) { return await req.Error(HttpStatusCode.Conflict, "conflict", "The data changed meanwhile; reload and try again."); }
        catch (Exception e)
        {
            log.LogError(e, "Unhandled error");
            return await req.Error(HttpStatusCode.InternalServerError, "server.error", "Something went wrong on the server.");
        }
    }

    public static void ThrowIfInvalid(IReadOnlyList<ValidationError> errors)
    {
        if (errors.Count > 0) throw new ValidationException(errors);
    }

    public static ApiException NotFound(string what) => new(HttpStatusCode.NotFound, $"{what}.notFound", $"{what} not found.");
}

public class SettingsStore(MarajeelDb db)
{
    public async Task<GroupSettings> GetAsync()
    {
        var row = await db.Settings.AsNoTracking().FirstOrDefaultAsync(x => x.Id == 1);
        if (row is null) return GroupSettings.Default;
        try { return JsonSerializer.Deserialize<GroupSettings>(row.Json, Json.Options) ?? GroupSettings.Default; }
        catch { return GroupSettings.Default; }
    }

    public async Task SaveAsync(GroupSettings s)
    {
        var row = await db.Settings.FirstOrDefaultAsync(x => x.Id == 1);
        if (row is null) db.Settings.Add(row = new AppSettingsRow { Id = 1 });
        row.Json = JsonSerializer.Serialize(s, Json.Options);
        row.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync();
    }
}

/// <summary>Applies EF migrations and creates the photo container on startup, in the background.</summary>
public class StartupTasks(IServiceProvider sp, ILogger<StartupTasks> log) : IHostedService
{
    public Task StartAsync(CancellationToken ct)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = sp.CreateScope();
                await scope.ServiceProvider.GetRequiredService<MarajeelDb>().Database.MigrateAsync(ct);
                log.LogInformation("Database migrated");
            }
            catch (Exception e) { log.LogError(e, "Database migration failed"); }
            try { await sp.GetRequiredService<BlobContainerClient>().CreateIfNotExistsAsync(cancellationToken: ct); }
            catch (Exception e) { log.LogError(e, "Blob container setup failed"); }
        }, ct);
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}
