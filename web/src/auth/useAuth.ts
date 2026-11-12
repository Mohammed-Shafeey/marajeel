import { useQuery } from '@tanstack/react-query';

interface ClientPrincipal {
  userDetails: string;
  userRoles: string[];
  identityProvider: string;
}

/**
 * Static Web Apps built-in auth. `/.auth/me` is served by SWA (and by the SWA CLI emulator locally).
 * Reading is public; only the `admin` role can write (enforced by the API, not just this hook).
 */
export function useAuth() {
  const q = useQuery({
    queryKey: ['auth'],
    queryFn: async () => {
      try {
        const res = await fetch('/.auth/me', { credentials: 'same-origin' });
        if (!res.ok) return null;
        const body = (await res.json()) as { clientPrincipal: ClientPrincipal | null };
        return body.clientPrincipal;
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  const p = q.data ?? null;
  return {
    loading: q.isLoading,
    signedIn: !!p,
    isAdmin: !!p?.userRoles.includes('admin'),
    name: p?.userDetails ?? null,
    signInUrl: `/.auth/login/github?post_login_redirect_uri=${encodeURIComponent(location.pathname)}`,
    signOutUrl: `/.auth/logout?post_logout_redirect_uri=/`,
  };
}
