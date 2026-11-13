import { describe, expect, it } from 'vitest';
import { compute, shrinkChemistry, type AnalyticsResult } from '../src/core/analytics.ts';
import { generateDemo } from '../src/core/demo.ts';
import { DEFAULT_SETTINGS as S } from '../src/core/settings.ts';
import { validateGame, validateRoster } from '../src/core/validators.ts';
import { Fixture, rng } from './fixture.ts';

const pairOf = (r: AnalyticsResult, x: string, y: string) => r.pairs.find((p) => [p.a, p.b].includes(x) && [p.a, p.b].includes(y))!;
const stats = (r: AnalyticsResult, id: string) => r.players.find((p) => p.playerId === id)!;

describe('chemistry', () => {
  it('shrinkage pulls small samples toward zero', () => {
    expect(shrinkChemistry([0.5, 0.5, 0.5, 0.5, 0.5])).toBeCloseTo(0.25, 9);
    expect(shrinkChemistry([0.5])).toBeCloseTo(0.5 / 6, 9);
    expect(shrinkChemistry(Array(45).fill(0.5))).toBeCloseTo(0.45, 9);
    expect(shrinkChemistry([])).toBe(0);
  });

  it('the first game between equal teams gives a half residual', () => {
    const f = new Fixture();
    f.add(Fixture.A, Fixture.B, 15, 10);
    const r = compute(f.players, f.games, S);
    const winners = pairOf(r, f.p(0), f.p(1));
    expect(winners.together.chemistry).toBeCloseTo(0.5 / 6, 6);
    expect(winners.together.enough).toBe(false);
    expect(pairOf(r, f.p(6), f.p(7)).together.chemistry).toBeCloseTo(-0.5 / 6, 6);
  });

  it('is marked enough from five games together', () => {
    const f = new Fixture();
    for (let i = 0; i < 5; i++) f.add(Fixture.A, Fixture.B, 15, 12);
    const pair = pairOf(compute(f.players, f.games, S), f.p(0), f.p(1));
    expect(pair.together.games).toBe(5);
    expect(pair.together.enough).toBe(true);
    expect(pair.together.chemistry).toBeGreaterThan(0);
  });

  it('a pair that beats expectations is positive, one that underperforms is negative', () => {
    const f = new Fixture(16);
    const rand = rng(1);
    const shuffled = (xs: number[]) => xs.map((x) => ({ x, k: rand() })).sort((a, b) => a.k - b.k).map((o) => o.x);
    for (let i = 0; i < 40; i++) {
      const o = shuffled(Array.from({ length: 12 }, (_, k) => k + 4));
      f.add([0, 1, o[0], o[1], o[2], o[3]], [2, 3, o[4], o[5], o[6], o[7]], 15, 11);
      const a = [0, 2, o[8], o[9], o[10], o[11]];
      const b = [1, 3, o[0], o[1], o[2], o[3]];
      if (rand() < 0.5) f.add(a, b, 15, 13);
      else f.add(a, b, 13, 15);
    }
    const r = compute(f.players, f.games, S);
    expect(pairOf(r, f.p(0), f.p(1)).together.chemistry).toBeGreaterThan(0.05);
    expect(pairOf(r, f.p(2), f.p(3)).together.chemistry).toBeLessThan(-0.05);
  });
});

