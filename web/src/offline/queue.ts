import { createStore, del, entries, set } from 'idb-keyval';
import { api, ApiError, NetworkError } from '../api/client';
import type { Game } from '../api/types';

/**
 * Offline-safe game writes. A write is attempted immediately; if the network is down it is stored
 * in IndexedDB and replayed later. Game ids are client-generated GUIDs and the API upserts by id,
 * so replaying the same write twice is harmless.
 */
export type QueuedOp =
  | { kind: 'putGame'; id: string; game: Game; queuedAt: number; lastError?: string }
  | { kind: 'deleteGame'; id: string; sessionId: string; queuedAt: number; lastError?: string }
  | { kind: 'rateGame'; id: string; gameId: string; playerId: string; stars: number; queuedAt: number; lastError?: string };

export type NewOp =
  | { kind: 'putGame'; id: string; game: Game }
  | { kind: 'deleteGame'; id: string; sessionId: string }
  /** id = `rate:<gameId>:<playerId>`; replayed after the game itself (queued later). */
  | { kind: 'rateGame'; id: string; gameId: string; playerId: string; stars: number };

const store = createStore('marajeel-offline', 'queue');
type Listener = (ops: QueuedOp[]) => void;
const listeners = new Set<Listener>();
let cache: QueuedOp[] = [];

async function refresh() {
  cache = (await entries<string, QueuedOp>(store)).map(([, v]) => v).sort((a, b) => a.queuedAt - b.queuedAt);
  listeners.forEach((l) => l(cache));
}

export function subscribe(l: Listener) {
  listeners.add(l);
  l(cache);
  return () => void listeners.delete(l);
}

export const queued = () => cache;

export function gameBody(g: Game) {
  return {
    sessionId: g.sessionId,
    teamAId: g.teamAId,
    teamBId: g.teamBId,
    scoreA: g.scoreA,
    scoreB: g.scoreB,
    mvpPlayerId: g.mvpPlayerId,
    playedAt: g.playedAt,
    participants: g.participants,
  };
}

async function send(op: QueuedOp) {
  if (op.kind === 'putGame') await api(`games/${op.id}`, { method: 'PUT', json: gameBody(op.game) });
  else if (op.kind === 'rateGame') await api(`games/${op.gameId}/ratings/${op.playerId}`, { method: 'PUT', json: { stars: op.stars } });
  else await api(`games/${op.id}`, { method: 'DELETE' });
}

/** Try now; on network failure, queue. Validation/auth errors are thrown to the caller. Returns true if sent. */
export async function submit(op: NewOp): Promise<boolean> {
  const full = { ...op, queuedAt: Date.now() } as QueuedOp;
  // A newer write for the same game supersedes any queued one.
  await del(op.id, store);
  try {
    if (!navigator.onLine) throw new NetworkError('offline');
    await send(full);
    await refresh();
    return true;
  } catch (e) {
    if (e instanceof NetworkError) {
      await set(op.id, full, store);
      await refresh();
      return false;
    }
    await refresh();
    throw e;
  }
}

let syncing = false;
type SyncResult = { sent: number; failed: { op: QueuedOp; error: ApiError }[] };

/** Replays queued writes in order. Rejected writes (validation) are dropped and reported. */
export async function sync(): Promise<SyncResult> {
  const result: SyncResult = { sent: 0, failed: [] };
  if (syncing || !navigator.onLine) return result;
  syncing = true;
  try {
    await refresh();
    for (const op of cache) {
      try {
        await send(op);
        await del(op.id, store);
        result.sent++;
      } catch (e) {
        if (e instanceof NetworkError) break; // still offline: keep the rest for later
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) break; // signed out: keep
        await del(op.id, store);
        result.failed.push({ op, error: e instanceof ApiError ? e : new ApiError(0, 'unknown', String(e)) });
      }
    }
  } finally {
    syncing = false;
    await refresh();
  }
  return result;
}

void refresh();
