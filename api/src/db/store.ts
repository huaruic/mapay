// DB-backed store — drop-in replacement for `lib/in-memory-store.ts`.
//
// Public API mirrors the in-memory module so callers (`routes/agents.ts`,
// `routes/tasks.ts`, tests) don't change. The selector in
// `lib/in-memory-store.ts` re-exports from here whenever `DATABASE_URL` is set.
//
// Why a separate file (not "rewrite in-memory-store"): keeping the no-DB code
// path around makes the offline dev experience trivial — `npm test` doesn't
// need Postgres unless we point at it explicitly.

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { getDb } from "./client.js";
import * as schema from "./schema.js";
import {
  currentKdfParams,
  packWrapped,
  unpackWrapped,
  unwrapKey,
  wrapKey,
} from "../lib/operator-key-crypto.js";

// =============================================================================
// Public types — kept verbatim from in-memory-store.ts so the import surface
// stays interchangeable. If you change a field here, change it there too.
// =============================================================================

export interface AgentRecord {
  id: string;
  ownerAddress: `0x${string}`;
  operatorAddress: `0x${string}`;
  name: string;
  goal: string;
  totalBudget: string;
  balance: string;
  maxPerCall: string;
  dailySpendCap: string;
  reputation: number;
  tasks: number;
  status: "Ready" | "Needs funding" | "Executing";
  currentTaskId: string | null;
  createdAt: number;
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
// Helpers
// =============================================================================

function db() {
  const d = getDb();
  if (!d) {
    throw new Error(
      "db/store: DATABASE_URL not set — DB-backed store unavailable. " +
        "Either set DATABASE_URL or use lib/in-memory-store directly.",
    );
  }
  return d;
}

// Wei <-> decimal MON conversion. Schema stores wei as `numeric` (i.e. text);
// the in-memory store traded decimal-MON strings. We convert at the boundary.
function monToWei(mon: string): string {
  // Pre-MVP — parseEther is heavyweight to import here just for this. Manual:
  // split decimal, pad fractional to 18, concat, strip leading zeros.
  const [whole, frac = ""] = mon.split(".");
  const fracPadded = (frac + "0".repeat(18)).slice(0, 18);
  const combined = (whole + fracPadded).replace(/^0+/, "");
  return combined === "" ? "0" : combined;
}

function weiToMon(wei: string): string {
  if (wei === "0" || wei === "") return "0";
  const padded = wei.padStart(19, "0"); // ensure ≥ 19 chars so split works
  const whole = padded.slice(0, -18).replace(/^0+/, "") || "0";
  const frac = padded.slice(-18).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

// Status mapping (DB enum is richer than in-memory union). For the demo flow
// we collapse to the four states the frontend understands.
function dbStatusToApi(s: string): TaskRecord["status"] {
  switch (s) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "executing":
    case "planning":
    case "integrating":
      return "executing";
    default:
      return "queued";
  }
}

function apiStatusToDb(s: TaskRecord["status"]): typeof schema.taskStatus.enumValues[number] {
  switch (s) {
    case "queued":
      return "pending";
    case "executing":
      return "executing";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
  }
}

function rowToAgent(row: typeof schema.agents.$inferSelect, currentTaskId: string | null, completedTasks: number): AgentRecord {
  const status: AgentRecord["status"] = currentTaskId
    ? "Executing"
    : row.balanceWei === "0"
      ? "Needs funding"
      : "Ready";
  return {
    id: row.id,
    ownerAddress: row.ownerAddress as `0x${string}`,
    operatorAddress: row.operatorAddress as `0x${string}`,
    name: row.name,
    goal: row.goal ?? "",
    totalBudget: weiToMon(row.totalBudgetWei),
    balance: weiToMon(row.balanceWei),
    maxPerCall: weiToMon(row.maxPerCallWei),
    dailySpendCap: weiToMon(row.dailySpendCapWei),
    reputation: row.currentReputation,
    tasks: completedTasks,
    status,
    currentTaskId,
    createdAt: row.createdAt.getTime(),
    chainAgentId: row.passportTokenId ?? null,
  };
}

// In-memory caches that complement DB state. The `agents` table doesn't store
// "currently-running task pointer" because that's transient demo state — we
// keep it process-local to avoid an extra write on every event.
const currentTaskByAgent = new Map<string, string | null>();

// Monotonic numeric agent id allocator. Schema uses `numeric` (string) for
// agentId so we can hold uint256, but for the demo we just count up.
async function nextAgentId(): Promise<string> {
  const rows = await db()
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .orderBy(desc(schema.agents.id))
    .limit(1);
  if (rows.length === 0) return "1";
  return (BigInt(rows[0]!.id) + 1n).toString();
}

// =============================================================================
// Agent CRUD
// =============================================================================

export async function createAgent(input: {
  ownerAddress: `0x${string}`;
  operatorAddress: `0x${string}`;
  name: string;
  goal: string;
  totalBudget: string;
  maxPerCall: string;
  dailySpendCap: string;
}): Promise<AgentRecord> {
  const id = await nextAgentId();
  const totalBudgetWei = monToWei(input.totalBudget);
  const inserted = await db()
    .insert(schema.agents)
    .values({
      id,
      ownerAddress: input.ownerAddress,
      operatorAddress: input.operatorAddress,
      name: input.name,
      goal: input.goal,
      balanceWei: totalBudgetWei,
      totalBudgetWei,
      maxPerCallWei: monToWei(input.maxPerCall),
      dailySpendCapWei: monToWei(input.dailySpendCap),
      currentReputation: 50,
      active: true,
    })
    .returning();
  currentTaskByAgent.set(id, null);
  return rowToAgent(inserted[0]!, null, 0);
}

export async function getAgent(id: string): Promise<AgentRecord | null> {
  const rows = await db()
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.id, id))
    .limit(1);
  if (rows.length === 0) return null;
  const completed = await countCompletedTasks(id);
  return rowToAgent(rows[0]!, currentTaskByAgent.get(id) ?? null, completed);
}

