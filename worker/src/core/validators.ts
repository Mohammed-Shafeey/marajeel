import { isValidPosition, type GroupSettings } from './settings.ts';

/** `code` is stable and translated by the client; `message` is an English fallback. */
export interface ValidationError {
  code: string;
  message: string;
  params?: Record<string, unknown> | null;
}

export interface RosterTeam {
  id: string;
  label: string;
  color: string;
}
export interface RosterEntry {
  playerId: string;
  teamId: string | null;
  position: number | null;
  isBench: boolean;
}
export interface RosterInput {
  teams: RosterTeam[];
  players: RosterEntry[];
}

export interface GameParticipantInput {
  playerId: string;
  side: string;
  position: number;
}
export interface GameInput {
  id: string;
  sessionId: string;
  teamAId: string;
  teamBId: string;
  scoreA: number;
  scoreB: number;
  mvpPlayerId: string;
  participants: GameParticipantInput[];
}

const TEAM_COLORS = new Set(['a', 'b', 'c', 'd']);

const E = (code: string, message: string, params?: Record<string, unknown>): ValidationError => ({ code, message, params: params ?? null });

const sameMultiset = (a: readonly number[], b: readonly number[]) => {
  if (a.length !== b.length) return false;
  const x = a.slice().sort((p, q) => p - q);
  const y = b.slice().sort((p, q) => p - q);
  return x.every((v, i) => v === y[i]);
};

const duplicates = <T>(xs: readonly T[]) => {
  const seen = new Set<T>();
  const dup = new Set<T>();
  for (const x of xs) (seen.has(x) ? dup : seen).add(x);
  return [...dup];
};

const sortedTemplate = (s: GroupSettings) => s.positionTemplate.slice().sort((a, b) => a - b).join(',');

export function validatePlayer(name: unknown, preferredPosition: unknown): ValidationError[] {
  const errs: ValidationError[] = [];
  if (typeof name !== 'string' || !name.trim()) errs.push(E('player.nameRequired', 'Name is required.'));
  else if (name.trim().length > 80) errs.push(E('player.nameTooLong', 'Name must be at most 80 characters.', { max: 80 }));
  if (!isValidPosition(preferredPosition))
    errs.push(E('position.invalid', `Position ${String(preferredPosition)} is not valid (1–6).`, { position: preferredPosition }));
  return errs;
}

/**
 * Validates a session roster (check-in + base lineup).
 * `playersWithGames` = players who already appear in a game of this session; they can't be checked out.
 */
export function validateRoster(
  roster: RosterInput,
  s: GroupSettings,
  knownPlayerIds: ReadonlySet<string>,
  playersWithGames: ReadonlySet<string>,
  teamsUsedByGames: ReadonlySet<string> = new Set(),
): ValidationError[] {
  const errs: ValidationError[] = [];

  // Rule 1: a player appears at most once (→ at most one team).
  for (const id of duplicates(roster.players.map((p) => p.playerId)))
    errs.push(E('roster.duplicatePlayer', 'A player can be on at most one team in a session.', { playerId: id }));

  for (const p of roster.players) if (!knownPlayerIds.has(p.playerId)) errs.push(E('player.notFound', 'Unknown player.', { playerId: p.playerId }));

  const inRoster = new Set(roster.players.map((p) => p.playerId));
  for (const id of playersWithGames)
    if (!inRoster.has(id)) errs.push(E('roster.playerHasGames', "This player already played a game in this session and can't be removed.", { playerId: id }));

  const teamIds = new Set(roster.teams.map((t) => t.id));
  if (teamIds.size !== roster.teams.length) errs.push(E('roster.duplicateTeam', 'Duplicate team id.'));
  for (const t of roster.teams) {
    if (typeof t.label !== 'string' || !t.label.trim()) errs.push(E('team.labelRequired', 'Team name is required.', { teamId: t.id }));
    if (!TEAM_COLORS.has(t.color)) errs.push(E('team.colorInvalid', 'Team colour must be one of a, b, c, d.', { teamId: t.id }));
  }
  if (new Set(roster.teams.map((t) => t.color)).size !== roster.teams.length) errs.push(E('team.colorDuplicate', 'Each team needs a distinct colour.'));

  for (const id of teamsUsedByGames)
    if (!teamIds.has(id)) errs.push(E('roster.teamHasGames', "This team has recorded games and can't be removed.", { teamId: id }));

  for (const p of roster.players) {
    if (p.teamId != null && !teamIds.has(p.teamId)) errs.push(E('roster.unknownTeam', 'Player assigned to an unknown team.', { playerId: p.playerId }));
    if (p.isBench && p.position != null) errs.push(E('roster.benchHasPosition', "Bench players don't have a position.", { playerId: p.playerId }));
    if (p.position != null && !isValidPosition(p.position)) errs.push(E('position.invalid', `Position ${p.position} is not valid (1–6).`, { position: p.position }));
  }

  if (roster.teams.length === 0) {
    // Check-in only: nobody may be on a team or in a position yet.
    if (roster.players.some((p) => p.teamId != null || p.position != null)) errs.push(E('roster.noTeams', 'Create teams before assigning players.'));
    return errs;
  }

  if (!s.allowedTeamCounts.includes(roster.teams.length))
    errs.push(E('roster.teamCount', `A session needs ${s.allowedTeamCounts.join(' or ')} teams.`, { allowed: s.allowedTeamCounts }));

  // With teams: every checked-in player is either playing (team + position) or on the bench.
  for (const p of roster.players)
    if (!p.isBench && (p.teamId == null || p.position == null))
      errs.push(E('roster.unassigned', 'Every checked-in player must be on a team or on the bench.', { playerId: p.playerId }));

  const active = roster.players.filter((p) => !p.isBench);
  const expected = roster.teams.length * s.positionTemplate.length;
  if (active.length !== expected)
    errs.push(E('roster.activeCount', `Exactly ${expected} players must be playing (${active.length} now); bench the rest.`, { expected, actual: active.length }));

  for (const t of roster.teams) {
    const positions = active.filter((p) => p.teamId === t.id && p.position != null).map((p) => p.position as number);
    if (!sameMultiset(positions, s.positionTemplate))
      errs.push(E('roster.templateMismatch', `Team ${t.label} must fill positions ${sortedTemplate(s)}.`, { teamId: t.id, template: s.positionTemplate }));
  }
  return errs;
}

