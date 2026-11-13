import type { GameRecord, ParticipantRecord } from '../src/core/analytics.ts';

/** Tiny builder for hand-written game histories. */
export class Fixture {
  readonly session = crypto.randomUUID();
  readonly games: GameRecord[] = [];
  readonly players: string[];
  private readonly start = Date.UTC(2026, 0, 1, 18, 0, 0);

  constructor(players = 12) {
    this.players = Array.from({ length: players }, () => crypto.randomUUID());
  }

  p(i: number) {
    return this.players[i];
  }

  /** Adds a game: side A = players aIdx (positions 1..n in order), side B = bIdx. */
  add(aIdx: number[], bIdx: number[], scoreA: number, scoreB: number, opts: { mvp?: number; at?: Date } = {}): GameRecord {
    const participants: ParticipantRecord[] = [
      ...aIdx.map((p, i) => ({ playerId: this.players[p], side: 'A' as const, position: (i % 6) + 1 })),
      ...bIdx.map((p, i) => ({ playerId: this.players[p], side: 'B' as const, position: (i % 6) + 1 })),
    ];
    const mvp = this.players[opts.mvp ?? (scoreA > scoreB ? aIdx[0] : bIdx[0])];
    const at = (opts.at ?? new Date(this.start + this.games.length * 15 * 60_000)).toISOString();
    const g: GameRecord = { id: crypto.randomUUID(), sessionId: this.session, playedAt: at, createdAt: at, scoreA, scoreB, mvpPlayerId: mvp, participants };
    this.games.push(g);
    return g;
  }

  static readonly A = [0, 1, 2, 3, 4, 5];
  static readonly B = [6, 7, 8, 9, 10, 11];
}

/** Deterministic PRNG for tests. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