describe('streaks, MVPs, win %', () => {
  it('tracks current and longest streak', () => {
    const f = new Fixture();
    for (const w of [1, 1, 0, 1, 1, 1, 0, 1, 1]) f.add(Fixture.A, Fixture.B, w ? 15 : 10, w ? 10 : 15);
    const r = compute(f.players, f.games, S);
    expect(stats(r, f.p(0)).currentStreak).toBe(2);
    expect(stats(r, f.p(0)).longestStreak).toBe(3);
    expect(stats(r, f.p(6)).currentStreak).toBe(0);
    expect(stats(r, f.p(6)).longestStreak).toBe(1);
  });

  it('follows chronological order, not insertion order', () => {
    const f = new Fixture();
    const t0 = Date.UTC(2026, 2, 1, 18);
    f.add(Fixture.A, Fixture.B, 10, 15, { at: new Date(t0 + 30 * 60_000) });
    f.add(Fixture.A, Fixture.B, 15, 10, { at: new Date(t0) });
    f.add(Fixture.A, Fixture.B, 15, 10, { at: new Date(t0 + 15 * 60_000) });
    const a = stats(compute(f.players, f.games, S), f.p(0));
    expect(a.currentStreak).toBe(0);
    expect(a.longestStreak).toBe(2);
  });

  it('counts MVPs, win % and games per session', () => {
    const f = new Fixture();
    f.add(Fixture.A, Fixture.B, 15, 10, { mvp: 0 });
    f.add(Fixture.A, Fixture.B, 10, 15, { mvp: 6 });
    f.add(Fixture.A, Fixture.B, 15, 10, { mvp: 0 });
    const r = compute(f.players, f.games, S);
    const a = stats(r, f.p(0));
    expect(a.mvps).toBe(2);
    expect(a.winPct).toBeCloseTo(2 / 3, 9);
    expect(a.gamesBySession[f.session]).toBe(3);
    expect(r.sessionMvps[f.session]).toBe(f.p(0));
  });
});

describe('head-to-head', () => {
  it('records opponent and teammate results', () => {
    const f = new Fixture();
    f.add(Fixture.A, Fixture.B, 15, 10);
    f.add(Fixture.A, Fixture.B, 15, 12);
    f.add(Fixture.A, Fixture.B, 9, 15);
    f.add([0, 6, 2, 3, 4, 5], [1, 7, 8, 9, 10, 11], 15, 8);
    const pair = pairOf(compute(f.players, f.games, S), f.p(0), f.p(6));
    expect(pair.against.games).toBe(3);
    expect(pair.a === f.p(0) ? pair.against.aWins : pair.against.bWins).toBe(2);
    expect(pair.a === f.p(6) ? pair.against.aWins : pair.against.bWins).toBe(1);
    expect(pair.together.games).toBe(1);
    expect(pair.together.wins).toBe(1);
  });
});

describe('simulation', () => {
  const spearman = (x: number[], y: number[]) => {
    const rank = (v: number[]) => {
      const idx = v.map((val, i) => ({ val, i })).sort((a, b) => a.val - b.val);
      const r = new Array<number>(v.length);
      idx.forEach((o, k) => (r[o.i] = k));
      return r;
    };
    const rx = rank(x);
    const ry = rank(y);
    const mean = (a: number[]) => a.reduce((s, q) => s + q, 0) / a.length;
    const mx = mean(rx);
    const my = mean(ry);
    let cov = 0;
    let vx = 0;
    let vy = 0;
    for (let i = 0; i < rx.length; i++) {
      cov += (rx[i] - mx) * (ry[i] - my);
      vx += (rx[i] - mx) ** 2;
      vy += (ry[i] - my) ** 2;
    }
    return cov / Math.sqrt(vx * vy);
  };

  it('ratings roughly recover hidden true skills', () => {
    // ~15 sessions → ~50 games per player. Balanced 6v6 games carry little information per game,
    // so we expect a clear but imperfect correlation, averaged over seeds to avoid flakiness.
    const rhos = [1, 2, 3, 4, 5].map((seed) => {
      const world = generateDemo(seed);
      const r = compute(world.players.map((p) => p.id), world.sessions.flatMap((s) => s.games), S);
      const pts = world.players.map((p) => ({ truth: p.trueSkill, est: stats(r, p.id) })).filter((x) => x.est.games >= 10);
      return spearman(pts.map((x) => x.truth), pts.map((x) => x.est.mu));
    });
    expect(rhos.reduce((s, x) => s + x, 0) / rhos.length, rhos.map((x) => x.toFixed(2)).join(', ')).toBeGreaterThan(0.5);
    for (const rho of rhos) expect(rho).toBeGreaterThan(0.3);
  });

  it('simulated sessions and games pass validation', () => {
    const world = generateDemo(3);
    const ids = new Set(world.players.map((p) => p.id));
    for (const s of world.sessions) {
      expect(validateRoster({ teams: s.teams, players: s.roster }, S, ids, new Set())).toEqual([]);
      const teamIds = new Set(s.teams.map((t) => t.id));
      const present = new Set(s.roster.map((p) => p.playerId));
      for (const g of s.games) expect(validateGame(g, S, teamIds, present)).toEqual([]);
    }
  });
});
