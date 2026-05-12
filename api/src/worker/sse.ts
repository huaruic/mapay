// Pub/sub abstraction for SSE events.
//
// In-memory by default (works inside one process, fine for hackathon scope).
// A Redis pub/sub backend is sketched but not wired since adding ioredis here
// would force a hard dep on Upstash even when none is configured. The
// in-memory hub is sufficient for the API+Worker single-process deployment
// described in design doc §6.1.

export interface TaskEventEnvelope<TPayload = unknown> {
  taskId: string;
  seq: number;
  type: string;
  payload: TPayload;
  timestamp: string;
}

export type SseHandler = (event: TaskEventEnvelope) => void;

export interface SseHub {
  /** Publish an event to all subscribers of a task. */
  publish(taskId: string, event: TaskEventEnvelope): void;
  /** Subscribe to a task. Returns an unsubscribe fn. */
  subscribe(taskId: string, handler: SseHandler): () => void;
  /** Replay any locally buffered events with seq > after, for Last-Event-ID reconnect. */
  replay(taskId: string, after: number): TaskEventEnvelope[];
}

interface MemoryHubOptions {
  /** Max buffered events per task (FIFO). Defaults to 200. */
  bufferSize?: number;
}

export function createInMemorySseHub(opts: MemoryHubOptions = {}): SseHub {
  const bufferSize = opts.bufferSize ?? 200;
  const subs = new Map<string, Set<SseHandler>>();
  const buf = new Map<string, TaskEventEnvelope[]>();

  return {
    publish(taskId, event) {
      let arr = buf.get(taskId);
      if (!arr) {
        arr = [];
        buf.set(taskId, arr);
      }
      arr.push(event);
      if (arr.length > bufferSize) arr.splice(0, arr.length - bufferSize);

      const set = subs.get(taskId);
      if (!set) return;
      for (const h of set) {
        try {
          h(event);
        } catch {
          // Swallow handler errors so one bad subscriber doesn't kill the rest.
        }
      }
    },

    subscribe(taskId, handler) {
      let set = subs.get(taskId);
      if (!set) {
        set = new Set();
        subs.set(taskId, set);
      }
      set.add(handler);
      return () => {
        const s = subs.get(taskId);
        if (!s) return;
        s.delete(handler);
        if (s.size === 0) subs.delete(taskId);
      };
    },

    replay(taskId, after) {
      const arr = buf.get(taskId) ?? [];
      return arr.filter((e) => e.seq > after);
    },
  };
}
