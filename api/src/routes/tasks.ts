// INTEGRATION: register in api/src/server.ts via: app.register(tasksRoutes);

import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { encodeFunctionData, keccak256, toHex } from "viem";
import { z } from "zod";
import { requireAuth } from "../lib/auth-guard.js";
import {
  appendTaskEvent,
  getAgent,
  getTask,
  getTaskEventsAfter,
  createTask as storeCreateTask,
  markTaskCompleted,
  markTaskExecuting,
  setAgentCurrentTask,
  type TaskEvent,
} from "../lib/in-memory-store.js";
import { MOCK_TOOLS } from "../lib/mock-tools.js";
import {
  MARKETPLACE_ABI,
  MARKETPLACE_ADDRESS,
} from "../lib/marketplace-abi.js";
import type { TaskEventEnvelope } from "../worker/sse.js";

const createTaskSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  parentTaskId: z.string().uuid().optional(),
});

const rateTaskSchema = z.object({
  stars: z.coerce.number().int().min(1).max(5),
});

// SSE event sequence emitted by the demo mock-worker. Each item carries the
// payload that the frontend timeline knows how to render. TODO(track-e): real
// Worker emits these via Redis pub/sub; the route below subscribes instead of
// timing them out itself.
const DEMO_EVENT_SEQUENCE: ReadonlyArray<{
  type: string;
  payload: () => Record<string, unknown>;
  delayMs: number;
}> = [
  {
    type: "plan.generated",
    delayMs: 250,
    payload: () => ({
      steps: [
        { idx: 0, toolId: "1", reason: "draft copy" },
        { idx: 1, toolId: "2", reason: "image 1/3" },
        { idx: 2, toolId: "2", reason: "image 2/3" },
        { idx: 3, toolId: "2", reason: "image 3/3" },
      ],
    }),
  },
  {
    type: "tool.discovered",
    delayMs: 200,
    payload: () => ({
      tools: [
        { id: "1", name: "Copywriter Agent" },
        { id: "2", name: "Image Generator" },
        { id: "3", name: "Premium Copy Pro" },
      ],
    }),
  },
  {
    type: "tool.call.started",
    delayMs: 300,
    payload: () => ({ stepIdx: 0, toolId: "1", amount: "0.030" }),
  },
  {
    type: "payment.confirmed",
    delayMs: 200,
    payload: () => ({
      stepIdx: 0,
      txHash:
        "0xa441000000000000000000000000000000000000000000000000000000009c10",
      receiptId: "381",
    }),
  },
  {
    type: "tool.call.completed",
    delayMs: 300,
    payload: () => ({ stepIdx: 0, outputSummary: "3 tweets drafted" }),
  },
  {
    type: "integration.started",
    delayMs: 200,
    payload: () => ({}),
  },
  {
    type: "task.completed",
    delayMs: 300,
    payload: () => ({
      resultHash:
        "0x1c45000000000000000000000000000000000000000000000000000000ea8aaa",
      deliverable: {
        kind: "tweet-cards",
        items: [
          {
            title: "Launch tweet 01",
            copy: "Your AI workflow should not need five subscriptions. AgentPay Passport lets Buyer Agents discover, pay, and deliver on Monad.",
            time: "Tue 10:20",
            tag: "#Monad #AI",
          },
          {
            title: "Launch tweet 02",
            copy: "Pay per useful agent action. No monthly bundle, no mid-task signature loop, just policy-bounded execution.",
            time: "Tue 14:30",
            tag: "#AgentEconomy",
          },
          {
            title: "Launch tweet 03",
            copy: "A2A lets agents talk. AgentPay Passport lets agents transact, remember, and build reputation.",
            time: "Wed 09:10",
            tag: "#MCP #Payments",
          },
        ],
      },
    }),
  },
];

