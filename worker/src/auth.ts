/**
 * Admin sign-in without passwords or third-party identity providers.
 *
 * Each admin has a personal random code (≈190 bits), shared with them as a link `/signin#<code>`.
 * Opening it once exchanges the code for a long-lived HttpOnly session cookie. Only SHA-256 hashes of
 * codes and session tokens are stored, so a database leak doesn't hand out admin access. Codes are
 * high-entropy, so a fast hash is fine (no password-stretching needed, and it stays within the Workers
 * free-plan CPU budget).
 */

export const COOKIE = 'mj_admin';
export const SESSION_DAYS = 180;

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** URL-safe random string with `bytes` bytes of entropy. */
export function randomToken(bytes = 24): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function sessionCookie(req: Request, token: string | null): string {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return token
    ? `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`
    : `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export interface Admin {
  id: string;
  name: string;
  tokenHash: string;
}

export async function currentAdmin(req: Request, db: D1Database): Promise<Admin | null> {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await db
    .prepare('SELECT a.id, a.name FROM admin_sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .bind(tokenHash, new Date().toISOString())
    .first<{ id: string; name: string }>();
  return row ? { ...row, tokenHash } : null;
}

/** Writes must come from this site (defence in depth on top of SameSite cookies). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('Origin');
  if (!origin) return true; // non-browser clients; the cookie still has to be valid
  try {
    return new URL(origin).host === (req.headers.get('Host') ?? new URL(req.url).host);
  } catch {
    return false;
  }
}
