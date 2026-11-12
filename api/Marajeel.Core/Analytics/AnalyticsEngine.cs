using Marajeel.Core.Domain;

namespace Marajeel.Core.Analytics;

public record ParticipantRecord(Guid PlayerId, char Side, int Position);

public record GameRecord(
    Guid Id, Guid SessionId, DateTimeOffset PlayedAt, DateTimeOffset CreatedAt,
    int ScoreA, int ScoreB, Guid MvpPlayerId, IReadOnlyList<ParticipantRecord> Participants)
{
    public char Winner => ScoreA > ScoreB ? 'A' : 'B';
}

public record RatingPoint(Guid GameId, DateTimeOffset PlayedAt, int Rating);

public record PositionStats(int Position, double Mu, double Sigma, int Rating, int Games, int Wins, bool Established);

public record PlayerStats(
    Guid PlayerId,
    double Mu, double Sigma, int Rating, bool Provisional,
    int Games, int Wins, int Losses, double WinPct, int Mvps,
    int CurrentStreak, int LongestStreak,
    int? BestPosition,
    IReadOnlyList<PositionStats> Positions,
    IReadOnlyList<RatingPoint> RatingHistory,
    IReadOnlyDictionary<Guid, int> GamesBySession,
    int RatingDelta,
    DateTimeOffset? LastPlayedAt);

public record TogetherStats(int Games, int Wins, double Chemistry, bool Enough);
public record AgainstStats(int Games, int AWins, int BWins);
/// <summary>Pair record with A &lt; B (by Guid string order).</summary>
public record PairStats(Guid A, Guid B, TogetherStats Together, AgainstStats Against);

public record AnalyticsResult(
    IReadOnlyList<PlayerStats> Players,
    IReadOnlyList<PairStats> Pairs,
    IReadOnlyDictionary<Guid, Guid> SessionMvps,
    int GameCount,
    DateTimeOffset? From, DateTimeOffset? To);

/// <summary>
/// Replays the full game history in chronological order and derives every statistic.
/// Pure and deterministic: same games in → same numbers out. Never updated incrementally.
/// </summary>
public static class AnalyticsEngine
{
    /// <summary>Shrinkage constant for chemistry: chem = mean residual · n/(n+k).</summary>
    public const double ChemistryK = 5.0;

    public static IEnumerable<GameRecord> Chronological(IEnumerable<GameRecord> games) =>
        games.OrderBy(g => g.PlayedAt).ThenBy(g => g.CreatedAt).ThenBy(g => g.Id);

