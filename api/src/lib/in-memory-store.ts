// In-memory store for agents, tasks, task events, and burner operator keys.
//
// Two roles:
//   1. Authoritative state for routes (sync API the routes already depend on).
//   2. When `DATABASE_URL` is set, mirror every write to Postgres (`db/store`)
//      asynchronously so data survives process restarts and other services
//      can inspect/consume it. Reads still come from the in-memory map —
//      flipping the read path to async would require touching every route.
//
// Track D will eventually replace agent reads with chain reads and Track E
// will swap mock task event emission for real Worker output. At that point
// this module can shrink to a thin async facade over `db/store`.

import { randomUUID } from "node:crypto";

// Lazy-loaded DB mirror. We dynamic-import on first use so plain-node test
// runs that never set DATABASE_URL skip the postgres-js initialisation
// entirely. If the import fails, we log once and fall back to pure-memory.
//
// IMPORTANT: the mirror is disabled by default in test mode — existing test
// suites assume sequential, in-memory state ("expectedAgentId = '1'") and
// would race against fire-and-forget DB writes from prior tests if we
// silently mirrored to the live Neon DB. Tests that want the mirror set
// `MIRROR_TO_DB=1` explicitly.
type DbStore = typeof import("../db/store.js");
let dbStorePromise: Promise<DbStore | null> | null = null;
function mirrorEnabled(): boolean {
  if (!process.env.DATABASE_URL) return false;
  if (process.env.NODE_ENV === "test" && process.env.MIRROR_TO_DB !== "1") {
    return false;
  }
  return true;
}
function dbStore(): Promise<DbStore | null> {
  if (!mirrorEnabled()) return Promise.resolve(null);
  dbStorePromise ??= import("../db/store.js").catch((err) => {
    console.warn("[in-memory-store] DB mirror import failed:", err);
    return null;
  });
  return dbStorePromise;
}

// Centralised fire-and-forget for mirror writes. We swallow errors because
// the in-memory store is authoritative for the demo path — a DB blip should
// not break a user-facing flow. Errors get logged at warn level.
function mirror(label: string, work: (s: DbStore) => Promise<unknown>): void {
  void dbStore().then((s) => {
    if (!s) return;
    return work(s).catch((err) => {
      console.warn(`[in-memory-store] DB mirror ${label} failed:`, err);
    });
  });
}

// =============================================================================
// Types — keep aligned with frontend `lib/api.ts` consumers.
// =============================================================================

export interface AgentRecord {
  id: string;
  ownerAddress: `0x${string}`;
  operatorAddress: `0x${string}`;
  name: string;
  goal: string;
  // Stored as decimal-string MON (display) — frontend formats; backend keeps raw.
  totalBudget: string;
  balance: string;
  maxPerCall: string;
  dailySpendCap: string;
  reputation: number;
  tasks: number;
  status: "Ready" | "Needs funding" | "Executing";
  currentTaskId: string | null;
  createdAt: number;
  // Chain glue (filled in by Track D once chain reads land):
  chainAgentId: string | null;
}

export interface TaskRecord {
  id: string;
  agentId: string;
  prompt: string;
  parentTaskId: string | null;
  status: "queued" | "executing" | "completed" | "failed";
  createdAt: number;
  completedAt: number | null;
  // The seq cursor up to which we've emitted events for this task — used to
  // synthesize SSE replay when a client reconnects with Last-Event-ID.
  emittedThrough: number;
  resultHash: string | null;
  deliverable: object | null;
}

export interface TaskEvent {
  seq: number;
  taskId: string;
  timestamp: number;
  type: string;
  payload: Record<string, unknown>;
}

// =============================================================================
// Storage (process-local, reset between test files via `resetStore()`).
// =============================================================================

const agents = new Map<string, AgentRecord>();
const tasks = new Map<string, TaskRecord>();
// taskId -> ordered event log (small array; bounded by demo task length).
const taskEvents = new Map<string, TaskEvent[]>();
// TODO(track-d): replace with KMS-wrapped storage. Keep the burner private key
// encrypted at rest; we hold raw for now because there's no KMS yet.
const burnerKeys = new Map<`0x${string}`, `0x${string}`>();

let agentSeq = 1;

// =============================================================================
// Agent helpers
// =============================================================================

export function createAgent(input: {
  ownerAddress: `0x${string}`;
  operatorAddress: `0x${string}`;
  name: string;
  goal: string;
  totalBudget: string;
  maxPerCall: string;
  dailySpendCap: string;
}): AgentRecord {
  const id = String(agentSeq++);
  const record: AgentRecord = {
    id,
    ownerAddress: input.ownerAddress,
    operatorAddress: input.operatorAddress,
    name: input.name,
    goal: input.goal,
    totalBudget: input.totalBudget,
    balance: input.totalBudget,
    maxPerCall: input.maxPerCall,
    dailySpendCap: input.dailySpendCap,
    reputation: 50,
    tasks: 0,
    status: "Ready",
    currentTaskId: null,
    createdAt: Date.now(),
    chainAgentId: null,
  };
  agents.set(id, record);
  mirror("createAgent", (s) =>
    s.createAgent({
      ownerAddress: input.ownerAddress,
      operatorAddress: input.operatorAddress,
      name: input.name,
      goal: input.goal,
      totalBudget: input.totalBudget,
      maxPerCall: input.maxPerCall,
      dailySpendCap: input.dailySpendCap,
    }),
  );
  return record;
}