// Demo step delay scaling. Defaults to ~0.5s/event in real demos, but the test
// suite overrides via `process.env.TASK_EVENT_TICK_MS` so SSE assertions don't
// stall the suite. Read at call time (test resets env per case).
function tickMs(): number {
  const raw = process.env.TASK_EVENT_TICK_MS;
  if (raw && /^\d+$/.test(raw)) return Number(raw);
  return 500;
}

// Convert a decimal-string MON value (e.g. "0.5", "1.234") into a wei
// big-int string (18 decimals). Matches mock-tools.ts so wire shapes line up.
function monStrToWei(value: string): string {
  const [intPart, fracPart = ""] = value.split(".");
  const padded = (fracPart + "0".repeat(18)).slice(0, 18);
  return BigInt(intPart + padded).toString();
}

// Lazily kick off mock-worker for a task. Idempotent: returns immediately if
// events have already been emitted. TODO(track-e): replace with a real BullMQ
// enqueue call.
const inFlight = new Set<string>();
function enqueueMockTask(taskId: string): void {
  if (inFlight.has(taskId)) return;
  inFlight.add(taskId);
  markTaskExecuting(taskId);
  const tick = tickMs();
  let totalDelay = 0;
  for (const step of DEMO_EVENT_SEQUENCE) {
    totalDelay += Math.max(step.delayMs, tick);
    setTimeout(() => {
      const evt = appendTaskEvent(taskId, step.type, step.payload());
      if (!evt) return;
      if (step.type === "task.completed") {
        const payload = step.payload();
        markTaskCompleted(taskId, {
          resultHash: payload.resultHash as string,
          deliverable: payload.deliverable as object,
        });
        const task = getTask(taskId);
        if (task) setAgentCurrentTask(task.agentId, null);
      }
    }, totalDelay);
  }
}

// Helper: SSE frame writer. Always sets the `id:` field so EventSource
// `Last-Event-ID` reconnects correctly.
function writeEvent(reply: FastifyReply, event: TaskEvent): void {
  reply.raw.write(`id: ${event.seq}\n`);
  reply.raw.write(`event: ${event.type}\n`);
  reply.raw.write(
    `data: ${JSON.stringify({
      seq: event.seq,
      taskId: event.taskId,
      type: event.type,
      ...event.payload,
    })}\n\n`,
  );
}

