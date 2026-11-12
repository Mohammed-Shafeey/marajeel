import type { ApiValidationError, Game, GroupSettings, RosterPlayer, Team } from '../api/types';

/**
 * Client-side mirror of the server's validators (api/Marajeel.Core/Validation/Validators.cs).
 * Same error codes, so messages come from the same translations. The server stays authoritative.
 */
type Err = ApiValidationError;
const E = (code: string, params?: Record<string, unknown>): Err => ({ code, message: code, params: params ?? null });

const sameMultiset = (a: number[], b: number[]) => {
  const x = a.slice().sort((p, q) => p - q);
  const y = b.slice().sort((p, q) => p - q);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

export function validateGame(g: Game, s: GroupSettings, teamIds: Set<string>, sessionPlayerIds: Set<string>): Err[] {
  const errs: Err[] = [];
  if (g.teamAId === g.teamBId) errs.push(E('game.sameTeam'));
  if (!teamIds.has(g.teamAId) || !teamIds.has(g.teamBId)) errs.push(E('game.unknownTeam'));

  // Rule 4
  if (!Number.isInteger(g.scoreA) || !Number.isInteger(g.scoreB) || g.scoreA < 0 || g.scoreB < 0) errs.push(E('game.negativeScore'));
  if (g.scoreA > 99 || g.scoreB > 99) errs.push(E('game.scoreTooHigh'));
  if (g.scoreA === g.scoreB) errs.push(E('game.tie'));

  // Rule 2
  const seen = new Set<string>();
  for (const p of g.participants) {
    if (seen.has(p.playerId)) errs.push(E('game.duplicatePlayer', { playerId: p.playerId }));
    seen.add(p.playerId);
  }
  // Rule 3
  for (const p of g.participants) if (!sessionPlayerIds.has(p.playerId)) errs.push(E('game.playerNotInSession', { playerId: p.playerId }));

  for (const side of ['A', 'B'] as const) {
    const pos = g.participants.filter((p) => p.side === side).map((p) => p.position);
    if (!sameMultiset(pos, s.positionTemplate)) errs.push(E('game.templateMismatch', { side }));
  }
  // Rule 5
  if (!g.participants.some((p) => p.playerId === g.mvpPlayerId)) errs.push(E('game.mvpNotParticipant'));
  return errs;
}

export function validateRoster(teams: Pick<Team, 'id' | 'label' | 'color'>[], players: RosterPlayer[], s: GroupSettings): Err[] {
  const errs: Err[] = [];
  // Rule 1
  const seen = new Set<string>();
  for (const p of players) {
    if (seen.has(p.playerId)) errs.push(E('roster.duplicatePlayer', { playerId: p.playerId }));
    seen.add(p.playerId);
  }
  if (new Set(teams.map((t) => t.color)).size !== teams.length) errs.push(E('team.colorDuplicate'));
  for (const t of teams) if (!t.label.trim()) errs.push(E('team.labelRequired', { teamId: t.id }));
  if (teams.length === 0) {
    if (players.some((p) => p.teamId || p.position)) errs.push(E('roster.noTeams'));
    return errs;
  }
  if (!s.allowedTeamCounts.includes(teams.length)) errs.push(E('roster.teamCount', { allowed: s.allowedTeamCounts }));
  for (const p of players) if (!p.isBench && (!p.teamId || !p.position)) errs.push(E('roster.unassigned', { playerId: p.playerId }));
  const active = players.filter((p) => !p.isBench);
  const expected = teams.length * s.positionTemplate.length;
  if (active.length !== expected) errs.push(E('roster.activeCount', { expected, actual: active.length }));
  for (const t of teams) {
    const pos = active.filter((p) => p.teamId === t.id && p.position).map((p) => p.position!);
    if (!sameMultiset(pos, s.positionTemplate)) errs.push(E('roster.templateMismatch', { teamId: t.id }));
  }
  return errs;
}

/** Soft hint (not an error): does the score look like a finished game under the target/win-by-two rule? */
export function scoreLooksFinished(a: number, b: number, s: GroupSettings): boolean {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (hi < s.targetScore) return false;
  if (!s.winByTwo) return hi === s.targetScore;
  return hi - lo >= 2 && (hi === s.targetScore || hi - lo === 2);
}

/** Session must have teams × template-size active players; the rest go to the bench. */
export function activeCountFor(teamCount: number, s: GroupSettings) {
  return teamCount * s.positionTemplate.length;
}
