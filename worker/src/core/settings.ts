/** Court zones: 1 right receiver · 2 right hitter · 3 setter · 4 left hitter · 5 left receiver · 6 libero. */
export const POSITIONS = [1, 2, 3, 4, 5, 6] as const;
export const isValidPosition = (p: unknown): p is number => Number.isInteger(p) && (p as number) >= 1 && (p as number) <= 6;

/** Group-wide settings (admin-editable). Per-viewer preferences live in the browser. */
export interface GroupSettings {
  /** Positions each team must fill, one entry per player. */
  positionTemplate: number[];
  /** Allowed numbers of teams in a session (active players = teams × template size). */
  allowedTeamCounts: number[];
  targetScore: number;
  winByTwo: boolean;
  /** Games before a player's overall rating is official. */
  provisionalGames: number;
  /** Games at a position before that position rating counts. */
  minPositionGames: number;
  /** Games together before a pair's chemistry is shown. */
  minChemistryGames: number;
  goldThreshold: number;
  silverThreshold: number;
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

/** Merge stored/partial JSON over the defaults so new settings fields get sane values. */
export function normalizeSettings(raw: unknown): GroupSettings {
  const s = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? (raw as Partial<GroupSettings>) : {}) };
  return s;
}
