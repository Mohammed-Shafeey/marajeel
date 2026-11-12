using Marajeel.Core.Analytics;
using Marajeel.Core.Data;
using Marajeel.Core.Domain;
using Marajeel.Core.Simulation;
using Microsoft.EntityFrameworkCore;

// Usage: dotnet run --project api/Marajeel.Seed -- [--reset] [--seed 42] [--players 30] [--sessions 15]
// Generates players with hidden "true" skills, simulates sessions/games, writes them to the database
// and prints how well the rating replay recovers those true skills.

var reset = args.Contains("--reset");
int Arg(string name, int fallback)
{
    var i = Array.IndexOf(args, name);
    return i >= 0 && i + 1 < args.Length && int.TryParse(args[i + 1], out var v) ? v : fallback;
}

var cs = Environment.GetEnvironmentVariable("SQL_CONNECTION")
         ?? "Server=localhost,14333;Database=marajeel;User Id=sa;Password=Marajeel_dev_Pass1;TrustServerCertificate=True";
await using var db = new MarajeelDb(new DbContextOptionsBuilder<MarajeelDb>().UseSqlServer(cs).Options);

Console.WriteLine("Applying migrations…");
await db.Database.MigrateAsync();

if (await db.Players.AnyAsync())
{
    if (!reset)
    {
        Console.WriteLine("Database already has data. Re-run with --reset to wipe it and seed again.");
        return 1;
    }
    Console.WriteLine("Wiping existing data…");
    await db.GameParticipants.ExecuteDeleteAsync();
    await db.Games.ExecuteDeleteAsync();
    await db.SessionPlayers.ExecuteDeleteAsync();
    await db.SessionTeams.ExecuteDeleteAsync();
    await db.Sessions.ExecuteDeleteAsync();
    await db.Players.ExecuteDeleteAsync();
}

var world = DemoData.Generate(Arg("--seed", 42), Arg("--players", 30), Arg("--sessions", 15));
db.Players.AddRange(world.Players.Select(p => p.Player));
await db.SaveChangesAsync();
foreach (var s in world.Sessions)
{
    db.Sessions.Add(s.Session);
    db.SessionTeams.AddRange(s.Teams);
    await db.SaveChangesAsync();
    db.SessionPlayers.AddRange(s.Roster);
    db.Games.AddRange(s.Games);
    await db.SaveChangesAsync();
}

var result = AnalyticsEngine.Compute(world.Players.Select(p => p.Player.Id), world.GameRecords, GroupSettings.Default);
Console.WriteLine($"Seeded {world.Players.Count} players, {world.Sessions.Count} sessions, {world.Sessions.Sum(s => s.Games.Count)} games.");
Console.WriteLine();
Console.WriteLine("True skill vs recovered rating (sorted by true skill):");
Console.WriteLine($"{"Player",-24} {"true",6} {"μ",7} {"σ",6} {"shown",6} {"games",6}");
foreach (var p in world.Players.OrderByDescending(p => p.TrueSkill))
{
    var r = result.Players.Single(x => x.PlayerId == p.Player.Id);
    Console.WriteLine($"{p.Player.Name,-24} {p.TrueSkill,6:F1} {r.Mu,7:F1} {r.Sigma,6:F2} {r.Rating,6} {r.Games,6}");
}
var xs = world.Players.Select(p => p.TrueSkill).ToArray();
var ys = world.Players.Select(p => result.Players.Single(x => x.PlayerId == p.Player.Id).Mu).ToArray();
double mx = xs.Average(), my = ys.Average();
var corr = xs.Zip(ys).Sum(t => (t.First - mx) * (t.Second - my)) /
           Math.Sqrt(xs.Sum(a => (a - mx) * (a - mx)) * ys.Sum(b => (b - my) * (b - my)));
Console.WriteLine();
Console.WriteLine($"Pearson correlation(true skill, μ) = {corr:F2}");
return 0;
