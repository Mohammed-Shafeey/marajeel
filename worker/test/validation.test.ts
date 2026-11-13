import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS as S } from '../src/core/settings.ts';
import { validateGame, validatePlayer, validateRoster, validateSettings, type GameInput, type RosterInput } from '../src/core/validators.ts';

const id = () => crypto.randomUUID();
const codes = (errs: { code: string }[]) => errs.map((e) => e.code);

describe('game validation', () => {
  const teamA = id();
  const teamB = id();
  const players = Array.from({ length: 14 }, id);
  const valid = (mutate: (g: GameInput) => GameInput = (g) => g): GameInput =>
    mutate({
      id: id(),
      sessionId: id(),
      teamAId: teamA,
      teamBId: teamB,
      scoreA: 15,
      scoreB: 12,
      mvpPlayerId: players[0],
      participants: [
        ...players.slice(0, 6).map((p, i) => ({ playerId: p, side: 'A', position: i + 1 })),
        ...players.slice(6, 12).map((p, i) => ({ playerId: p, side: 'B', position: i + 1 })),
      ],
    });
  const check = (g: GameInput, present = players.slice(0, 13)) => codes(validateGame(g, S, new Set([teamA, teamB]), new Set(present)));

  it('passes a valid game', () => expect(check(valid())).toEqual([]));

  it('rule 2: a player cannot appear twice across sides', () => {
    const g = valid((g) => ({ ...g, participants: g.participants.map((p, i) => (i === 6 ? { ...p, playerId: players[0] } : p)) }));
    expect(check(g)).toContain('game.duplicatePlayer');
  });

  it('rule 3: participants must be checked in', () => expect(check(valid(), players.slice(0, 11))).toContain('game.playerNotInSession'));

  it.each([
    [15, 15, 'game.tie'],
    [-1, 15, 'game.negativeScore'],
    [15, 100, 'game.scoreTooHigh'],
  ])('rule 4: %i–%i → %s', (a, b, code) => expect(check(valid((g) => ({ ...g, scoreA: a, scoreB: b })))).toContain(code));

  it('rule 4: deuce scores are fine', () => expect(check(valid((g) => ({ ...g, scoreA: 17, scoreB: 19 })))).toEqual([]));

  it('rule 5: the MVP must have played', () => expect(check(valid((g) => ({ ...g, mvpPlayerId: players[12] })))).toContain('game.mvpNotParticipant'));

  it('teams must differ and belong to the session', () => {
    expect(check(valid((g) => ({ ...g, teamBId: teamA })))).toContain('game.sameTeam');
    expect(check(valid((g) => ({ ...g, teamBId: id() })))).toContain('game.unknownTeam');
  });

  it('each side must fill the position template', () => {
    expect(check(valid((g) => ({ ...g, participants: g.participants.map((p, i) => (i === 0 ? { ...p, position: 2 } : p)) })))).toContain('game.templateMismatch');
    expect(check(valid((g) => ({ ...g, participants: g.participants.slice(1), mvpPlayerId: players[1] })))).toContain('game.templateMismatch');
  });
});

describe('roster validation', () => {
  const players = Array.from({ length: 20 }, id);
  const teams = [
    { id: id(), label: 'الأزرق', color: 'a' },
    { id: id(), label: 'البرتقالي', color: 'b' },
    { id: id(), label: 'البنفسجي', color: 'c' },
  ];
  const valid = (): RosterInput => ({
    teams,
    players: [
      ...Array.from({ length: 18 }, (_, i) => ({ playerId: players[i], teamId: teams[Math.floor(i / 6)].id, position: (i % 6) + 1, isBench: false })),
      { playerId: players[18], teamId: teams[0].id, position: null, isBench: true },
      { playerId: players[19], teamId: null, position: null, isBench: true },
    ],
  });
  const check = (r: RosterInput, withGames = new Set<string>()) => codes(validateRoster(r, S, new Set(players), withGames));

  it('passes a valid roster', () => expect(check(valid())).toEqual([]));

  it('passes check-in only', () =>
    expect(check({ teams: [], players: players.map((p) => ({ playerId: p, teamId: null, position: null, isBench: false })) })).toEqual([]));

  it('rule 1: a player is on at most one team', () => {
    const r = valid();
    r.players.push({ playerId: players[0], teamId: teams[1].id, position: 1, isBench: false });
    expect(check(r)).toContain('roster.duplicatePlayer');
  });

  it('active players must equal teams × template size', () => {
    const r = valid();
    r.players[17] = { ...r.players[17], isBench: true, position: null };
    const errs = check(r);
    expect(errs).toContain('roster.activeCount');
    expect(errs).toContain('roster.templateMismatch');
  });

  it('team count must be allowed', () => {
    const one = { teams: [teams[0]], players: players.slice(0, 6).map((p, i) => ({ playerId: p, teamId: teams[0].id, position: i + 1, isBench: false })) };
    expect(check(one)).toContain('roster.teamCount');
  });

  it('players with games cannot be removed', () => {
    const r = valid();
    r.players = r.players.filter((p) => p.playerId !== players[19]);
    expect(check(r, new Set([players[19]]))).toContain('roster.playerHasGames');
  });

  it('team colours must be distinct', () => {
    const r = valid();
    r.teams = [teams[0], teams[1], { ...teams[2], color: 'a' }];
    expect(check(r)).toContain('team.colorDuplicate');
  });
});

describe('player and settings validation', () => {
  it('validates players', () => {
    expect(codes(validatePlayer(' ', 3))).toContain('player.nameRequired');
    expect(codes(validatePlayer('محمد', 7))).toContain('position.invalid');
    expect(validatePlayer('محمد', 6)).toEqual([]);
  });

  it('validates settings', () => {
    expect(validateSettings(S)).toEqual([]);
    expect(codes(validateSettings({ ...S, silverThreshold: 80 }))).toContain('settings.tiers');
    expect(codes(validateSettings({ ...S, positionTemplate: [7] }))).toContain('settings.template');
    expect(codes(validateSettings({ ...S, allowedTeamCounts: [] }))).toContain('settings.teamCounts');
  });
});
