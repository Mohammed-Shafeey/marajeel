using Marajeel.Core.Analytics;

namespace Marajeel.Tests;

/// <summary>Tiny builder for hand-written game histories.</summary>
public class Fixture
{
    public readonly Guid Session = Guid.NewGuid();
    readonly DateTimeOffset _start = new(2026, 1, 1, 18, 0, 0, TimeSpan.Zero);
    public readonly List<GameRecord> Games = [];
    public readonly List<Guid> Players;

    public Fixture(int players = 12) => Players = Enumerable.Range(0, players).Select(_ => Guid.NewGuid()).ToList();

    public Guid this[int i] => Players[i];

    /// <summary>Adds a game: side A = players aIdx (positions in order 1..n), side B = bIdx.</summary>
    public GameRecord Add(int[] aIdx, int[] bIdx, int scoreA, int scoreB, int? mvp = null, DateTimeOffset? at = null)
    {
        var parts = aIdx.Select((p, i) => new ParticipantRecord(Players[p], 'A', i % 6 + 1))
            .Concat(bIdx.Select((p, i) => new ParticipantRecord(Players[p], 'B', i % 6 + 1))).ToList();
        var mvpId = Players[mvp ?? (scoreA > scoreB ? aIdx[0] : bIdx[0])];
        var g = new GameRecord(Guid.NewGuid(), Session, at ?? _start.AddMinutes(Games.Count * 15), at ?? _start.AddMinutes(Games.Count * 15),
            scoreA, scoreB, mvpId, parts);
        Games.Add(g);
        return g;
    }

    public static readonly int[] TeamA = [0, 1, 2, 3, 4, 5];
    public static readonly int[] TeamB = [6, 7, 8, 9, 10, 11];
}