export async function listAgents(ownerAddress: `0x${string}`): Promise<AgentRecord[]> {
  // Case-insensitive owner match (mirrors in-memory behaviour).
  const rows = await db()
    .select()
    .from(schema.agents)
    .where(
      sql`lower(${schema.agents.ownerAddress}) = lower(${ownerAddress})`,
    )
    .orderBy(desc(schema.agents.createdAt));
  const out: AgentRecord[] = [];
  for (const row of rows) {
    const completed = await countCompletedTasks(row.id);
    out.push(rowToAgent(row, currentTaskByAgent.get(row.id) ?? null, completed));
  }
  return out;
}

async function countCompletedTasks(agentId: string): Promise<number> {
  const rows = await db()
    .select({ c: sql<number>`count(*)::int` })
    .from(schema.tasks)
    .where(
      and(eq(schema.tasks.agentId, agentId), eq(schema.tasks.status, "completed")),
    );
  return rows[0]?.c ?? 0;
}

export async function setAgentCurrentTask(
  agentId: string,
  taskId: string | null,
): Promise<void> {
  currentTaskByAgent.set(agentId, taskId);
}

// =============================================================================
// Task CRUD
// =============================================================================

export async function createTask(input: {
  agentId: string;
  prompt: string;
  parentTaskId: string | null;
}): Promise<TaskRecord> {
  const id = randomUUID();
  const inserted = await db()
    .insert(schema.tasks)
    .values({
      id,
      agentId: input.agentId,
      parentTaskId: input.parentTaskId,
      status: "pending",
      prompt: input.prompt,
    })
    .returning();
  await setAgentCurrentTask(input.agentId, id);
  return rowToTask(inserted[0]!);
}

export async function getTask(id: string): Promise<TaskRecord | null> {
  const rows = await db()
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.id, id))
    .limit(1);
  if (rows.length === 0) return null;
  return rowToTask(rows[0]!);
}

