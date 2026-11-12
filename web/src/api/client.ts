import type { ApiValidationError } from './types';

/** An error the server returned on purpose (4xx/5xx with a JSON body). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly errors: ApiValidationError[];
  constructor(status: number, code: string, message: string, errors: ApiValidationError[] = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

/** The request never reached the server (offline, DNS, CORS, timeout). Safe to queue and retry. */
export class NetworkError extends Error {}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`/api/${path}`, {
      ...rest,
      headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      credentials: 'same-origin',
    });
  } catch (e) {
    throw new NetworkError(e instanceof Error ? e.message : 'network');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? safeJson(text) : undefined;
  if (!res.ok) {
    // The SWA dev proxy answers 502/504 when the API is down: treat like offline.
    if (res.status === 502 || res.status === 503 || res.status === 504) throw new NetworkError(`HTTP ${res.status}`);
    const b = (body ?? {}) as { error?: string; message?: string; errors?: ApiValidationError[] };
    throw new ApiError(res.status, b.error ?? `http.${res.status}`, b.message ?? res.statusText, b.errors ?? []);
  }
  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