export function getAgent(id: string): AgentRecord | null {
  return agents.get(id) ?? null;
}

export function listAgents(ownerAddress: `0x${string}`): AgentRecord[] {
  const lower = ownerAddress.toLowerCase();
  return [...agents.values()]
    .filter((a) => a.ownerAddress.toLowerCase() === lower)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function setAgentCurrentTask(agentId: string, taskId: string | null): void {
  const agent = agents.get(agentId);
  if (!agent) return;
  agent.currentTaskId = taskId;
  if (taskId !== null) agent.status = "Executing";
}

// =============================================================================
// Task helpers
// =============================================================================

export function createTask(input: {
  agentId: string;
  prompt: string;
  parentTaskId: string | null;
}): TaskRecord {
  const id = randomUUID();
  const record: TaskRecord = {
    id,
    agentId: input.agentId,
    prompt: input.prompt,
    parentTaskId: input.parentTaskId,
    status: "queued",
    createdAt: Date.now(),
    completedAt: null,
    emittedThrough: 0,
    resultHash: null,
    deliverable: null,
  };
  tasks.set(id, record);
  taskEvents.set(id, []);
  setAgentCurrentTask(input.agentId, id);
  mirror("createTask", (s) =>
    s.createTask({
      agentId: input.agentId,
      prompt: input.prompt,
      parentTaskId: input.parentTaskId,
    }),
  );
  return record;
}

export function getTask(id: string): TaskRecord | null {
  return tasks.get(id) ?? null;
}

export function appendTaskEvent(
  taskId: string,
  type: string,
  payload: Record<string, unknown> = {},
): TaskEvent | null {
  const log = taskEvents.get(taskId);
  if (!log) return null;
  const event: TaskEvent = {
    seq: log.length + 1,
    taskId,
    timestamp: Date.now(),
    type,
    payload,
  };
  log.push(event);
  mirror("appendTaskEvent", (s) => s.appendTaskEvent(taskId, type, payload));
  return event;
}

export function getTaskEventsAfter(taskId: string, afterSeq: number): TaskEvent[] {
  const log = taskEvents.get(taskId);
  if (!log) return [];
  if (afterSeq <= 0) return [...log];
  return log.filter((e) => e.seq > afterSeq);
}

export function markTaskCompleted(
  taskId: string,
  result: { resultHash: string; deliverable: object },
): void {
  const task = tasks.get(taskId);
  if (!task) return;
  task.status = "completed";
  task.completedAt = Date.now();
  task.resultHash = result.resultHash;
  task.deliverable = result.deliverable;
  const agent = agents.get(task.agentId);
  if (agent) {
    agent.tasks += 1;
    agent.status = "Ready";
  }
  mirror("markTaskCompleted", (s) => s.markTaskCompleted(taskId, result));
}

export function markTaskExecuting(taskId: string): void {
  const task = tasks.get(taskId);
  if (task) task.status = "executing";
  mirror("markTaskExecuting", (s) => s.markTaskExecuting(taskId));
}

// =============================================================================
// Burner key helpers (placeholder for KMS-wrapped operator keys)
// =============================================================================

export function storeBurnerKey(
  operatorAddress: `0x${string}`,
  privateKey: `0x${string}`,
): void {
  burnerKeys.set(operatorAddress, privateKey);
  // Mirror to DB — when wired, the DB row holds an AES-256-GCM-wrapped copy
  // (see `lib/operator-key-crypto.ts`). The in-process cache still holds the
  // plaintext so Worker tx signing stays cheap.
  mirror("storeBurnerKey", (s) => s.storeBurnerKey(operatorAddress, privateKey));
}

export function getBurnerKey(
  operatorAddress: `0x${string}`,
): `0x${string}` | null {
  return burnerKeys.get(operatorAddress) ?? null;
}

// =============================================================================
// Test helpers — exposed so vitest suites can reset between cases.
// =============================================================================

export function resetStore(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("resetStore: refusing to clear in production");
  }
  agents.clear();
  tasks.clear();
  taskEvents.clear();
  burnerKeys.clear();
  agentSeq = 1;
  // Mirror to DB. Tests that need full hermetic isolation should call the
  // DB-backed resetStore directly (see db/store.ts).
  mirror("resetStore", (s) => s.resetStore());
}

// Test-only: pre-seed for cases that want a deterministic agent without going
// through prepare-create. Owner is required so listAgents matches the caller.
export function _seedAgentForTest(record: AgentRecord): AgentRecord {
  agents.set(record.id, record);
  return record;
}
