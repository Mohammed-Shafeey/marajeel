import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Game } from '../api/types';
import { normalizeArabic, matchesSearch, initials, cardName } from './arabic';
import { balanceTeams, randomSplit } from './balance';
import { dreamTeam } from './dreamTeam';
import { ctxFor, syntheticAnalytics, withPairs } from './fixtures';
import { buildContext, chemistryBonus, positionRating, teamRating, winProbability } from './teamRating';
import { scoreLooksFinished, validateGame, validateRoster } from './validation';

const T = DEFAULT_SETTINGS.positionTemplate;

describe('team rating', () => {
  it('uses position rating when established, overall otherwise, prior when provisional', () => {
    const a = syntheticAnalytics(4, 3, { provisionalEvery: 4 });
    const ctx = ctxFor(a);
    const p1 = a.players[1];
    const est = p1.positions.find((p) => p.games >= 5)!;
    const thin = p1.positions.find((p) => p.games < 5);
    expect(positionRating(ctx, p1.playerId, est.position)).toBe(est.rating);
    if (thin) expect(positionRating(ctx, p1.playerId, thin.position)).toBe(p1.rating);
    expect(positionRating(ctx, a.players[0].playerId, 1)).toBe(ctx.prior);
    expect(positionRating(ctx, 'unknown', 1)).toBe(ctx.prior);
  });

  it('adds a capped chemistry bonus', () => {
    const base = syntheticAnalytics(6);
    const ids = base.players.map((p) => p.playerId);
    const allPairs: Array<[string, string, number]> = [];
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) allPairs.push([ids[i], ids[j], 0.1]);
    const ctx = ctxFor(withPairs(base, allPairs));
    expect(chemistryBonus(ctx, ids)).toBeCloseTo(2, 6);
    const huge = ctxFor(withPairs(base, allPairs.map(([x, y]) => [x, y, 0.9])));
    expect(chemistryBonus(huge, ids)).toBe(3);
    const slots = ids.map((id, i) => ({ playerId: id, position: T[i] }));
    expect(teamRating(ctx, slots) - teamRating(ctxFor(base), slots)).toBeCloseTo(2, 6);
  });

  it('win probability is 50% for equal teams and rises with the gap', () => {
    expect(winProbability(70, 70)).toBeCloseTo(0.5, 6);
    expect(winProbability(71, 70)).toBeGreaterThan(0.55);
    expect(winProbability(71, 70)).toBeLessThan(0.62);
    expect(winProbability(60, 70)).toBeLessThan(0.05);
    expect(winProbability(72, 68) + winProbability(68, 72)).toBeCloseTo(1, 6);
  });
});

describe('balancer', () => {
  const analytics = syntheticAnalytics(18, 11);
  const ctx = ctxFor(analytics);
  const ids = analytics.players.map((p) => p.playerId);

  it('produces a valid split: every team fills the template, nobody twice', () => {
    const r = balanceTeams(ctx, { playerIds: ids, teamCount: 3, template: T, seed: 1 });
    expect(r.teams).toHaveLength(3);
    const all = r.teams.flat().map((s) => s.playerId);
    expect(new Set(all).size).toBe(18);
    expect(all.sort()).toEqual(ids.slice().sort());
    for (const team of r.teams) expect(team.map((s) => s.position).sort()).toEqual(T.slice().sort());
  });

  it('has a lower spread than random splits', () => {
    const balanced = [1, 2, 3, 4, 5].map((seed) => balanceTeams(ctx, { playerIds: ids, teamCount: 3, template: T, seed }).spread);
    const random = Array.from({ length: 50 }, (_, seed) => randomSplit(ctx, ids, 3, T, seed).spread);
    const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(avg(balanced)).toBeLessThan(avg(random) / 3);
    expect(Math.max(...balanced)).toBeLessThan(1.5);
  });

  it('is reproducible for a seed and respects locks', () => {
    const a = balanceTeams(ctx, { playerIds: ids, teamCount: 3, template: T, seed: 9 });
    const b = balanceTeams(ctx, { playerIds: ids, teamCount: 3, template: T, seed: 9 });
    expect(a.teams).toEqual(b.teams);
    const locks = { [ids[0]]: 2, [ids[1]]: 2, [ids[2]]: 0 };
    const r = balanceTeams(ctx, { playerIds: ids, teamCount: 3, template: T, seed: 4, locks });
    expect(r.teams[2].some((s) => s.playerId === ids[0])).toBe(true);
    expect(r.teams[2].some((s) => s.playerId === ids[1])).toBe(true);
    expect(r.teams[0].some((s) => s.playerId === ids[2])).toBe(true);
  });

  it('works for two teams and rejects the wrong player count', () => {
    const r = balanceTeams(ctx, { playerIds: ids.slice(0, 12), teamCount: 2, template: T, seed: 2 });
    expect(r.teams.map((t) => t.length)).toEqual([6, 6]);
    expect(() => balanceTeams(ctx, { playerIds: ids.slice(0, 11), teamCount: 2, template: T, seed: 2 })).toThrow();
  });
});