/** Validates a game. `sessionPlayerIds` = players checked into the game's session (rule 3). */
export function validateGame(g: GameInput, s: GroupSettings, sessionTeamIds: ReadonlySet<string>, sessionPlayerIds: ReadonlySet<string>): ValidationError[] {
  const errs: ValidationError[] = [];
  if (!g.id) errs.push(E('game.idRequired', 'Game id is required.'));

  if (g.teamAId === g.teamBId) errs.push(E('game.sameTeam', 'Choose two different teams.'));
  if (!sessionTeamIds.has(g.teamAId) || !sessionTeamIds.has(g.teamBId)) errs.push(E('game.unknownTeam', 'Both teams must belong to this session.'));

  // Rule 4: non-negative integers, no ties.
  if (!Number.isInteger(g.scoreA) || !Number.isInteger(g.scoreB)) errs.push(E('game.negativeScore', 'Scores must be whole numbers.'));
  if (g.scoreA < 0 || g.scoreB < 0) errs.push(E('game.negativeScore', "Scores can't be negative."));
  if (g.scoreA > 99 || g.scoreB > 99) errs.push(E('game.scoreTooHigh', 'Scores must be below 100.'));
  if (g.scoreA === g.scoreB) errs.push(E('game.tie', "A game can't end in a tie."));

  // Rule 2: no duplicates across both sides.
  for (const id of duplicates(g.participants.map((p) => p.playerId)))
    errs.push(E('game.duplicatePlayer', 'A player can appear only once in a game.', { playerId: id }));

  // Rule 3: participants must be checked into the session.
  for (const p of g.participants)
    if (!sessionPlayerIds.has(p.playerId)) errs.push(E('game.playerNotInSession', 'Every player must be checked into this session.', { playerId: p.playerId }));

  for (const p of g.participants) {
    if (p.side !== 'A' && p.side !== 'B') errs.push(E('game.sideInvalid', 'Side must be A or B.', { playerId: p.playerId }));
    if (!isValidPosition(p.position)) errs.push(E('position.invalid', `Position ${p.position} is not valid (1–6).`, { position: p.position }));
  }
  for (const side of ['A', 'B']) {
    const pos = g.participants.filter((p) => p.side === side).map((p) => p.position);
    if (!sameMultiset(pos, s.positionTemplate))
      errs.push(E('game.templateMismatch', `Side ${side} must fill positions ${sortedTemplate(s)}.`, { side, template: s.positionTemplate }));
  }

  // Rule 5: MVP must have played.
  if (!g.participants.some((p) => p.playerId === g.mvpPlayerId)) errs.push(E('game.mvpNotParticipant', "The MVP must be one of this game's players."));

  return errs;
}

export function validateSettings(s: GroupSettings): ValidationError[] {
  const errs: ValidationError[] = [];
  const intIn = (x: unknown, lo: number, hi: number) => Number.isInteger(x) && (x as number) >= lo && (x as number) <= hi;
  if (!Array.isArray(s.positionTemplate) || s.positionTemplate.length < 2 || s.positionTemplate.length > 6 || !s.positionTemplate.every(isValidPosition))
    errs.push(E('settings.template', 'The position template needs 2–6 positions, each between 1 and 6.'));
  if (!Array.isArray(s.allowedTeamCounts) || s.allowedTeamCounts.length === 0 || !s.allowedTeamCounts.every((c) => intIn(c, 2, 4)))
    errs.push(E('settings.teamCounts', 'Allowed team counts must be between 2 and 4.'));
  if (!intIn(s.targetScore, 5, 50)) errs.push(E('settings.targetScore', 'Target score must be between 5 and 50.'));
  if (typeof s.winByTwo !== 'boolean') errs.push(E('settings.targetScore', 'winByTwo must be true or false.'));
  if (!intIn(s.provisionalGames, 1, 50) || !intIn(s.minPositionGames, 1, 50) || !intIn(s.minChemistryGames, 1, 50))
    errs.push(E('settings.thresholds', 'Game thresholds must be between 1 and 50.'));
  if (!intIn(s.goldThreshold, 1, 100) || !intIn(s.silverThreshold, 1, 100) || s.silverThreshold >= s.goldThreshold)
    errs.push(E('settings.tiers', 'Card thresholds must be 1–100, silver below gold.'));
  return errs;
}