    /// <summary>
    /// Ratings always use the full history. Counting stats (games, wins, MVPs, streaks, chemistry,
    /// head-to-head, rating delta) only include games with <paramref name="from"/> ≤ PlayedAt &lt; <paramref name="to"/>.
    /// </summary>
    public static AnalyticsResult Compute(
        IEnumerable<Guid> playerIds, IEnumerable<GameRecord> games, GroupSettings settings,
        DateTimeOffset? from = null, DateTimeOffset? to = null)
    {
        var acc = new Dictionary<Guid, Acc>();
        Acc Get(Guid id) => acc.TryGetValue(id, out var a) ? a : acc[id] = new Acc();
        foreach (var id in playerIds) Get(id);

        var pairs = new Dictionary<(Guid, Guid), PairAcc>();
        PairAcc Pair(Guid x, Guid y)
        {
            var key = Order(x, y);
            return pairs.TryGetValue(key, out var p) ? p : pairs[key] = new PairAcc();
        }

        var sessionMvpCounts = new Dictionary<Guid, Dictionary<Guid, int>>();
        var ordered = Chronological(games).ToList();
        var windowGames = 0;

        foreach (var g in ordered)
        {
            var inWindow = (from is null || g.PlayedAt >= from) && (to is null || g.PlayedAt < to);
            var sideA = g.Participants.Where(p => p.Side == 'A').ToList();
            var sideB = g.Participants.Where(p => p.Side == 'B').ToList();
            if (sideA.Count == 0 || sideB.Count == 0) continue;

            // Pre-game expectations from overall ratings.
            var pA = TrueSkill.WinProbability(sideA.Select(p => Get(p.PlayerId).Overall).ToList(),
                                              sideB.Select(p => Get(p.PlayerId).Overall).ToList());
            var aWon = g.Winner == 'A';

            if (inWindow)
            {
                windowGames++;
                foreach (var p in g.Participants)
                {
                    var a = Get(p.PlayerId);
                    a.RatingAtWindowStart ??= TrueSkill.ToDisplay(a.Overall);
                    var won = (p.Side == 'A') == aWon;
                    a.Games++;
                    if (won) { a.Wins++; a.Streak++; a.Longest = Math.Max(a.Longest, a.Streak); }
                    else { a.Losses++; a.Streak = 0; }
                    a.BySession[g.SessionId] = a.BySession.GetValueOrDefault(g.SessionId) + 1;
                    a.LastPlayedAt = g.PlayedAt;
                }
                if (g.Participants.Any(p => p.PlayerId == g.MvpPlayerId))
                {
                    Get(g.MvpPlayerId).Mvps++;
                    var counts = sessionMvpCounts.TryGetValue(g.SessionId, out var c) ? c : sessionMvpCounts[g.SessionId] = [];
                    counts[g.MvpPlayerId] = counts.GetValueOrDefault(g.MvpPlayerId) + 1;
                }

                // Chemistry residuals: actual (1/0) − expected win probability, per teammate pair.
                AddTeammates(sideA, (aWon ? 1 : 0) - pA, aWon);
                AddTeammates(sideB, (aWon ? 0 : 1) - (1 - pA), !aWon);

                // Head-to-head on opposite sides.
                foreach (var x in sideA)
                    foreach (var y in sideB)
                    {
                        var pr = Pair(x.PlayerId, y.PlayerId);
                        pr.AgainstGames++;
                        var winnerId = aWon ? x.PlayerId : y.PlayerId;
                        if (Order(x.PlayerId, y.PlayerId).Item1 == winnerId) pr.AWins++; else pr.BWins++;
                    }
            }

            var weight = TrueSkill.MarginWeight(Math.Abs(g.ScoreA - g.ScoreB));
            var winners = aWon ? sideA : sideB;
            var losers = aWon ? sideB : sideA;

            // Overall track.
            var (wo, lo) = TrueSkill.Update(winners.Select(p => Get(p.PlayerId).Overall).ToList(),
                                            losers.Select(p => Get(p.PlayerId).Overall).ToList(), weight);
            for (var i = 0; i < winners.Count; i++) Get(winners[i].PlayerId).Overall = wo[i];
            for (var i = 0; i < losers.Count; i++) Get(losers[i].PlayerId).Overall = lo[i];

            // Per-position tracks: every player's track at the position they played in this game.
            var (wp, lp) = TrueSkill.Update(winners.Select(p => Get(p.PlayerId).Pos(p.Position).Rating).ToList(),
                                            losers.Select(p => Get(p.PlayerId).Pos(p.Position).Rating).ToList(), weight);
            for (var i = 0; i < winners.Count; i++) Get(winners[i].PlayerId).Pos(winners[i].Position).Apply(wp[i], won: true);
            for (var i = 0; i < losers.Count; i++) Get(losers[i].PlayerId).Pos(losers[i].Position).Apply(lp[i], won: false);

            foreach (var p in g.Participants)
            {
                var a = Get(p.PlayerId);
                a.TotalGames++;
                a.History.Add(new RatingPoint(g.Id, g.PlayedAt, TrueSkill.ToDisplay(a.Overall)));
            }
        }

        var players = acc.Select(kv =>
        {
            var a = kv.Value;
            var positions = a.Positions.OrderBy(p => p.Key).Select(p => new PositionStats(
                p.Key, p.Value.Rating.Mu, p.Value.Rating.Sigma, TrueSkill.ToDisplay(p.Value.Rating),
                p.Value.Games, p.Value.Wins, p.Value.Games >= settings.MinPositionGames)).ToList();
            var best = positions.Where(p => p.Established)
                .OrderByDescending(p => p.Rating).ThenByDescending(p => p.Games).ThenBy(p => p.Position)
                .Select(p => (int?)p.Position).FirstOrDefault();
            var rating = TrueSkill.ToDisplay(a.Overall);
            return new PlayerStats(
                kv.Key, a.Overall.Mu, a.Overall.Sigma, rating, a.TotalGames < settings.ProvisionalGames,
                a.Games, a.Wins, a.Losses, a.Games == 0 ? 0 : (double)a.Wins / a.Games, a.Mvps,
                a.Streak, a.Longest, best, positions, a.History, a.BySession,
                a.RatingAtWindowStart is { } s ? rating - s : 0, a.LastPlayedAt);
        }).ToList();

        var pairList = pairs.Select(kv =>
        {
            var p = kv.Value;
            var chem = p.TogetherGames == 0 ? 0 : p.ResidualSum / p.TogetherGames * (p.TogetherGames / (p.TogetherGames + ChemistryK));
            return new PairStats(kv.Key.Item1, kv.Key.Item2,
                new TogetherStats(p.TogetherGames, p.TogetherWins, chem, p.TogetherGames >= settings.MinChemistryGames),
                new AgainstStats(p.AgainstGames, p.AWins, p.BWins));
        }).ToList();

        var sessionMvps = sessionMvpCounts.ToDictionary(
            kv => kv.Key,
            kv => kv.Value.OrderByDescending(x => x.Value)
                          .ThenByDescending(x => TrueSkill.ToDisplay(Get(x.Key).Overall))
                          .ThenBy(x => x.Key).First().Key);

        return new AnalyticsResult(players, pairList, sessionMvps, windowGames, from, to);

        void AddTeammates(List<ParticipantRecord> side, double residual, bool won)
        {
            for (var i = 0; i < side.Count; i++)
                for (var j = i + 1; j < side.Count; j++)
                {
                    var pr = Pair(side[i].PlayerId, side[j].PlayerId);
                    pr.TogetherGames++;
                    if (won) pr.TogetherWins++;
                    pr.ResidualSum += residual;
                }
        }
    }

