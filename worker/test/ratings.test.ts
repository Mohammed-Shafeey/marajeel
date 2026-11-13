import { describe, expect, it } from 'vitest';
import { compute } from '../src/core/analytics.ts';
import { DEFAULT_SETTINGS as S } from '../src/core/settings.ts';
import { applyJudgeRating, defaultRating, INITIAL_MU, INITIAL_SIGMA, marginWeight, toDisplay, update, winProbability, type Rating } from '../src/core/trueskill.ts';
import { Fixture } from './fixture.ts';

const team = (r: Rating = defaultRating(), n = 6) => Array.from({ length: n }, () => ({ ...r }));
const stats = (r: ReturnType<typeof compute>, id: string) => r.players.find((p) => p.playerId === id)!;

describe('TrueSkill', () => {
  it('even teams have a 50% win probability', () => {
    expect(winProbability(team(), team())).toBeCloseTo(0.5, 6);
  });

  it('winners go up, losers go down, everyone gets more certain', () => {
    const { winners, losers } = update(team(), team());
    for (const r of winners) expect(r.mu).toBeGreaterThan(INITIAL_MU);
    for (const r of losers) expect(r.mu).toBeLessThan(INITIAL_MU);
    for (const r of [...winners, ...losers]) expect(r.sigma).toBeLessThan(INITIAL_SIGMA);
    expect(winners[0].mu - 25).toBeCloseTo(25 - losers[0].mu, 9);
  });

  it('an upset moves ratings more than an expected result', () => {
    const strong = team({ mu: 30, sigma: 3 });
    const weak = team({ mu: 20, sigma: 3 });
    const expected = update(strong, weak).winners[0].mu - 30;
    const upset = update(weak, strong).winners[0].mu - 20;
    expect(upset).toBeGreaterThan(expected);
  });

  it.each([
    [1, 1.0],
    [2, 1.0],
    [6, 1.25],
    [10, 1.5],
    [15, 1.5],
  ])('margin weight for %i points is %f (capped at 1.5)', (m, w) => {
    expect(marginWeight(m)).toBeCloseTo(w, 9);
  });

  it('a blowout moves μ exactly 1.5× a close game', () => {
    const close = update(team(), team(), marginWeight(2)).winners[0].mu - 25;
    const blowout = update(team(), team(), marginWeight(15)).winners[0].mu - 25;
    expect(blowout / close).toBeCloseTo(1.5, 6);
  });

  it('display mapping matches the documented points', () => {
    expect(toDisplay(defaultRating())).toBe(40);
    expect(toDisplay({ mu: 33.4, sigma: 1.8 })).toBe(82);
    expect(toDisplay({ mu: -50, sigma: 5 })).toBe(0);
    expect(toDisplay({ mu: 80, sigma: 1 })).toBe(100);
  });
});

