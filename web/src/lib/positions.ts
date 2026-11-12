/** Court zones, one player each. Front row 4·3·2 (by the net), back row 5·6·1. */
export const POSITIONS = [1, 2, 3, 4, 5, 6] as const;
export type Position = (typeof POSITIONS)[number];

/** i18n keys: `pos.<n>.long` / `pos.<n>.short`. */
export const isHitting = (p: number) => p === 2 || p === 4;
export const isReceiving = (p: number) => p === 1 || p === 5 || p === 6;
export const isSetting = (p: number) => p === 3;

/**
 * Where a zone sits within one half of the court, from that team's own view facing the net.
 * col: 0 = left, 1 = middle, 2 = right. row: 0 = front (net), 1 = back.
 */
export const ZONE_GRID: Record<number, { col: 0 | 1 | 2; row: 0 | 1 }> = {
  4: { col: 0, row: 0 },
  3: { col: 1, row: 0 },
  2: { col: 2, row: 0 },
  5: { col: 0, row: 1 },
  6: { col: 1, row: 1 },
  1: { col: 2, row: 1 },
};

/** Teammate adjacency used for chemistry lines: row neighbours + same column (max 7 links). */
export const ZONE_LINKS: [number, number][] = [
  [4, 3], [3, 2], [5, 6], [6, 1],
  [4, 5], [3, 6], [2, 1],
];
