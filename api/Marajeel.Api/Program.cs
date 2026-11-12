using Azure.Storage.Blobs;
using Marajeel.Api;
using Marajeel.Core.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

var host = new HostBuilder()
    .ConfigureFunctionsWorkerDefaults()
    .ConfigureServices(services =>
    {
        var sql = Environment.GetEnvironmentVariable("SQL_CONNECTION")
                  ?? throw new InvalidOperationException("SQL_CONNECTION is not configured.");
        services.AddDbContext<MarajeelDb>(o => o.UseSqlServer(sql, s => s.EnableRetryOnFailure(6, TimeSpan.FromSeconds(10), null)));

        var blob = Environment.GetEnvironmentVariable("BLOB_CONNECTION") ?? "UseDevelopmentStorage=true";
        services.AddSingleton(new BlobServiceClient(blob).GetBlobContainerClient("photos"));

        services.AddScoped<SettingsStore>();
        services.AddHostedService<StartupTasks>();
    })
    .Build();

host.Run();
