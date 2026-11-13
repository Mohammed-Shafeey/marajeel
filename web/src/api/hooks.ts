import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { queued, submit, subscribe, type QueuedOp } from '../offline/queue';
import { buildContext } from '../lib/teamRating';
import { api } from './client';
import {
  DEFAULT_SETTINGS,
  type Analytics,
  type Game,
  type GroupSettings,
  type Player,
  type RosterPlayer,
  type SessionDetail,
  type SessionSummary,
  type Team,
} from './types';

export const qk = {
  players: ['players'] as const,
  sessions: ['sessions'] as const,
  session: (id: string) => ['session', id] as const,
  analytics: (window: string) => ['analytics', window] as const,
  settings: ['settings'] as const,
};

/** Anything derived from games must refetch after a game write. */
export function invalidateDerived(qc: QueryClient, sessionId?: string) {
  void qc.invalidateQueries({ queryKey: ['analytics'] });
  void qc.invalidateQueries({ queryKey: qk.sessions });
  if (sessionId) void qc.invalidateQueries({ queryKey: qk.session(sessionId) });
}

export const usePlayers = () => useQuery({ queryKey: qk.players, queryFn: () => api<Player[]>('players') });
export const useSessions = () => useQuery({ queryKey: qk.sessions, queryFn: () => api<SessionSummary[]>('sessions') });
export const useSettings = () => {
  const q = useQuery({ queryKey: qk.settings, queryFn: () => api<GroupSettings>('settings'), staleTime: 5 * 60_000 });
  return { ...q, settings: q.data ?? DEFAULT_SETTINGS };
};

export type AnalyticsWindow = 'all' | 'month';
export function monthRange(d = new Date()) {
  const from = new Date(d.getFullYear(), d.getMonth(), 1);
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function useAnalytics(window: AnalyticsWindow = 'all') {
  return useQuery({
    queryKey: qk.analytics(window),
    queryFn: () => {
      if (window === 'all') return api<Analytics>('analytics');
      const { from, to } = monthRange();
      return api<Analytics>(`analytics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    },
    staleTime: 30_000,
  });
}

/** Rating context (stats + chemistry + settings) for the shared team-rating function. */
export function useRatingContext() {
  const analytics = useAnalytics('all');
  const { settings } = useSettings();
  const ctx = useMemo(() => buildContext(analytics.data, settings), [analytics.data, settings]);
  return { ctx, isLoading: analytics.isLoading, analytics: analytics.data };
}

export function useQueue(): QueuedOp[] {
  const [ops, setOps] = useState<QueuedOp[]>(queued());
  useEffect(() => subscribe(setOps), []);
  return ops;
}

/** Session detail with offline-queued game writes overlaid, so the organiser sees what they recorded. */
export function useSession(id: string | undefined) {
  const q = useQuery({ queryKey: qk.session(id ?? ''), queryFn: () => api<SessionDetail>(`sessions/${id}`), enabled: !!id });
  const ops = useQueue();
  const data = useMemo(() => {
    if (!q.data) return q.data;
    let games = q.data.games.slice();
    for (const op of ops) {
      if (op.kind === 'putGame' && op.game.sessionId === q.data.id) {
        games = games.filter((g) => g.id !== op.id).concat({ ...op.game, pending: true });
      } else if (op.kind === 'deleteGame' && op.sessionId === q.data.id) {
        games = games.filter((g) => g.id !== op.id);
      }
    }
    games.sort((a, b) => a.playedAt.localeCompare(b.playedAt));
    return { ...q.data, games };
  }, [q.data, ops]);
  return { ...q, data };
}

// ---- mutations ---------------------------------------------------------------------------------

export function useSavePlayer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { id?: string; name: string; shortName: string | null; preferredPosition: number; isActive?: boolean }) =>
      p.id ? api<Player>(`players/${p.id}`, { method: 'PUT', json: p }) : api<Player>('players', { method: 'POST', json: p }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.players }),
  });
}

export function usePlayerPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, blob }: { id: string; blob: Blob | null }) =>
      blob
        ? api<Player>(`players/${id}/photo`, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/webp' } })
        : api<Player>(`players/${id}/photo`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.players }),
  });
}

export function useCreateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: { date: string; notes: string | null }) => api<SessionDetail>('sessions', { method: 'POST', json: s }),
    onSuccess: (s) => {
      qc.setQueryData(qk.session(s.id), s);
      void qc.invalidateQueries({ queryKey: qk.sessions });
    },
  });
}

export function useUpdateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: { id: string; date: string; notes: string | null; status?: 'open' | 'closed' }) =>
      api<SessionDetail>(`sessions/${s.id}`, { method: 'PUT', json: s }),
    onSuccess: (s) => {
      qc.setQueryData(qk.session(s.id), s);
      void qc.invalidateQueries({ queryKey: qk.sessions });
    },
  });
}

export function useDeleteSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateDerived(qc),
  });
}

export function useSaveRoster(sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (r: { teams: Pick<Team, 'id' | 'label' | 'color'>[]; players: RosterPlayer[] }) =>
      api<SessionDetail>(`sessions/${sessionId}/roster`, { method: 'PUT', json: r }),
    onSuccess: (s) => {
      qc.setQueryData(qk.session(s.id), s);
      void qc.invalidateQueries({ queryKey: qk.sessions });
    },
  });
}

/** Returns true when sent, false when queued offline. */
export function useSaveGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (g: Game) => submit({ kind: 'putGame', id: g.id, game: { ...g, pending: undefined } }),
    onSuccess: (_sent, g) => invalidateDerived(qc, g.sessionId),
  });
}

export function useDeleteGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (g: { id: string; sessionId: string }) => submit({ kind: 'deleteGame', id: g.id, sessionId: g.sessionId }),
    onSuccess: (_sent, g) => invalidateDerived(qc, g.sessionId),
  });
}

/** A judge's 1–5 star rating of one player in a just-saved game (queued offline like game writes). */
export function useRatePlayer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (r: { gameId: string; playerId: string; stars: number }) => submit({ kind: 'rateGame', id: `rate:${r.gameId}:${r.playerId}`, ...r }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['analytics'] }),
  });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: GroupSettings) => api<GroupSettings>('settings', { method: 'PUT', json: s }),
    onSuccess: (s) => {
      qc.setQueryData(qk.settings, s);
      void qc.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
}
