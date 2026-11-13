import type { ValidationError } from './core/validators.ts';

/** Thrown inside handlers to produce a clean 4xx response. */
export class ApiException extends Error {
  readonly status: number;
  readonly code: string;
  readonly errors: ValidationError[] | null;
  constructor(status: number, code: string, message: string, errors: ValidationError[] | null = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

export const notFound = (what: string) => new ApiException(404, `${what}.notFound`, `${what} not found.`);

export function throwIfInvalid(errors: ValidationError[]) {
  if (errors.length) throw new ApiException(400, 'validation', errors.map((e) => e.message).join('; '), errors);
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers },
  });
}

export const noContent = (headers: Record<string, string> = {}) => new Response(null, { status: 204, headers: { ...SECURITY_HEADERS, ...headers } });

export const errorResponse = (status: number, code: string, message: string, errors: ValidationError[] | null = null) =>
  json({ error: code, message, errors }, status);

export async function body<T>(req: Request): Promise<T> {
  let text: string;
  try {
    text = await req.text();
  } catch {
    throw new ApiException(400, 'request.emptyBody', 'Request body is required.');
  }
  if (!text) throw new ApiException(400, 'request.emptyBody', 'Request body is required.');
  try {
    const v = JSON.parse(text) as unknown;
    if (v === null || typeof v !== 'object') throw new Error('not an object');
    return v as T;
  } catch (e) {
    throw new ApiException(400, 'request.invalidJson', `Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}`);
  }
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isGuid = (s: unknown): s is string => typeof s === 'string' && GUID_RE.test(s);

/** Lower-cased GUID, or a 400. */
export function guid(s: unknown, field: string): string {
  if (!isGuid(s)) throw new ApiException(400, 'request.invalidId', `'${field}' must be a GUID.`);
  return s.toLowerCase();
}

/** Normalises any parseable date-time to ISO UTC, or a 400. */
export function isoDateTime(s: unknown, field: string): string {
  const t = typeof s === 'string' ? Date.parse(s) : NaN;
  if (Number.isNaN(t)) throw new ApiException(400, 'request.invalidDate', `'${field}' must be an ISO date.`);
  return new Date(t).toISOString();
}