describe('replay', () => {
  it('is deterministic and independent of input order', () => {
    const f = new Fixture();
    for (let i = 0; i < 8; i++) f.add(Fixture.A, Fixture.B, i % 3 === 0 ? 12 : 15, i % 3 === 0 ? 15 : 10);
    const r1 = compute(f.players, f.games, S);
    const r2 = compute(f.players, f.games.slice().reverse(), S);
    for (const p of r1.players) {
      const q = stats(r2, p.playerId);
      expect(q.mu).toBeCloseTo(p.mu, 12);
      expect(q.sigma).toBeCloseTo(p.sigma, 12);
    }
  });

  it('correcting a score recomputes everything consistently', () => {
    const f = new Fixture();
    const g = f.add(Fixture.A, Fixture.B, 15, 3);
    f.add(Fixture.A, Fixture.B, 15, 13);
    const wrong = compute(f.players, f.games, S);
    f.games[0] = { ...g, scoreA: 3, scoreB: 15 };
    const fixed = compute(f.players, f.games, S);
    const fresh = compute(f.players, f.games.slice(), S);
    expect(fresh.players.map((p) => p.mu)).toEqual(fixed.players.map((p) => p.mu));
    const a0 = stats(fixed, f.p(0));
    expect(a0.wins).toBe(1);
    expect(a0.losses).toBe(1);
    expect(stats(wrong, f.p(0)).mu).not.toBe(a0.mu);
  });

  it('a position track only updates from games at that position', () => {
    const f = new Fixture();
    for (let i = 0; i < 5; i++) f.add(Fixture.A, Fixture.B, 15, 10);
    const p0 = stats(compute(f.players, f.games, S), f.p(0));
    expect(p0.positions).toHaveLength(1);
    expect(p0.positions[0].position).toBe(1);
    expect(p0.positions[0].games).toBe(5);
    expect(p0.bestPosition).toBe(1);
  });

  it('best position needs enough games at that position', () => {
    const f = new Fixture();
    for (let i = 0; i < 4; i++) f.add(Fixture.A, Fixture.B, 15, 10);
    const p0 = stats(compute(f.players, f.games, S), f.p(0));
    expect(p0.bestPosition).toBeNull();
    expect(p0.provisional).toBe(true);
  });

  it('rating history has one point per game played', () => {
    const f = new Fixture(14);
    f.add(Fixture.A, Fixture.B, 15, 10);
    f.add([0, 1, 2, 3, 4, 12], [6, 7, 8, 9, 10, 13], 15, 10);
    const r = compute(f.players, f.games, S);
    expect(stats(r, f.p(0)).ratingHistory).toHaveLength(2);
    expect(stats(r, f.p(5)).ratingHistory).toHaveLength(1);
  });

  it('a window counts only games inside it, but ratings use the full history', () => {
    const f = new Fixture();
    f.add(Fixture.A, Fixture.B, 15, 5, { at: new Date(Date.UTC(2026, 0, 10, 18)) });
    f.add(Fixture.A, Fixture.B, 5, 15, { at: new Date(Date.UTC(2026, 1, 10, 18)) });
    const all = stats(compute(f.players, f.games, S), f.p(0));
    const month = stats(compute(f.players, f.games, S, '2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z'), f.p(0));
    expect(all.games).toBe(2);
    expect(month.games).toBe(1);
    expect(month.wins).toBe(0);
    expect(month.mu).toBe(all.mu);
    expect(month.ratingDelta).toBeLessThan(0);
  });
});

describe('Judge star ratings', () => {
  it('3 stars changes nothing; 5 stars raises and 1 star lowers μ, σ untouched', () => {
    const r = { mu: 25, sigma: 5 };
    expect(applyJudgeRating(r, 3)).toEqual(r);
    expect(applyJudgeRating(r, 5).mu).toBeGreaterThan(25);
    expect(applyJudgeRating(r, 1).mu).toBeLessThan(25);
    expect(applyJudgeRating(r, 5).sigma).toBe(5);
    expect(applyJudgeRating(r, 5).mu - 25).toBeCloseTo(25 - applyJudgeRating(r, 1).mu, 12);
  });

  it('moves uncertain (new) players more than established ones', () => {
    const fresh = applyJudgeRating({ mu: 25, sigma: INITIAL_SIGMA }, 5).mu - 25;
    const settled = applyJudgeRating({ mu: 25, sigma: 2 }, 5).mu - 25;
    expect(fresh).toBeGreaterThan(2 * settled);
  });

  it('is blended into the replay and counted per player', () => {
    const f = new Fixture();
    const g = f.add(Fixture.A, Fixture.B, 15, 12);
    const before = stats(compute(f.players, f.games, S), f.p(1));
    f.games[0] = { ...g, judgeRatings: [{ playerId: f.p(1), stars: 5 }, { playerId: f.p(7), stars: 1 }] };
    const r = compute(f.players, f.games, S);
    const p1 = stats(r, f.p(1));
    expect(p1.mu).toBeGreaterThan(before.mu);
    expect(p1.positions[0].mu).toBeGreaterThan(before.positions[0].mu);
    expect(p1.judgeRatings).toBe(1);
    expect(p1.judgeAvg).toBe(5);
    expect(stats(r, f.p(7)).mu).toBeLessThan(stats(compute(f.players, [g], S), f.p(7)).mu);
    expect(stats(r, f.p(2)).judgeAvg).toBeNull();
  });

  it('ignores a rating for someone no longer in the lineup', () => {
    const f = new Fixture(13);
    const g = f.add(Fixture.A, Fixture.B, 15, 12);
    const withStray = { ...g, judgeRatings: [{ playerId: f.p(12), stars: 5 }] };
    expect(stats(compute(f.players, [withStray], S), f.p(12)).judgeRatings).toBe(0);
  });
});