function rowToTask(row: typeof schema.tasks.$inferSelect): TaskRecord {
  return {
    id: row.id,
    agentId: row.agentId,
    prompt: row.prompt,
    parentTaskId: row.parentTaskId ?? null,
    status: dbStatusToApi(row.status),
    createdAt: row.createdAt.getTime(),
    completedAt: row.completedAt ? row.completedAt.getTime() : null,
    emittedThrough: 0, // SSE cursor lives in task_events.seq; not duplicated
    resultHash: row.resultHash ?? null,
    deliverable: (row.planJson as object | null) ?? null,
  };
}

export async function markTaskExecuting(taskId: string): Promise<void> {
  await db()
    .update(schema.tasks)
    .set({ status: "executing", startedAt: new Date() })
    .where(eq(schema.tasks.id, taskId));
}

export async function markTaskCompleted(
  taskId: string,
  result: { resultHash: string; deliverable: object },
): Promise<void> {
  await db()
    .update(schema.tasks)
    .set({
      status: "completed",
      completedAt: new Date(),
      resultHash: result.resultHash,
      // We piggy-back the deliverable in `plan_json` for demo purposes — real
      // implementation will have a dedicated `result_json` column on tasks
      // or write structured rows into `tool_calls`.
      planJson: result.deliverable,
    })
    .where(eq(schema.tasks.id, taskId));
}

// =============================================================================
// Task events (SSE log)
// =============================================================================

export async function appendTaskEvent(
  taskId: string,
  type: string,
  payload: Record<string, unknown> = {},
): Promise<TaskEvent | null> {
  // Ensure task exists; mirrors in-memory return-null-if-not-found semantics.
  const taskRows = await db()
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId))
    .limit(1);
  if (taskRows.length === 0) return null;

  // seq = current max + 1 for this task. We rely on the `(task_id, seq)`
  // unique constraint to surface concurrency issues; for the demo there's
  // exactly one writer per task so this is safe.
  const maxRows = await db()
    .select({ m: sql<number>`coalesce(max(${schema.taskEvents.seq}), 0)` })
    .from(schema.taskEvents)
    .where(eq(schema.taskEvents.taskId, taskId));
  const seq = (maxRows[0]?.m ?? 0) + 1;

  const inserted = await db()
    .insert(schema.taskEvents)
    .values({
      taskId,
      seq,
      type,
      payloadJson: payload,
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error("appendTaskEvent: insert returned no row");
  return {
    seq: row.seq,
    taskId: row.taskId,
    timestamp: row.createdAt.getTime(),
    type: row.type,
    payload: (row.payloadJson as Record<string, unknown> | null) ?? {},
  };
}

export async function getTaskEventsAfter(
  taskId: string,
  afterSeq: number,
): Promise<TaskEvent[]> {
  const rows = await db()
    .select()
    .from(schema.taskEvents)
    .where(
      afterSeq <= 0
        ? eq(schema.taskEvents.taskId, taskId)
        : and(
            eq(schema.taskEvents.taskId, taskId),
            gt(schema.taskEvents.seq, afterSeq),
          ),
    )
    .orderBy(asc(schema.taskEvents.seq));
  return rows.map((row) => ({
    seq: row.seq,
    taskId: row.taskId,
    timestamp: row.createdAt.getTime(),
    type: row.type,
    payload: (row.payloadJson as Record<string, unknown> | null) ?? {},
  }));
}

// =============================================================================
// Operator burner keys — encrypted at rest (see lib/operator-key-crypto.ts).
//
// Wire contract: the in-memory store takes (operatorAddress, privateKey) but
// keys are conceptually per-agent (see spec §10.5). We persist per-agent and
// keep an in-process lookup from operatorAddress→agentId so the in-memory
// signature stays unchanged.
// =============================================================================

const operatorToAgent = new Map<`0x${string}`, string>();

export async function storeBurnerKey(
  operatorAddress: `0x${string}`,
  privateKey: `0x${string}`,
): Promise<void> {
  // We don't have an agent id at insert time when the route still uses the
  // in-memory contract — but we can reverse-lookup from operatorAddress on the
  // agents table (the agent was just inserted by createAgent above with this
  // operatorAddress).
  const agentRows = await db()
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(
      sql`lower(${schema.agents.operatorAddress}) = lower(${operatorAddress})`,
    )
    .limit(1);
  if (agentRows.length === 0) {
    // The route stores the key BEFORE inserting the agent in some flows. To
    // keep the existing call order working, we stash unmatched keys in-memory
    // and flush on the next agent insert. For now we just throw — the route
    // order is currently agents-first.
    throw new Error(
      `storeBurnerKey: no agent found for operator ${operatorAddress}; ` +
        "insert the agent first or call storeBurnerKeyForAgent() instead",
    );
  }
  const agentId = agentRows[0]!.id;
  operatorToAgent.set(operatorAddress.toLowerCase() as `0x${string}`, agentId);

  // privateKey is 0x + 64 hex; convert to a 32-byte Buffer before wrapping.
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("storeBurnerKey: privateKey must be 0x + 64 hex chars");
  }
  const plaintext = Buffer.from(privateKey.slice(2), "hex");
  const wrapped = wrapKey(plaintext);
  const blob = packWrapped(wrapped);

  await db()
    .insert(schema.operatorKeys)
    .values({
      agentId,
      encryptedPrivkey: blob,
      keyVersion: wrapped.keyVersion,
      kdfParams: currentKdfParams(),
    })
    .onConflictDoUpdate({
      target: schema.operatorKeys.agentId,
      set: {
        encryptedPrivkey: blob,
        keyVersion: wrapped.keyVersion,
        kdfParams: currentKdfParams(),
        rotatedAt: new Date(),
      },
    });
}

