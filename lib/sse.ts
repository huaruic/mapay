/**
 * Thin EventSource wrapper that
 *   1. preserves Last-Event-ID across reconnects (native EventSource already
 *      does this, but we also expose the current seq for diagnostics),
 *   2. parses each frame as JSON, and
 *   3. surfaces a typed onEvent callback that matches the API task event
 *      schema (see api/src/routes/tasks.ts → DEMO_EVENT_SEQUENCE).
 *
 * Usage:
 *   const sse = subscribeTaskEvents(taskId, {
 *     onEvent: (e) => setEvents((prev) => [...prev, e]),
 *     onError: () => {...},
 *   });
 *   // later: sse.close();
 */

export type TaskStreamEvent = {
  seq: number;
  taskId: string;
  type: string;
  [k: string]: unknown;
};

export type SubscribeHandlers = {
  onEvent: (event: TaskStreamEvent) => void;
  onError?: (err: Event) => void;
  onOpen?: () => void;
};

export type SseSubscription = {
  close: () => void;
  lastSeq: () => number;
};

function apiBase(): string {
  if (typeof window === "undefined") return "";
  // Browser env: same origin as the page unless overridden.
  return (
    process.env.NEXT_PUBLIC_API_URL ?? window.location.origin
  ).replace(/\/$/, "");
}

export function subscribeTaskEvents(
  taskId: string,
  handlers: SubscribeHandlers,
): SseSubscription {
  // EventSource is browser-only. In tests we typically swap in a fake before
  // calling this helper; guard so SSR doesn't crash if someone forgets the
  // "use client" boundary.
  if (typeof EventSource === "undefined") {
    return { close: () => {}, lastSeq: () => 0 };
  }

  const url = `${apiBase()}/api/tasks/${encodeURIComponent(taskId)}/stream`;
  const es = new EventSource(url, { withCredentials: true });
  let lastSeq = 0;

  const handle = (raw: MessageEvent) => {
    try {
      const parsed = JSON.parse(raw.data) as TaskStreamEvent;
      if (typeof parsed.seq === "number") lastSeq = parsed.seq;
      handlers.onEvent(parsed);
    } catch {
      // Drop malformed frame; demo mock always emits JSON.
    }
  };

  // Listen to every typed event name we expect — EventSource ignores the
  // generic `message` listener when the server names an event via
  // `event: <name>`.
  const eventTypes = [
    "plan.generated",
    "tool.discovered",
    "tool.call.started",
    "payment.confirmed",
    "tool.call.completed",
    "tool.call.failed",
    "integration.started",
    "task.completed",
    "task.failed",
  ];
  for (const t of eventTypes) es.addEventListener(t, handle as EventListener);
  // Also catch the default `message` channel in case the server changes its
  // naming convention.
  es.addEventListener("message", handle as EventListener);

  if (handlers.onOpen) es.addEventListener("open", () => handlers.onOpen?.());
  if (handlers.onError)
    es.addEventListener("error", (e) => handlers.onError?.(e));

  return {
    close: () => es.close(),
    lastSeq: () => lastSeq,
  };
}
