/**
 * Browser API client.
 * - Attaches the Firebase ID token in production (token provider is injected).
 * - Retries ONLY on network failures / 5xx / 429, re-sending the identical body,
 *   so a claim retry carries the same idempotency key and can never double-claim.
 * - Never fabricates success: if every attempt fails, it throws NetworkError and
 *   the UI must show "NOT RECORDED".
 */

export class NetworkError extends Error {
  constructor(message = "Network error. The server could not be reached.") {
    super(message);
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

type TokenProvider = (forceRefresh?: boolean) => Promise<string | null>;
let tokenProvider: TokenProvider = async () => null;
export function setTokenProvider(p: TokenProvider) {
  tokenProvider = p;
}

export interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  rawBody?: string;
  contentType?: string;
  retries?: number;
  timeoutMs?: number;
  /** Demo dual-counter page: act as a specific demo volunteer. */
  demoActor?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { method = opts.body !== undefined || opts.rawBody !== undefined ? "POST" : "GET", retries = 3, timeoutMs = 10000 } = opts;
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const body = opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined);
  let lastErr: unknown;
  let refreshedToken = false;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(Math.min(4000, 400 * 2 ** (attempt - 1)) + Math.random() * 150);
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = opts.contentType ?? "application/json";
    const token = await tokenProvider(refreshedToken);
    if (token) headers.Authorization = `Bearer ${token}`;
    const demo = opts.demoActor;
    if (demo) headers["x-demo-actor"] = demo;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(path, { method, headers, body, signal: ctrl.signal, credentials: "same-origin", cache: "no-store" });
    } catch (e) {
      lastErr = e;
      continue; // network failure / timeout: safe to retry (idempotent by key)
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) {
      const ct = res.headers.get("content-type") ?? "";
      return (ct.includes("application/json") ? await res.json() : await res.text()) as T;
    }
    let code = "HTTP_" + res.status;
    let message = `Request failed (${res.status}).`;
    try {
      const j = await res.json();
      code = j?.error?.code ?? code;
      message = j?.error?.message ?? message;
    } catch {
      /* non-JSON error */
    }
    if (res.status === 401 && !refreshedToken) {
      refreshedToken = true;
      attempt--; // one free retry with a refreshed token
      continue;
    }
    if (res.status >= 500 || res.status === 429) {
      lastErr = new ApiError(res.status, code, message);
      continue;
    }
    throw new ApiError(res.status, code, message);
  }
  if (lastErr instanceof ApiError) throw lastErr;
  throw new NetworkError();
}

export function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