export async function getBurnerKey(
  operatorAddress: `0x${string}`,
): Promise<`0x${string}` | null> {
  const agentRows = await db()
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(
      sql`lower(${schema.agents.operatorAddress}) = lower(${operatorAddress})`,
    )
    .limit(1);
  if (agentRows.length === 0) return null;
  const agentId = agentRows[0]!.id;

  const keyRows = await db()
    .select()
    .from(schema.operatorKeys)
    .where(eq(schema.operatorKeys.agentId, agentId))
    .limit(1);
  if (keyRows.length === 0) return null;

  const row = keyRows[0]!;
  // Drizzle's bytea customType returns a Buffer; postgres-js may surface it
  // as Uint8Array depending on version — coerce.
  const blob = Buffer.isBuffer(row.encryptedPrivkey)
    ? row.encryptedPrivkey
    : Buffer.from(row.encryptedPrivkey as unknown as Uint8Array);
  const wrapped = unpackWrapped(blob, row.keyVersion);
  const plaintext = unwrapKey(wrapped);
  return ("0x" + plaintext.toString("hex")) as `0x${string}`;
}

// =============================================================================
// Test helper — refuses to run in production.
// =============================================================================

export async function resetStore(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("resetStore: refusing to truncate in production");
  }
  currentTaskByAgent.clear();
  operatorToAgent.clear();
  // Order matters: child tables before parents to keep FKs happy if we ever
  // add them. Today the schema has no declared FK constraints (kept loose for
  // mock data), so order is cosmetic.
  await db().execute(sql`TRUNCATE TABLE
    ${schema.operatorKeys},
    ${schema.taskEvents},
    ${schema.toolCalls},
    ${schema.ratings},
    ${schema.tasks},
    ${schema.agents}
    RESTART IDENTITY CASCADE`);
}

// Test-only seed helper — mirrors the in-memory `_seedAgentForTest` so test
// suites can pre-seed without going through prepare-create.
export async function _seedAgentForTest(record: AgentRecord): Promise<AgentRecord> {
  await db()
    .insert(schema.agents)
    .values({
      id: record.id,
      ownerAddress: record.ownerAddress,
      operatorAddress: record.operatorAddress,
      name: record.name,
      goal: record.goal,
      balanceWei: monToWei(record.balance),
      totalBudgetWei: monToWei(record.totalBudget),
      maxPerCallWei: monToWei(record.maxPerCall),
      dailySpendCapWei: monToWei(record.dailySpendCap),
      currentReputation: record.reputation,
      active: true,
    })
    .onConflictDoNothing();
  return record;
}
