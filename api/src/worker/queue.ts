// INTEGRATION: add to api/src/server.ts before app.listen():
//   import { startWorker } from "./worker/queue.js";
//   startWorker({ db, chainClient, llm: makeLLMProvider(), sse, http });
//
// Worker queue wrapper.
//
// Two backends:
//   • In-memory FIFO  — default, used by tests and the hackathon single-process
//                       deployment. Lives only in this process; tasks queued
//                       before a crash are reloaded by re-scanning the DB for
//                       any status ∈ {pending, planning, executing, integrating}
//                       at startup (the reconcile path handles continuation).
//   • BullMQ          — opt-in when REDIS_URL is set. We dynamically import
//                       bullmq + ioredis so neither becomes a hard dependency
//                       of the api package. If the dynamic import fails we
//                       log + fall back to in-memory.
//
// The chosen backend honours the same `enqueueTask(taskId)` contract.

import type { ChainClient } from "./chain.js";
import type { WorkerDb } from "./db.js";
import type { LLMProvider } from "./llm.js";
import type { ProviderHttp } from "./runTask.js";
import { runTask } from "./runTask.js";
import type { SseHub } from "./sse.js";

export interface WorkerStartOptions {
  db: WorkerDb;
  chainClient: ChainClient;
  llm: LLMProvider;
  sse: SseHub;
  http: ProviderHttp;
  /** Override REDIS_URL detection. */
  redisUrl?: string | null;
}

export interface WorkerHandle {
  enqueueTask: (taskId: string) => Promise<void>;
  stop: () => Promise<void>;
}

// In-memory backend ----------------------------------------------------------

function startInMemoryWorker(opts: WorkerStartOptions): WorkerHandle {
  const queue: string[] = [];
  let running = false;
  let stopped = false;

  const drain = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      while (queue.length > 0 && !stopped) {
        const id = queue.shift();
        if (!id) break;
        try {
          await runTask(
            { taskId: id },
            {
              db: opts.db,
              chainClient: opts.chainClient,
              llm: opts.llm,
              sse: opts.sse,
              http: opts.http,
            },
          );
        } catch (err) {
          // The state machine is supposed to convert errors into terminal
          // task.failed states itself; if anything escapes we log and drop so
          // the queue doesn't wedge.
          // eslint-disable-next-line no-console
          console.error(`[worker] uncaught error for task ${id}:`, err);
        }
      }
    } finally {
      running = false;
    }
  };

  return {
    enqueueTask: async (taskId: string) => {
      queue.push(taskId);
      void drain();
    },
    stop: async () => {
      stopped = true;
    },
  };
}

// BullMQ backend (dynamically imported) --------------------------------------

async function startBullMqWorker(
  opts: WorkerStartOptions,
  redisUrl: string,
): Promise<WorkerHandle> {
  // We dynamically import so the api package doesn't take a hard runtime dep
  // on bullmq / ioredis. If either is missing we throw so the caller falls
  // back to in-memory.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mod: any;
  try {
    mod = await import(/* @vite-ignore */ "bullmq");
  } catch {
    throw new Error("bullmq not installed; using in-memory queue");
  }
  const { Queue, Worker } = mod;
  const connection = { url: redisUrl };
  const queue = new Queue("agentpay-tasks", { connection });
  const worker = new Worker(
    "agentpay-tasks",
    async (job: { data: { taskId: string } }) => {
      await runTask(
        { taskId: job.data.taskId },
        {
          db: opts.db,
          chainClient: opts.chainClient,
          llm: opts.llm,
          sse: opts.sse,
          http: opts.http,
        },
      );
    },
    { connection },
  );

  return {
    enqueueTask: async (taskId: string) => {
      await queue.add("run", { taskId });
    },
    stop: async () => {
      await worker.close();
      await queue.close();
    },
  };
}

export async function startWorker(opts: WorkerStartOptions): Promise<WorkerHandle> {
  const redisUrl =
    opts.redisUrl ?? process.env.REDIS_URL ?? process.env.UPSTASH_REDIS_URL ?? null;
  if (redisUrl) {
    try {
      return await startBullMqWorker(opts, redisUrl);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[worker] bullmq unavailable, falling back to in-memory:", err);
    }
  }
  return startInMemoryWorker(opts);
}
