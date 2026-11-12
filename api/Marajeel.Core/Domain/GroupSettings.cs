namespace Marajeel.Core.Domain;

/// <summary>
/// Group-wide settings (admin-editable). Per-viewer preferences such as language,
/// digits and theme live in the browser instead.
/// </summary>
public record GroupSettings
{
    /// <summary>
    /// Positions each team must fill, one entry per player. Default = one player per zone 1–6.
    /// Change this to e.g. [1,2,3,4,5] to play 5-a-side without a libero.
    /// </summary>
    public int[] PositionTemplate { get; init; } = [4, 3, 2, 5, 6, 1];

    /// <summary>Allowed numbers of teams in a session (active players = teams × template size).</summary>
    public int[] AllowedTeamCounts { get; init; } = [2, 3];

    public int TargetScore { get; init; } = 15;
    public bool WinByTwo { get; init; } = true;

    /// <summary>Games before a player's overall rating is official (fewer = provisional).</summary>
    public int ProvisionalGames { get; init; } = 5;
    /// <summary>Games at a position before that position rating counts (best position, dream team).</summary>
    public int MinPositionGames { get; init; } = 5;
    /// <summary>Games together before a pair's chemistry is shown.</summary>
    public int MinChemistryGames { get; init; } = 5;

    public int GoldThreshold { get; init; } = 75;
    public int SilverThreshold { get; init; } = 65;

    public int TeamSize => PositionTemplate.Length;

    public static GroupSettings Default { get; } = new();
}
