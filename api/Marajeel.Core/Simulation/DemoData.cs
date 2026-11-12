using Marajeel.Core.Analytics;
using Marajeel.Core.Domain;

namespace Marajeel.Core.Simulation;

public record SimPlayer(Player Player, double TrueSkill, IReadOnlyDictionary<int, double> Aptitude);

public record SimSession(Session Session, List<SessionTeam> Teams, List<SessionPlayer> Roster, List<Game> Games);

public record SimWorld(List<SimPlayer> Players, List<SimSession> Sessions)
{
    public IEnumerable<GameRecord> GameRecords => Sessions.SelectMany(s => s.Games).Select(g => new GameRecord(
        g.Id, g.SessionId, g.PlayedAt, g.CreatedAt, g.ScoreA, g.ScoreB, g.MvpPlayerId,
        g.Participants.Select(p => new ParticipantRecord(p.PlayerId, p.Side, p.Position)).ToList()));
}

/// <summary>
/// Generates a believable history from hidden "true" skills, for demos and for checking that the
/// rating replay recovers those skills. Deterministic for a given seed.
/// </summary>
public static class DemoData
{
    static readonly string[] FirstNames =
    [
        "محمد", "فهد", "سعود", "عبدالله", "ماجد", "بندر", "خالد", "نايف", "ياسر", "عمر",
        "ريان", "تركي", "سلطان", "أنس", "هشام", "وليد", "مشعل", "أحمد", "حسام", "عمار",
        "فيصل", "سلمان", "راكان", "زياد", "يوسف", "إبراهيم", "طلال", "مازن", "باسل", "نواف",
    ];
    static readonly string[] FamilyNames =
    [
        "العتيبي", "الحربي", "القحطاني", "الغامدي", "الشمري", "العمري", "الزهراني", "الدوسري", "باعشن", "البلوي",
        "السلمي", "المالكي", "الجهني", "الأحمدي", "الفيفي", "الحازمي", "العنزي", "الصاعدي", "البقمي", "النمري",
        "الشهري", "المطيري", "السبيعي", "الرشيدي", "اليامي", "الخالدي", "الثبيتي", "المحمادي", "الشهراني", "العسيري",
    ];

    public static SimWorld Generate(int seed = 42, int playerCount = 30, int sessionCount = 15, DateOnly? lastSession = null)
    {
        var rng = new Random(seed);
        var settings = GroupSettings.Default;
        var now = DateTimeOffset.UtcNow;

        var players = Enumerable.Range(0, playerCount).Select(i =>
        {
            var preferred = Positions.All[rng.Next(6)];
            var apt = Positions.All.ToDictionary(p => p, p => p == preferred ? 2.5 : Normal(rng, -1.0, 1.2));
            var name = $"{FirstNames[i % FirstNames.Length]} {FamilyNames[i % FamilyNames.Length]}";
            return new SimPlayer(new Player
            {
                Id = DeterministicGuid(rng),
                Name = name,
                PreferredPosition = preferred,
                IsActive = true,
                CreatedAt = now.AddDays(-7 * sessionCount - 7),
            }, Normal(rng, 25, 5), apt);
        }).ToList();

        // Weekly Thursday sessions ending at lastSession (default: the most recent Thursday).
        var last = lastSession ?? MostRecentThursday(DateOnly.FromDateTime(DateTime.Today));
        var sessions = new List<SimSession>();
        for (var s = 0; s < sessionCount; s++)
        {
            var date = last.AddDays(-7 * (sessionCount - 1 - s));
            var teamCount = rng.NextDouble() < 0.8 ? 3 : 2;
            var active = teamCount * settings.TeamSize;
            var benchCount = rng.Next(0, 3);
            var present = players.OrderBy(_ => rng.Next()).Take(Math.Min(players.Count, active + benchCount)).ToList();
            sessions.Add(BuildSession(rng, settings, date, teamCount, present[..active], present[active..], s == sessionCount - 1 ? SessionStatus.Open : SessionStatus.Closed));
        }
        return new SimWorld(players, sessions);
    }