export const tasksRoutes: FastifyPluginAsync = async (app) => {
  // ---------------------------------------------------------------------------
  // POST /api/agents/:id/tasks — submit a task
  // ---------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/api/agents/:id/tasks",
    async (request, reply) => {
      const owner = await requireAuth(request, reply);
      if (!owner) return;
      const agent = getAgent(request.params.id);
      if (!agent) return reply.code(404).send({ error: "agent_not_found" });
      if (agent.ownerAddress.toLowerCase() !== owner.toLowerCase()) {
        return reply.code(403).send({ error: "forbidden" });
      }

      const parsed = createTaskSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body" });
      }

      const task = storeCreateTask({
        agentId: agent.id,
        prompt: parsed.data.prompt,
        parentTaskId: parsed.data.parentTaskId ?? null,
      });

      // When the real Worker is wired up (server.ts decorates `app.worker` +
      // `app.workerDb` if OPERATOR_PK + MARKETPLACE_ADDRESS are set), seed the
      // Worker's DB from the in-memory store and enqueue. Otherwise fall back
      // to the demo mock-worker timer below so dev / no-PK mode still demos.
      if (app.worker && app.workerDb) {
        // The current wiring uses InMemoryWorkerDb whose internal maps are
        // public — cast through `unknown` to a structural shape so we can seed
        // directly without adding seed helpers to the WorkerDb interface (the
        // Postgres-backed impl will replace this seed step entirely).
        const dbAny = app.workerDb as unknown as {
          agents: Map<string, unknown>;
          tools: unknown[];
          tasks: Map<string, unknown>;
        };
        // Seed agent policy from the in-memory agent record. Decimal-string MON
        // values are converted to wei (18 decimals) — same convention as
        // mock-tools.ts. Idempotent: leave existing rows in place.
        if (!(await app.workerDb.getAgentPolicy(agent.id))) {
          dbAny.agents.set(agent.id, {
            id: agent.id,
            ownerAddress: agent.ownerAddress,
            operatorAddress: agent.operatorAddress,
            balanceWei: monStrToWei(agent.balance),
            maxPerCallWei: monStrToWei(agent.maxPerCall),
            dailySpendCapWei: monStrToWei(agent.dailySpendCap),
            dailySpentWei: "0",
          });
        }
        // Seed tools once per process from the mock-tools fixture (Track D will
        // replace this with the chain watcher cache).
        const existingTools = await app.workerDb.listEnabledTools();
        if (existingTools.length === 0) {
          for (const t of MOCK_TOOLS) {
            dbAny.tools.push({
              id: t.id,
              version: t.version,
              pricePerCallWei: t.priceWei,
              endpoint: t.endpoint,
              enabled: t.enabled,
              name: t.name,
              description: t.description,
            });
          }
        }
        // Seed the task row itself.
        dbAny.tasks.set(task.id, {
          id: task.id,
          agentId: agent.id,
          parentTaskId: task.parentTaskId,
          status: "pending",
          prompt: task.prompt,
          promptHash: null,
          salt: null,
          onChainTaskId: null,
          resultText: null,
          resultHash: null,
          planJson: null,
          error: null,
        });
        // Bridge worker SSE events into the lib in-memory log so the existing
        // `/api/tasks/:id/events` endpoint keeps working without changes.
        if (app.sse) {
          app.sse.subscribe(task.id, (evt: TaskEventEnvelope) => {
            const payload =
              evt.payload && typeof evt.payload === "object"
                ? (evt.payload as Record<string, unknown>)
                : {};
            appendTaskEvent(task.id, evt.type, payload);
            if (evt.type === "task.completed") {
              const resultHash =
                typeof payload.resultHash === "string"
                  ? payload.resultHash
                  : "0x0";
              const deliverable =
                payload.deliverable && typeof payload.deliverable === "object"
                  ? (payload.deliverable as object)
                  : {};
              markTaskCompleted(task.id, { resultHash, deliverable });
              const t = getTask(task.id);
              if (t) setAgentCurrentTask(t.agentId, null);
            }
          });
        }
        markTaskExecuting(task.id);
        await app.worker.enqueueTask(task.id);
      } else {
        // Demo fallback: mock-worker timer.
        enqueueMockTask(task.id);
      }

      return { taskId: task.id };
    },
  );

  // ---------------------------------------------------------------------------
  // GET /api/tasks/:id — current snapshot
  // ---------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>("/api/tasks/:id", async (request, reply) => {
    const owner = await requireAuth(request, reply);
    if (!owner) return;
    const task = getTask(request.params.id);
    if (!task) return reply.code(404).send({ error: "task_not_found" });
    const agent = getAgent(task.agentId);
    if (!agent || agent.ownerAddress.toLowerCase() !== owner.toLowerCase()) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const events = getTaskEventsAfter(task.id, 0);
    return {
      id: task.id,
      agentId: task.agentId,
      prompt: task.prompt,
      parentTaskId: task.parentTaskId,
      status: task.status,
      createdAt: task.createdAt,
      completedAt: task.completedAt,
      resultHash: task.resultHash,
      deliverable: task.deliverable,
      events,
    };
  });

  // ---------------------------------------------------------------------------
  // GET /api/tasks/:id/events?after=<seq> — replay missed events
  // ---------------------------------------------------------------------------
  app.get<{ Params: { id: string }; Querystring: { after?: string } }>(
    "/api/tasks/:id/events",
    async (request, reply) => {
      const owner = await requireAuth(request, reply);
      if (!owner) return;
      const task = getTask(request.params.id);
      if (!task) return reply.code(404).send({ error: "task_not_found" });
      const agent = getAgent(task.agentId);
      if (!agent || agent.ownerAddress.toLowerCase() !== owner.toLowerCase()) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const after = Number(request.query.after ?? "0");
      const safe = Number.isFinite(after) && after >= 0 ? after : 0;
      const events = getTaskEventsAfter(task.id, safe);
      return { events };
    },
  );

  // ---------------------------------------------------------------------------
  // GET /api/tasks/:id/stream — SSE event stream
  // ---------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    "/api/tasks/:id/stream",
    async (request, reply) => {
      const owner = await requireAuth(request, reply);
      if (!owner) return;
      const task = getTask(request.params.id);
      if (!task) return reply.code(404).send({ error: "task_not_found" });
      const agent = getAgent(task.agentId);
      if (!agent || agent.ownerAddress.toLowerCase() !== owner.toLowerCase()) {
        return reply.code(403).send({ error: "forbidden" });
      }

      // Bypass Fastify's automatic JSON serialization — we'll write raw SSE
      // frames straight to the underlying response.
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      // Honour Last-Event-ID for resumption per design doc §8.2.
      const lastIdHeader = request.headers["last-event-id"];
      const lastId = Number(
        Array.isArray(lastIdHeader) ? lastIdHeader[0] : lastIdHeader,
      );
      let cursor = Number.isFinite(lastId) && lastId > 0 ? lastId : 0;

      // Flush whatever we already have.
      for (const evt of getTaskEventsAfter(task.id, cursor)) {
        writeEvent(reply, evt);
        cursor = evt.seq;
      }

      // If the task is already done, close the stream — clients reconnect via
      // GET /events?after=<seq> if they want a final replay.
      if (task.status === "completed" || task.status === "failed") {
        reply.raw.end();
        return reply;
      }

      // Poll the in-memory log for new events. This is purely a placeholder
      // pattern for the demo mock-worker — Track E's real Worker should
      // subscribe to a Redis channel and pipe events directly into the
      // response.
      const intervalMs = Math.max(50, Math.floor(tickMs() / 4));
      const interval = setInterval(() => {
        const newEvents = getTaskEventsAfter(task.id, cursor);
        for (const evt of newEvents) {
          writeEvent(reply, evt);
          cursor = evt.seq;
          if (evt.type === "task.completed" || evt.type === "task.failed") {
            clearInterval(interval);
            reply.raw.end();
            return;
          }
        }
      }, intervalMs);

      // Safety timeout: never leave a connection alive longer than ~60s on a
      // mock task; real Worker integration replaces this with a heartbeat.
      const safety = setTimeout(() => {
        clearInterval(interval);
        try {
          reply.raw.end();
        } catch {
          // already closed; ignore
        }
      }, 60_000);

      request.raw.on("close", () => {
        clearInterval(interval);
        clearTimeout(safety);
      });

      return reply;
    },
  );

  // ---------------------------------------------------------------------------
  // POST /api/tasks/:id/prepare-rate — rateTask calldata
  // ---------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/api/tasks/:id/prepare-rate",
    async (request, reply) => {
      const owner = await requireAuth(request, reply);
      if (!owner) return;
      const task = getTask(request.params.id);
      if (!task) return reply.code(404).send({ error: "task_not_found" });
      const agent = getAgent(task.agentId);
      if (!agent || agent.ownerAddress.toLowerCase() !== owner.toLowerCase()) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const parsed = rateTaskSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body" });
      }

      // The on-chain rateTask expects bytes32; our off-chain task id is a UUID
      // (string). Hash to bytes32 so the calldata roundtrip is stable. Track D
      // can swap the off-chain UUID for the chain-issued task id later.
      const taskIdBytes32 = keccak256(toHex(task.id));
      const data = encodeFunctionData({
        abi: MARKETPLACE_ABI,
        functionName: "rateTask",
        args: [taskIdBytes32, parsed.data.stars],
      });
      return {
        calldata: { to: MARKETPLACE_ADDRESS, data, value: "0" },
      };
    },
  );
};
