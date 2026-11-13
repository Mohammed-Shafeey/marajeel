import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export type Role = 'admin' | 'judge';

export interface Me {
  signedIn: boolean;
  isAdmin: boolean;
  role: Role | null;
  name: string | null;
  id: string | null;
}

const ME = ['auth'] as const;

/**
 * Admin session (HttpOnly cookie set by `/api/auth/login`). Reading is public; only admins can
 * write, and that is enforced by the API, not just by this hook.
 */
export function useAuth() {
  const q = useQuery({
    queryKey: ME,
    queryFn: async (): Promise<Me | null> => {
      try {
        return await api<Me>('me');
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  const me = q.data ?? null;
  const isAdmin = !!me?.isAdmin;
  const isJudge = me?.role === 'judge';
  return {
    loading: q.isLoading,
    signedIn: !!me?.signedIn,
    isAdmin,
    isJudge,
    role: me?.role ?? null,
    /** Can start sessions (admins and judges). */
    canRun: isAdmin || isJudge,
    /** Can change this session's check-in, teams and games: admins always, judges only while it's open. */
    canEditSession: (status: string | undefined) => isAdmin || (isJudge && status === 'open'),
    name: me?.name ?? null,
    id: me?.id ?? null,
  };
}

export function useSignIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api<Me>('auth/login', { method: 'POST', json: { code } }),
    onSuccess: (me) => qc.setQueryData(ME, me),
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('auth/logout', { method: 'POST' }),
    onSuccess: () => qc.setQueryData(ME, { signedIn: false, isAdmin: false, role: null, name: null, id: null } satisfies Me),
  });
}

// ---- admin management --------------------------------------------------------------------------

export interface AdminInfo {
  id: string;
  name: string;
  role: Role;
  createdAt: string;
  isYou: boolean;
}
const ADMINS = ['admins'] as const;

export const useAdmins = (enabled: boolean) => useQuery({ queryKey: ADMINS, queryFn: () => api<AdminInfo[]>('admins'), enabled });

export const signInLink = (code: string) => `${location.origin}/signin#${code}`;

export function useAddAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, role }: { name: string; role: Role }) => api<{ id: string; code: string }>('admins', { method: 'POST', json: { name, role } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ADMINS }),
  });
}

export function useResetAdminLink() {
  return useMutation({ mutationFn: (id: string) => api<{ id: string; code: string }>(`admins/${id}/code`, { method: 'POST' }) });
}

export function useRemoveAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`admins/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ADMINS }),
  });
}
