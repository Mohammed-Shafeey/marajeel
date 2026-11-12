using System.Net;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Marajeel.Core.Data;
using Marajeel.Core.Domain;
using Marajeel.Core.Validation;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Marajeel.Api.Functions;

public record PlayerDto(Guid Id, string Name, string? ShortName, string? PhotoUrl, int PreferredPosition, bool IsActive, DateTimeOffset CreatedAt)
{
    public static PlayerDto From(Player p) => new(p.Id, p.Name, p.ShortName,
        p.PhotoVersion is { } v ? $"/api/photos/{p.Id}-{v}" : null, p.PreferredPosition, p.IsActive, p.CreatedAt);
}

public record PlayerInput(string Name, string? ShortName, int PreferredPosition, bool? IsActive);

public class PlayersFunctions(MarajeelDb db, BlobContainerClient photos, ILogger<PlayersFunctions> log)
{
    const int MaxPhotoBytes = 1_000_000;

    [Function("players-list")]
    public Task<HttpResponseData> List([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "players")] HttpRequestData req) =>
        req.Handle(log, admin: false, async () =>
            await req.Ok((await db.Players.AsNoTracking().OrderBy(p => p.Name).ToListAsync()).Select(PlayerDto.From)));

    [Function("players-create")]
    public Task<HttpResponseData> Create([HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "players")] HttpRequestData req) =>
        req.Handle(log, admin: true, async () =>
        {
            var input = await req.Body<PlayerInput>();
            Http.ThrowIfInvalid(Validators.ValidatePlayer(input.Name, input.PreferredPosition));
            var p = new Player
            {
                Id = Guid.NewGuid(), Name = input.Name.Trim(), ShortName = Clean(input.ShortName),
                PreferredPosition = input.PreferredPosition, IsActive = input.IsActive ?? true, CreatedAt = DateTimeOffset.UtcNow,
            };
            db.Players.Add(p);
            await db.SaveChangesAsync();
            return await req.Ok(PlayerDto.From(p), HttpStatusCode.Created);
        });

    [Function("players-update")]
    public Task<HttpResponseData> Update([HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "players/{id:guid}")] HttpRequestData req, Guid id) =>
        req.Handle(log, admin: true, async () =>
        {
            var input = await req.Body<PlayerInput>();
            Http.ThrowIfInvalid(Validators.ValidatePlayer(input.Name, input.PreferredPosition));
            var p = await db.Players.FindAsync(id) ?? throw Http.NotFound("player");
            p.Name = input.Name.Trim();
            p.ShortName = Clean(input.ShortName);
            p.PreferredPosition = input.PreferredPosition;
            if (input.IsActive is { } active) p.IsActive = active;
            await db.SaveChangesAsync();
            return await req.Ok(PlayerDto.From(p));
        });

    /// <summary>
    /// Upload proxy: the client crops to a square, resizes to 512px and encodes WebP (JPEG on browsers that
    /// can't encode WebP, e.g. Safari), then PUTs the bytes here.
    /// Proxying (instead of SAS URLs) keeps the storage account private and needs no CORS setup.
    /// </summary>
    [Function("players-photo-put")]
    public Task<HttpResponseData> PutPhoto([HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "players/{id:guid}/photo")] HttpRequestData req, Guid id) =>
        req.Handle(log, admin: true, async () =>
        {
            var p = await db.Players.FindAsync(id) ?? throw Http.NotFound("player");
            using var ms = new MemoryStream();
            await req.Body.CopyToAsync(ms);
            if (ms.Length == 0) throw new ApiException(HttpStatusCode.BadRequest, "photo.empty", "The photo is empty.");
            if (ms.Length > MaxPhotoBytes) throw new ApiException(HttpStatusCode.BadRequest, "photo.tooLarge", "The photo must be under 1 MB.");
            var bytes = ms.ToArray();
            var contentType = IsWebP(bytes) ? "image/webp" : IsJpeg(bytes) ? "image/jpeg"
                : throw new ApiException(HttpStatusCode.BadRequest, "photo.notWebp", "The photo must be a WebP (or JPEG) image.");

            var oldVersion = p.PhotoVersion;
            p.PhotoVersion = (oldVersion ?? 0) + 1;
            await photos.GetBlobClient($"{p.Id}-{p.PhotoVersion}").UploadAsync(new BinaryData(bytes),
                new BlobUploadOptions { HttpHeaders = new BlobHttpHeaders { ContentType = contentType } });
            await db.SaveChangesAsync();
            if (oldVersion is { } ov) await photos.GetBlobClient($"{p.Id}-{ov}").DeleteIfExistsAsync();
            return await req.Ok(PlayerDto.From(p));
        });

    [Function("players-photo-delete")]
    public Task<HttpResponseData> DeletePhoto([HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "players/{id:guid}/photo")] HttpRequestData req, Guid id) =>
        req.Handle(log, admin: true, async () =>
        {
            var p = await db.Players.FindAsync(id) ?? throw Http.NotFound("player");
            if (p.PhotoVersion is { } v) await photos.GetBlobClient($"{p.Id}-{v}").DeleteIfExistsAsync();
            p.PhotoVersion = null;
            await db.SaveChangesAsync();
            return await req.Ok(PlayerDto.From(p));
        });

    /// <summary>Public read of a photo. File names are versioned, so they can be cached forever.</summary>
    [Function("photos-get")]
    public async Task<HttpResponseData> GetPhoto([HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "photos/{name}")] HttpRequestData req, string name)
    {
        if (!System.Text.RegularExpressions.Regex.IsMatch(name, @"^[0-9a-f\-]{36}-\d+$"))
            return req.CreateResponse(HttpStatusCode.NotFound);
        var blob = photos.GetBlobClient(name);
        try
        {
            var content = await blob.DownloadContentAsync();
            var res = req.CreateResponse(HttpStatusCode.OK);
            res.Headers.Add("Content-Type", content.Value.Details.ContentType ?? "image/webp");
            res.Headers.Add("Cache-Control", "public, max-age=31536000, immutable");
            await res.Body.WriteAsync(content.Value.Content.ToMemory());
            return res;
        }
        catch (Azure.RequestFailedException e) when (e.Status == 404)
        {
            return req.CreateResponse(HttpStatusCode.NotFound);
        }
    }

    static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim()[..Math.Min(s.Trim().Length, 20)];

    static bool IsJpeg(byte[] b) => b.Length > 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF;

    static bool IsWebP(byte[] b) =>
        b.Length > 12 && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F' && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P';
}
