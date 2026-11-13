import type { GameRecord, ParticipantRecord } from './analytics.ts';
import { DEFAULT_SETTINGS, POSITIONS } from './settings.ts';
import { BETA } from './trueskill.ts';

/**
 * Generates a believable history from hidden "true" skills, for demos and for checking that the
 * rating replay recovers those skills. Deterministic for a given seed.
 */

export interface DemoPlayer {
  id: string;
  name: string;
  preferredPosition: number;
  createdAt: string;
  trueSkill: number;
  aptitude: Record<number, number>;
}
export interface DemoTeam {
  id: string;
  label: string;
  color: string;
  sortOrder: number;
}
export interface DemoRosterEntry {
  playerId: string;
  teamId: string | null;
  position: number | null;
  isBench: boolean;
}
export interface DemoSession {
  id: string;
  date: string;
  status: 'open' | 'closed';
  createdAt: string;
  teams: DemoTeam[];
  roster: DemoRosterEntry[];
  games: (GameRecord & { teamAId: string; teamBId: string })[];
}
export interface DemoWorld {
  players: DemoPlayer[];
  sessions: DemoSession[];
}

const FIRST = ['محمد', 'فهد', 'سعود', 'عبدالله', 'ماجد', 'بندر', 'خالد', 'نايف', 'ياسر', 'عمر', 'ريان', 'تركي', 'سلطان', 'أنس', 'هشام', 'وليد', 'مشعل', 'أحمد', 'حسام', 'عمار', 'فيصل', 'سلمان', 'راكان', 'زياد', 'يوسف', 'إبراهيم', 'طلال', 'مازن', 'باسل', 'نواف'];
const FAMILY = ['العتيبي', 'الحربي', 'القحطاني', 'الغامدي', 'الشمري', 'العمري', 'الزهراني', 'الدوسري', 'باعشن', 'البلوي', 'السلمي', 'المالكي', 'الجهني', 'الأحمدي', 'الفيفي', 'الحازمي', 'العنزي', 'الصاعدي', 'البقمي', 'النمري', 'الشهري', 'المطيري', 'السبيعي', 'الرشيدي', 'اليامي', 'الخالدي', 'الثبيتي', 'المحمادي', 'الشهراني', 'العسيري'];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateDemo(seed = 42, playerCount = 30, sessionCount = 15, lastSession?: Date): DemoWorld {
  const rand = mulberry32(seed);
  const int = (n: number) => Math.floor(rand() * n);
  const normal = (mean: number, sd: number) => mean + sd * Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const guid = () => {
    const h = Array.from({ length: 32 }, () => int(16).toString(16));
    h[12] = '4';
    h[16] = (8 + int(4)).toString(16);
    const s = h.join('');
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
  };
  const shuffled = <T>(xs: T[]) => {
    const a = xs.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const settings = DEFAULT_SETTINGS;
  const teamSize = settings.positionTemplate.length;

  // Weekly Thursday sessions ending at the most recent Thursday.
  const last = new Date(lastSession ?? new Date());
  last.setUTCHours(18, 0, 0, 0); // 21:00 KSA
  while (last.getUTCDay() !== 4) last.setUTCDate(last.getUTCDate() - 1);
  const firstDay = new Date(last.getTime() - 7 * (sessionCount + 1) * 864e5);

  const players: DemoPlayer[] = Array.from({ length: playerCount }, (_, i) => {
    const preferred = POSITIONS[int(6)];
    const aptitude: Record<number, number> = {};
    for (const p of POSITIONS) aptitude[p] = p === preferred ? 2.5 : normal(-1, 1.2);
    return {
      id: guid(),
      name: `${FIRST[i % FIRST.length]} ${FAMILY[i % FAMILY.length]}`,
      preferredPosition: preferred,
      createdAt: firstDay.toISOString(),
      trueSkill: normal(25, 5),
      aptitude,
    };
  });

  const labels = ['الأزرق', 'البرتقالي', 'البنفسجي'];
  const colors = ['a', 'b', 'c'];

  const assignPositions = (team: DemoPlayer[]) => {
    const free = settings.positionTemplate.slice();
    const result = new Map<number, DemoPlayer>();
    const left: DemoPlayer[] = [];
    for (const p of team.slice().sort((a, b) => b.trueSkill - a.trueSkill)) {
      const i = free.indexOf(p.preferredPosition);
      if (i >= 0) {
        free.splice(i, 1);
        result.set(p.preferredPosition, p);
      } else left.push(p);
    }
    for (const p of left) {
      const pos = free.reduce((best, x) => (p.aptitude[x] > p.aptitude[best] ? x : best), free[0]);
      free.splice(free.indexOf(pos), 1);
      result.set(pos, p);
    }
    return result;
  };

  const sessions: DemoSession[] = [];
  for (let s = 0; s < sessionCount; s++) {
    const start = new Date(last.getTime() - 7 * (sessionCount - 1 - s) * 864e5);
    const teamCount = rand() < 0.8 ? 3 : 2;
    const activeCount = teamCount * teamSize;
    const benchCount = int(3);
    const present = shuffled(players).slice(0, Math.min(players.length, activeCount + benchCount));
    const active = present.slice(0, activeCount);
    const bench = present.slice(activeCount);

    const id = guid();
    const teams: DemoTeam[] = Array.from({ length: teamCount }, (_, i) => ({ id: guid(), label: labels[i], color: colors[i], sortOrder: i }));

    // Organiser-style split: rough snake draft on a noisy perception of skill.
    const perceived = active.map((p) => ({ p, v: p.trueSkill + normal(0, 7) })).sort((a, b) => b.v - a.v).map((x) => x.p);
    const buckets: DemoPlayer[][] = teams.map(() => []);
    perceived.forEach((p, i) => {
      const round = Math.floor(i / teamCount);
      buckets[round % 2 === 0 ? i % teamCount : teamCount - 1 - (i % teamCount)].push(p);
    });

    const roster: DemoRosterEntry[] = [];
    const lineups = buckets.map((b, t) => {
      const lineup = assignPositions(b);
      for (const [pos, p] of lineup) roster.push({ playerId: p.id, teamId: teams[t].id, position: pos, isBench: false });
      return lineup;
    });
    bench.forEach((b, i) => roster.push({ playerId: b.id, teamId: teams[i % teamCount].id, position: null, isBench: true }));

    const fixtures: [number, number][] = [];
    if (teamCount === 2) for (let i = 0; i < 6; i++) fixtures.push([0, 1]);
    else for (let r = 0; r < 3; r++) fixtures.push([0, 1], [0, 2], [1, 2]);

    const games: DemoSession['games'] = [];
    let clock = start.getTime();
    for (const [ta, tb] of fixtures) {
      clock += 12 * 60_000;
      const la = new Map(lineups[ta]);
      const lb = new Map(lineups[tb]);
      // Occasionally a bench player subs in for one game (per-game override).
      if (bench.length > 0 && rand() < 0.3) {
        const sub = bench[int(bench.length)];
        const pos = settings.positionTemplate[int(teamSize)];
        (int(2) === 0 ? la : lb).set(pos, sub);
      }
      const perf = (l: Map<number, DemoPlayer>) => [...l].reduce((sum, [pos, p]) => sum + p.trueSkill + p.aptitude[pos], 0);
      const diff = perf(la) - perf(lb) + normal(0, BETA * Math.sqrt(teamSize));
      const aWon = diff > 0;
      let loser = Math.min(settings.targetScore - 2, Math.max(3, Math.round(settings.targetScore - 1 - Math.abs(diff) / 2.5 + normal(0, 1.5))));
      let winner = settings.targetScore;
      if (rand() < 0.12) {
        loser = settings.targetScore + int(3);
        winner = loser + 2; // deuce
      }
      const winSide = aWon ? la : lb;
      let mvp = '';
      let mvpScore = -Infinity;
      for (const [pos, p] of winSide) {
        const v = p.trueSkill + p.aptitude[pos] + normal(0, 4);
        if (v > mvpScore) [mvp, mvpScore] = [p.id, v];
      }
      const at = new Date(clock).toISOString();
      const participants: ParticipantRecord[] = [
        ...[...la].map(([position, p]) => ({ playerId: p.id, side: 'A' as const, position })),
        ...[...lb].map(([position, p]) => ({ playerId: p.id, side: 'B' as const, position })),
      ];
      games.push({
        id: guid(),
        sessionId: id,
        teamAId: teams[ta].id,
        teamBId: teams[tb].id,
        scoreA: aWon ? winner : loser,
        scoreB: aWon ? loser : winner,
        mvpPlayerId: mvp,
        playedAt: at,
        createdAt: at,
        participants,
      });
    }
    sessions.push({
      id,
      date: start.toISOString().slice(0, 10),
      status: s === sessionCount - 1 ? 'open' : 'closed',
      createdAt: start.toISOString(),
      teams,
      roster,
      games,
    });
  }
  return { players, sessions };
}
