import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export interface Me {
  signedIn: boolean;
  isAdmin: boolean;
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
  return { loading: q.isLoading, signedIn: !!me?.signedIn, isAdmin: !!me?.isAdmin, name: me?.name ?? null, id: me?.id ?? null };
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
    onSuccess: () => qc.setQueryData(ME, { signedIn: false, isAdmin: false, name: null, id: null } satisfies Me),
  });
}

// ---- admin management --------------------------------------------------------------------------

export interface AdminInfo {
  id: string;
  name: string;
  createdAt: string;
  isYou: boolean;
}
const ADMINS = ['admins'] as const;

export const useAdmins = (enabled: boolean) => useQuery({ queryKey: ADMINS, queryFn: () => api<AdminInfo[]>('admins'), enabled });

export const signInLink = (code: string) => `${location.origin}/signin#${code}`;

export function useAddAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api<{ id: string; code: string }>('admins', { method: 'POST', json: { name } }),
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
