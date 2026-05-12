/**
 * api/src/worker/http.ts
 *
 * Default `ProviderHttp` implementation — a thin fetch wrapper used by the
 * Worker to call tool Provider endpoints. The Worker is the SOLE producer of
 * the X-AgentPay-* headers documented in design doc §5.2, so we keep the
 * header set here in one place.
 *
 * `runTask.ts` already supplies the headers themselves (receipt id, agent id,
 * tool id, step idx, input hash); this helper only handles the transport.
 */

import type { ProviderHttp, ProviderRequest } from "./runTask.js";

export interface DefaultProviderHttpOptions {
  /** Override the global fetch (tests inject a stub). */
  fetchImpl?: typeof fetch;
  /** Per-call timeout in ms. Defaults to 30s. */
  timeoutMs?: number;
}

export function makeDefaultProviderHttp(
  opts: DefaultProviderHttpOptions = {},
): ProviderHttp {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 30_000;

  return async (req: ProviderRequest) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(req.url, {
        method: "POST",
        headers: req.headers,
        body: JSON.stringify(req.body),
        signal: controller.signal,
      });
      let body: { output?: unknown; error?: string } | null = null;
      try {
        body = (await res.json()) as { output?: unknown; error?: string };
      } catch {
        body = null;
      }
      return { status: res.status, body };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: 0,
        body: { error: `provider request failed: ${message}` },
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Singleton accessor — reuse one ProviderHttp instance across the process. */
let _default: ProviderHttp | null = null;
export function defaultProviderHttp(): ProviderHttp {
  if (_default === null) _default = makeDefaultProviderHttp();
  return _default;
}