    static SimSession BuildSession(Random rng, GroupSettings settings, DateOnly date, int teamCount,
        List<SimPlayer> active, List<SimPlayer> bench, SessionStatus status)
    {
        var start = new DateTimeOffset(date.ToDateTime(new TimeOnly(18, 0)), TimeSpan.Zero); // 21:00 KSA
        var session = new Session { Id = DeterministicGuid(rng), Date = date, Status = status, CreatedAt = start };
        string[] labels = ["الأزرق", "البرتقالي", "البنفسجي"];
        string[] colors = ["a", "b", "c"];
        var teams = Enumerable.Range(0, teamCount).Select(i => new SessionTeam
        {
            Id = DeterministicGuid(rng), SessionId = session.Id, Label = labels[i], Color = colors[i], SortOrder = i,
        }).ToList();

        // Organiser-style split: rough snake draft on a noisy perception of skill.
        var perceived = active.OrderByDescending(p => p.TrueSkill + Normal(rng, 0, 7)).ToList();
        var buckets = teams.Select(_ => new List<SimPlayer>()).ToList();
        for (var i = 0; i < perceived.Count; i++)
        {
            var round = i / teamCount;
            var idx = round % 2 == 0 ? i % teamCount : teamCount - 1 - i % teamCount;
            buckets[idx].Add(perceived[i]);
        }

        var roster = new List<SessionPlayer>();
        var lineups = new List<Dictionary<int, SimPlayer>>();
        for (var t = 0; t < teamCount; t++)
        {
            var lineup = AssignPositions(buckets[t], settings.PositionTemplate);
            lineups.Add(lineup);
            roster.AddRange(lineup.Select(kv => new SessionPlayer
            {
                SessionId = session.Id, PlayerId = kv.Value.Player.Id, TeamId = teams[t].Id, Position = kv.Key, CheckedInAt = start,
            }));
        }
        roster.AddRange(bench.Select((b, i) => new SessionPlayer
        {
            SessionId = session.Id, PlayerId = b.Player.Id, TeamId = teams[i % teamCount].Id, IsBench = true, CheckedInAt = start,
        }));

        // Fixtures: every pair plays; 3 rounds for 3 teams (9 games), 6 games for 2 teams.
        var fixtures = new List<(int, int)>();
        if (teamCount == 2) for (var i = 0; i < 6; i++) fixtures.Add((0, 1));
        else for (var r = 0; r < 3; r++) fixtures.AddRange([(0, 1), (0, 2), (1, 2)]);

        var games = new List<Game>();
        var clock = start;
        foreach (var (ta, tb) in fixtures)
        {
            clock = clock.AddMinutes(12);
            var la = new Dictionary<int, SimPlayer>(lineups[ta]);
            var lb = new Dictionary<int, SimPlayer>(lineups[tb]);
            // Occasionally a bench player subs in for one game (per-game override).
            if (bench.Count > 0 && rng.NextDouble() < 0.3)
            {
                var sub = bench[rng.Next(bench.Count)];
                var pos = settings.PositionTemplate[rng.Next(settings.TeamSize)];
                if (rng.Next(2) == 0) la[pos] = sub; else lb[pos] = sub;
            }

            double Perf(Dictionary<int, SimPlayer> l) => l.Sum(kv => kv.Value.TrueSkill + kv.Value.Aptitude[kv.Key]);
            var diff = Perf(la) - Perf(lb) + Normal(rng, 0, TrueSkill.Beta * Math.Sqrt(settings.TeamSize));
            var aWon = diff > 0;
            var loserScore = Math.Clamp((int)Math.Round(settings.TargetScore - 1 - Math.Abs(diff) / 2.5 + Normal(rng, 0, 1.5)), 3, settings.TargetScore - 2);
            var winnerScore = settings.TargetScore;
            if (rng.NextDouble() < 0.12) { loserScore = settings.TargetScore + rng.Next(0, 3); winnerScore = loserScore + 2; } // deuce

            var winnerSide = aWon ? la : lb;
            var mvp = winnerSide.MaxBy(kv => kv.Value.TrueSkill + kv.Value.Aptitude[kv.Key] + Normal(rng, 0, 4)).Value;

            var game = new Game
            {
                Id = DeterministicGuid(rng), SessionId = session.Id, TeamAId = teams[ta].Id, TeamBId = teams[tb].Id,
                ScoreA = aWon ? winnerScore : loserScore, ScoreB = aWon ? loserScore : winnerScore,
                MvpPlayerId = mvp.Player.Id, PlayedAt = clock, CreatedAt = clock,
            };
            game.Participants.AddRange(la.Select(kv => new GameParticipant { GameId = game.Id, PlayerId = kv.Value.Player.Id, Side = 'A', Position = kv.Key }));
            game.Participants.AddRange(lb.Select(kv => new GameParticipant { GameId = game.Id, PlayerId = kv.Value.Player.Id, Side = 'B', Position = kv.Key }));
            games.Add(game);
        }

        return new SimSession(session, teams, roster, games);
    }

    /// <summary>Greedy: players who prefer a free position get it first; the rest fill gaps by aptitude.</summary>
    static Dictionary<int, SimPlayer> AssignPositions(List<SimPlayer> team, int[] template)
    {
        var free = template.ToList();
        var result = new Dictionary<int, SimPlayer>();
        var left = new List<SimPlayer>();
        foreach (var p in team.OrderByDescending(p => p.TrueSkill))
        {
            if (free.Remove(p.Player.PreferredPosition)) result[p.Player.PreferredPosition] = p;
            else left.Add(p);
        }
        foreach (var p in left)
        {
            var pos = free.MaxBy(x => p.Aptitude[x]);
            free.Remove(pos);
            result[pos] = p;
        }
        return result;
    }

    public static DateOnly MostRecentThursday(DateOnly d)
    {
        while (d.DayOfWeek != DayOfWeek.Thursday) d = d.AddDays(-1);
        return d;
    }

    static double Normal(Random rng, double mean, double sd)
    {
        var u1 = 1.0 - rng.NextDouble();
        var u2 = rng.NextDouble();
        return mean + sd * Math.Sqrt(-2.0 * Math.Log(u1)) * Math.Cos(2 * Math.PI * u2);
    }

    static Guid DeterministicGuid(Random rng)
    {
        var bytes = new byte[16];
        rng.NextBytes(bytes);
        bytes[7] = (byte)((bytes[7] & 0x0F) | 0x40);
        bytes[8] = (byte)((bytes[8] & 0x3F) | 0x80);
        return new Guid(bytes);
    }
}
