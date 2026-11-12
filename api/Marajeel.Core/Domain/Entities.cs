namespace Marajeel.Core.Domain;

/// <summary>
/// Court zones used by the group. One player per zone, no rotation.
/// 1 right receiver · 2 right hitter · 3 setter · 4 left hitter · 5 left receiver · 6 libero.
/// Stored as plain ints so the position template can be configured in settings.
/// </summary>
public static class Positions
{
    public const int RightReceiver = 1;
    public const int RightHitter = 2;
    public const int Setter = 3;
    public const int LeftHitter = 4;
    public const int LeftReceiver = 5;
    public const int Libero = 6;

    public static readonly int[] All = [1, 2, 3, 4, 5, 6];
    public static bool IsValid(int p) => p is >= 1 and <= 6;
}

public enum SessionStatus { Open = 0, Closed = 1 }

public class Player
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    /// <summary>Optional short name / nickname shown on cards (≤ 12 chars).</summary>
    public string? ShortName { get; set; }
    /// <summary>Bumped on every photo upload; null = no photo (initials avatar).</summary>
    public int? PhotoVersion { get; set; }
    public int PreferredPosition { get; set; } = Positions.LeftHitter;
    public bool IsActive { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; }
}

public class Session
{
    public Guid Id { get; set; }
    public DateOnly Date { get; set; }
    public string? Notes { get; set; }
    public SessionStatus Status { get; set; } = SessionStatus.Open;
    public DateTimeOffset CreatedAt { get; set; }

    public List<SessionTeam> Teams { get; set; } = [];
    public List<SessionPlayer> Players { get; set; } = [];
    public List<Game> Games { get; set; } = [];
}

public class SessionTeam
{
    public Guid Id { get; set; }
    public Guid SessionId { get; set; }
    public string Label { get; set; } = "";
    /// <summary>Design-system team colour key: a (blue) · b (orange) · c (lilac) · d (teal).</summary>
    public string Color { get; set; } = "a";
    public int SortOrder { get; set; }
}

/// <summary>
/// A checked-in player and their base lineup slot. Primary key (SessionId, PlayerId) enforces
/// "a player is on at most one team per session". TeamId is null until teams are built.
/// Bench players are attached to a team as subs and have no position.
/// </summary>
public class SessionPlayer
{
    public Guid SessionId { get; set; }
    public Guid PlayerId { get; set; }
    public Guid? TeamId { get; set; }
    public int? Position { get; set; }
    public bool IsBench { get; set; }
    public DateTimeOffset CheckedInAt { get; set; }
}

public class Game
{
    /// <summary>Client-generated GUID → retries/offline replays are idempotent upserts.</summary>
    public Guid Id { get; set; }
    public Guid SessionId { get; set; }
    public Guid TeamAId { get; set; }
    public Guid TeamBId { get; set; }
    public int ScoreA { get; set; }
    public int ScoreB { get; set; }
    public Guid MvpPlayerId { get; set; }
    public DateTimeOffset PlayedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public List<GameParticipant> Participants { get; set; } = [];
}

public class GameParticipant
{
    public Guid GameId { get; set; }
    public Guid PlayerId { get; set; }
    /// <summary>'A' or 'B'.</summary>
    public char Side { get; set; }
    public int Position { get; set; }
}

/// <summary>Single-row table holding the group-wide settings as JSON.</summary>
public class AppSettingsRow
{
    public int Id { get; set; } = 1;
    public string Json { get; set; } = "{}";
    public DateTimeOffset UpdatedAt { get; set; }
}
