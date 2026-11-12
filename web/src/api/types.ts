// Mirrors the API DTOs (camelCase JSON).

export type Guid = string;
export type Side = 'A' | 'B';
export type TeamColor = 'a' | 'b' | 'c' | 'd';

export interface Player {
  id: Guid;
  name: string;
  shortName: string | null;
  photoUrl: string | null;
  preferredPosition: number;
  isActive: boolean;
  createdAt: string;
}

export interface SessionSummary {
  id: Guid;
  date: string; // yyyy-mm-dd
  notes: string | null;
  status: 'open' | 'closed';
  playerCount: number;
  benchCount: number;
  teamCount: number;
  gameCount: number;
}

export interface Team {
  id: Guid;
  label: string;
  color: TeamColor;
  sortOrder: number;
}

export interface RosterPlayer {
  playerId: Guid;
  teamId: Guid | null;
  position: number | null;
  isBench: boolean;
}

export interface Participant {
  playerId: Guid;
  side: Side;
  position: number;
}

export interface Game {
  id: Guid;
  sessionId: Guid;
  teamAId: Guid;
  teamBId: Guid;
  scoreA: number;
  scoreB: number;
  mvpPlayerId: Guid;
  playedAt: string;
  participants: Participant[];
  /** Client-only: queued offline, not yet on the server. */
  pending?: boolean;
}

export interface SessionDetail {
  id: Guid;
  date: string;
  notes: string | null;
  status: 'open' | 'closed';
  teams: Team[];
  players: RosterPlayer[];
  games: Game[];
}

export interface GroupSettings {
  positionTemplate: number[];
  allowedTeamCounts: number[];
  targetScore: number;
  winByTwo: boolean;
  provisionalGames: number;
  minPositionGames: number;
  minChemistryGames: number;
  goldThreshold: number;
  silverThreshold: number;
}

export interface PositionStats {
  position: number;
  mu: number;
  sigma: number;
  rating: number;
  games: number;
  wins: number;
  established: boolean;
}

export interface RatingPoint {
  gameId: Guid;
  playedAt: string;
  rating: number;
}

export interface PlayerStats {
  playerId: Guid;
  mu: number;
  sigma: number;
  rating: number;
  provisional: boolean;
  games: number;
  wins: number;
  losses: number;
  winPct: number;
  mvps: number;
  currentStreak: number;
  longestStreak: number;
  bestPosition: number | null;
  positions: PositionStats[];
  ratingHistory: RatingPoint[];
  gamesBySession: Record<Guid, number>;
  ratingDelta: number;
  lastPlayedAt: string | null;
}

export interface PairStats {
  a: Guid;
  b: Guid;
  together: { games: number; wins: number; chemistry: number; enough: boolean };
  against: { games: number; aWins: number; bWins: number };
}

export interface Analytics {
  players: PlayerStats[];
  pairs: PairStats[];
  sessionMvps: Record<Guid, Guid>;
  gameCount: number;
  from: string | null;
  to: string | null;
}

export interface ApiValidationError {
  code: string;
  message: string;
  params?: Record<string, unknown> | null;
}

export const DEFAULT_SETTINGS: GroupSettings = {
  positionTemplate: [4, 3, 2, 5, 6, 1],
  allowedTeamCounts: [2, 3],
  targetScore: 15,
  winByTwo: true,
  provisionalGames: 5,
  minPositionGames: 5,
  minChemistryGames: 5,
  goldThreshold: 75,
  silverThreshold: 65,
};
