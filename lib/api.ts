/**
 * lib/api.ts — typed fetch client for the AgentPay backend.
 *
 * Mirrors the JSON shapes implemented in api/src/routes/*.ts. Every helper
 * uses `credentials: "include"` so the SIWE session cookie flows on every
 * request (the auth route sets an httpOnly cookie on /auth/verify).
 *
 * Base URL comes from `NEXT_PUBLIC_API_URL`, falling back to
 * `http://localhost:4000` for local dev — match the API's default PORT.
 */

// ── Shared types ────────────────────────────────────────────────────────────

/** Wire shape of a Marketplace tool. Must stay in sync with
 *  `api/src/lib/mock-tools.ts` Tool + chain-watcher cache rows. */
export type Tool = {
  id: string;
  provider: `0x${string}`;
  name: string;
  description: string;
  priceWei: string;
  priceDisplay: string;
  version: number;
  schemaHash: `0x${string}`;
  endpoint: string;
  enabled: boolean;
  calls: number;
  rating: number | null;
};

export type ToolListResponse = {
  tools: Tool[];
  nextCursor: string | null;
};

export type HealthResponse = {
  ok: boolean;
  ts: string;
};

export type NonceResponse = {
  nonce: string;
  message: string | null;
};

export type VerifyResponse = {
  address: string;
};

export type LogoutResponse = {
  ok: true;
};

export type MeResponse = {
  address: string;
};

// ── Internals ───────────────────────────────────────────────────────────────

const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `API ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type RequestOpts = {
  method?: "GET" | "POST";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
};

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { method = "GET", body, query, signal } = opts;

  let url = `${API_BASE}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const res = await fetch(url, {
    method,
    credentials: "include",
    signal,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Parse JSON best-effort; some endpoints (errors) still return JSON, but
  // we don't want a malformed body to throw a confusing parse error.
  let parsed: unknown = null;
  const text = await res.text();
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    throw new ApiError(res.status, parsed);
  }
  return parsed as T;
}

// ── Marketplace ─────────────────────────────────────────────────────────────

export function getMarketplaceTools(opts?: {
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<ToolListResponse> {
  return request<ToolListResponse>("/api/marketplace/tools", {
    query: { cursor: opts?.cursor, limit: opts?.limit },
    signal: opts?.signal,
  });
}

export function getTool(id: string, signal?: AbortSignal): Promise<Tool> {
  return request<Tool>(`/api/tools/${encodeURIComponent(id)}`, { signal });
}

// ── Health ──────────────────────────────────────────────────────────────────

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return request<HealthResponse>("/healthz", { signal });
}

// ── Auth ────────────────────────────────────────────────────────────────────

/** POST /api/auth/nonce — optionally pass address+uri so the server returns
 *  a ready-to-sign SIWE message. Returns nonce always; message only when
 *  both address and uri are supplied. */
export function authNonce(
  body?: { address?: string; uri?: string },
  signal?: AbortSignal,
): Promise<NonceResponse> {
  return request<NonceResponse>("/api/auth/nonce", {
    method: "POST",
    body: body ?? {},
    signal,
  });
}

/** POST /api/auth/verify — validates SIWE message + signature, sets the
 *  session cookie on success. */
export function authVerify(
  message: string,
  signature: string,
  signal?: AbortSignal,
): Promise<VerifyResponse> {
  return request<VerifyResponse>("/api/auth/verify", {
    method: "POST",
    body: { message, signature },
    signal,
  });
}

/** POST /api/auth/logout — clears the session cookie. */
export function authLogout(signal?: AbortSignal): Promise<LogoutResponse> {
  return request<LogoutResponse>("/api/auth/logout", {
    method: "POST",
    signal,
  });
}

/** GET /api/auth/me — returns the authenticated address, throws 401 if not. */
export function authMe(signal?: AbortSignal): Promise<MeResponse> {
  return request<MeResponse>("/api/auth/me", { signal });
}