    /// <summary>Shrunk chemistry for a list of residuals (exposed for tests/documentation).</summary>
    public static double ShrinkChemistry(IReadOnlyCollection<double> residuals) =>
        residuals.Count == 0 ? 0 : residuals.Average() * (residuals.Count / (residuals.Count + ChemistryK));

    public static (Guid, Guid) Order(Guid x, Guid y) =>
        string.CompareOrdinal(x.ToString(), y.ToString()) <= 0 ? (x, y) : (y, x);

    sealed class Acc
    {
        public Rating Overall = TrueSkill.Default;
        public readonly Dictionary<int, PosAcc> Positions = [];
        public PosAcc Pos(int p) => Positions.TryGetValue(p, out var x) ? x : Positions[p] = new PosAcc();
        public int Games, Wins, Losses, Mvps, Streak, Longest, TotalGames;
        public int? RatingAtWindowStart;
        public DateTimeOffset? LastPlayedAt;
        public readonly Dictionary<Guid, int> BySession = [];
        public readonly List<RatingPoint> History = [];
    }

    sealed class PosAcc
    {
        public Rating Rating = TrueSkill.Default;
        public int Games, Wins;
        public void Apply(Rating r, bool won) { Rating = r; Games++; if (won) Wins++; }
    }

    sealed class PairAcc
    {
        public int TogetherGames, TogetherWins, AgainstGames, AWins, BWins;
        public double ResidualSum;
    }
}
