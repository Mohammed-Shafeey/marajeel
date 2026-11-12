using Marajeel.Core.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Marajeel.Core.Data;

public class MarajeelDb(DbContextOptions<MarajeelDb> options) : DbContext(options)
{
    public DbSet<Player> Players => Set<Player>();
    public DbSet<Session> Sessions => Set<Session>();
    public DbSet<SessionTeam> SessionTeams => Set<SessionTeam>();
    public DbSet<SessionPlayer> SessionPlayers => Set<SessionPlayer>();
    public DbSet<Game> Games => Set<Game>();
    public DbSet<GameParticipant> GameParticipants => Set<GameParticipant>();
    public DbSet<AppSettingsRow> Settings => Set<AppSettingsRow>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Player>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(80).IsRequired();
            e.Property(x => x.ShortName).HasMaxLength(20);
            e.HasIndex(x => x.Name);
        });

        b.Entity<Session>(e =>
        {
            e.Property(x => x.Notes).HasMaxLength(500);
            e.HasMany(x => x.Teams).WithOne().HasForeignKey(x => x.SessionId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.Players).WithOne().HasForeignKey(x => x.SessionId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.Games).WithOne().HasForeignKey(x => x.SessionId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => x.Date);
        });

        b.Entity<SessionTeam>(e =>
        {
            e.Property(x => x.Label).HasMaxLength(40).IsRequired();
            e.Property(x => x.Color).HasMaxLength(8).IsRequired();
        });

        b.Entity<SessionPlayer>(e =>
        {
            // Rule 1: a player is in a session (and therefore on a team) at most once.
            e.HasKey(x => new { x.SessionId, x.PlayerId });
            e.HasOne<Player>().WithMany().HasForeignKey(x => x.PlayerId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<SessionTeam>().WithMany().HasForeignKey(x => x.TeamId).OnDelete(DeleteBehavior.NoAction);
        });

        b.Entity<Game>(e =>
        {
            e.Property(x => x.Id).ValueGeneratedNever();
            e.HasMany(x => x.Participants).WithOne().HasForeignKey(x => x.GameId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<SessionTeam>().WithMany().HasForeignKey(x => x.TeamAId).OnDelete(DeleteBehavior.NoAction);
            e.HasOne<SessionTeam>().WithMany().HasForeignKey(x => x.TeamBId).OnDelete(DeleteBehavior.NoAction);
            e.HasOne<Player>().WithMany().HasForeignKey(x => x.MvpPlayerId).OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x => x.PlayedAt);
        });

        b.Entity<GameParticipant>(e =>
        {
            // Rule 2: a player appears at most once per game (across both sides).
            e.HasKey(x => new { x.GameId, x.PlayerId });
            e.Property(x => x.Side).HasConversion<string>().HasMaxLength(1);
            e.HasOne<Player>().WithMany().HasForeignKey(x => x.PlayerId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<AppSettingsRow>(e =>
        {
            e.ToTable("AppSettings");
            e.Property(x => x.Id).ValueGeneratedNever();
        });
    }
}

/// <summary>Used by `dotnet ef` at design time.</summary>
public class MarajeelDbFactory : IDesignTimeDbContextFactory<MarajeelDb>
{
    public MarajeelDb CreateDbContext(string[] args)
    {
        var cs = Environment.GetEnvironmentVariable("SQL_CONNECTION")
                 ?? "Server=localhost,14333;Database=marajeel;User Id=sa;Password=Marajeel_dev_Pass1;TrustServerCertificate=True";
        return new MarajeelDb(new DbContextOptionsBuilder<MarajeelDb>().UseSqlServer(cs).Options);
    }
}