describe('dream team', () => {
  it('returns a valid line-up that is optimal on a small fixture (brute force check)', () => {
    const base = syntheticAnalytics(9, 5);
    const ids = base.players.map((p) => p.playerId);
    // Make every player eligible everywhere so brute force covers all 9P6 arrangements.
    for (const p of base.players) for (const pos of p.positions) pos.games = 10;
    const a = withPairs(base, [[ids[0], ids[1], 0.3], [ids[2], ids[3], -0.3], [ids[4], ids[5], 0.2]]);
    const ctx = ctxFor(a);
    const r = dreamTeam(ctx, T, 9);
    expect(r.slots).toHaveLength(6);
    expect(new Set(r.slots.map((s) => s.playerId)).size).toBe(6);
    expect(r.slots.map((s) => s.position).sort()).toEqual(T.slice().sort());

    let best = -Infinity;
    const pick = (k: number, used: string[]) => {
      if (k === T.length) {
        best = Math.max(best, teamRating(ctx, used.map((id, i) => ({ playerId: id, position: T[i] }))));
        return;
      }
      for (const id of ids) if (!used.includes(id)) pick(k + 1, [...used, id]);
    };
    pick(0, []);
    expect(r.rating).toBeCloseTo(best, 9);
  });

  it('only uses eligible players', () => {
    const a = syntheticAnalytics(12, 8, { provisionalEvery: 3 });
    const ctx = ctxFor(a);
    const r = dreamTeam(ctx, T);
    for (const s of r.slots) {
      const st = a.players.find((p) => p.playerId === s.playerId)!;
      expect(st.provisional).toBe(false);
      expect(st.positions.find((p) => p.position === s.position)!.games).toBeGreaterThanOrEqual(5);
    }
  });

  it('handles empty data', () => {
    const r = dreamTeam(buildContext(undefined, DEFAULT_SETTINGS), T);
    expect(r.slots).toHaveLength(0);
    expect(r.missing.sort()).toEqual(T.slice().sort());
  });
});

describe('validation (client mirror)', () => {
  const players = Array.from({ length: 14 }, (_, i) => `p${i}`);
  const teamIds = new Set(['A', 'B']);
  const game = (over: Partial<Game> = {}): Game => ({
    id: 'g',
    sessionId: 's',
    teamAId: 'A',
    teamBId: 'B',
    scoreA: 15,
    scoreB: 12,
    mvpPlayerId: 'p0',
    playedAt: '',
    participants: [
      ...players.slice(0, 6).map((p, i) => ({ playerId: p, side: 'A' as const, position: i + 1 })),
      ...players.slice(6, 12).map((p, i) => ({ playerId: p, side: 'B' as const, position: i + 1 })),
    ],
    ...over,
  });
  const check = (g: Game, inSession = players.slice(0, 13)) => validateGame(g, DEFAULT_SETTINGS, teamIds, new Set(inSession)).map((e) => e.code);

  it('accepts a valid game', () => expect(check(game())).toEqual([]));
  it('rule 2: no duplicates', () => {
    const g = game();
    g.participants[6] = { ...g.participants[6], playerId: 'p0' };
    expect(check(g)).toContain('game.duplicatePlayer');
  });
  it('rule 3: checked in', () => expect(check(game(), players.slice(0, 10))).toContain('game.playerNotInSession'));
  it('rule 4: no ties, no negatives', () => {
    expect(check(game({ scoreA: 15, scoreB: 15 }))).toContain('game.tie');
    expect(check(game({ scoreA: -1 }))).toContain('game.negativeScore');
    expect(check(game({ scoreA: 1.5 }))).toContain('game.negativeScore');
  });
  it('rule 5: MVP played', () => expect(check(game({ mvpPlayerId: 'p13' }))).toContain('game.mvpNotParticipant'));

  it('rule 1 + counts for rosters', () => {
    const teams = [
      { id: 't1', label: 'A', color: 'a' as const },
      { id: 't2', label: 'B', color: 'b' as const },
    ];
    const roster = players.slice(0, 12).map((p, i) => ({ playerId: p, teamId: i < 6 ? 't1' : 't2', position: (i % 6) + 1, isBench: false }));
    expect(validateRoster(teams, roster, DEFAULT_SETTINGS)).toEqual([]);
    const dup = [...roster, { playerId: 'p0', teamId: 't2', position: null, isBench: true }];
    expect(validateRoster(teams, dup, DEFAULT_SETTINGS).map((e) => e.code)).toContain('roster.duplicatePlayer');
    const short = roster.slice(1);
    expect(validateRoster(teams, short, DEFAULT_SETTINGS).map((e) => e.code)).toContain('roster.activeCount');
  });

  it('score hint follows target and win-by-two', () => {
    expect(scoreLooksFinished(15, 12, DEFAULT_SETTINGS)).toBe(true);
    expect(scoreLooksFinished(15, 14, DEFAULT_SETTINGS)).toBe(false);
    expect(scoreLooksFinished(17, 15, DEFAULT_SETTINGS)).toBe(true);
    expect(scoreLooksFinished(14, 3, DEFAULT_SETTINGS)).toBe(false);
  });
});

describe('arabic helpers', () => {
  it('normalises hamza, taa marbuta, diacritics and spaces for search', () => {
    expect(normalizeArabic('أحمد')).toBe(normalizeArabic('احمد'));
    expect(matchesSearch('عبد الله الغامدي', 'عبدالله')).toBe(true);
    expect(matchesSearch('مُحَمَّد', 'محمد')).toBe(true);
    expect(matchesSearch('حمزة', 'حمزه')).toBe(true);
    expect(matchesSearch('فهد', 'سعود')).toBe(false);
  });
  it('builds initials and card names', () => {
    expect(initials('محمد العتيبي')).toBe('م ع');
    expect(cardName('عبدالعزيز بن عبدالرحمن الشمراني')).toBe('الشمراني');
    expect(cardName('محمد العتيبي', 'أبو فهد')).toBe('أبو فهد');
  });
});
