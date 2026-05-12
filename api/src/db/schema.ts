// Drizzle schema mirroring design doc §6.3.
// Schema only — migrations & runtime client are deferred until DB is provisioned.
//
// IMPORTANT: Many on-chain numeric values (wei amounts, agent ids, tool ids) can
// exceed JS Number safe range. We store them as `numeric` (Drizzle returns a
// string) for application-layer BigInt handling.

import {
  bigint,
  bigserial,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// Postgres bytea isn't first-class in this drizzle version; define it ourselves.
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

// ---------- enums ----------
export const taskStatus = pgEnum("task_status", [
  "pending",
  "planning",
  "executing",
  "integrating",
  "completed",
  "failed",
]);

export const toolCallStatus = pgEnum("tool_call_status", [
  "planned",
  "paying",
  "paid",
  "invoking",
  "ok",
  "failed",
]);

// ---------- users ----------
export const users = pgTable("users", {
  address: varchar("address", { length: 42 }).primaryKey(), // 0x + 40 hex
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- agents ----------
// PK = on-chain agentId (uint256, stored as numeric string)
export const agents = pgTable("agents", {
  id: numeric("id").primaryKey(),
  ownerAddress: varchar("owner_address", { length: 42 }).notNull(),
  operatorAddress: varchar("operator_address", { length: 42 }).notNull(),
  name: text("name").notNull(),
  goal: text("goal"),
  balanceWei: numeric("balance_wei").notNull().default("0"),
  maxPerCallWei: numeric("max_per_call_wei").notNull(),
  dailySpendCapWei: numeric("daily_spend_cap_wei").notNull(),
  dailySpentWei: numeric("daily_spent_wei").notNull().default("0"),
  dailyResetAt: bigint("daily_reset_at", { mode: "bigint" }),
  totalBudgetWei: numeric("total_budget_wei").notNull().default("0"),
  totalSpentWei: numeric("total_spent_wei").notNull().default("0"),
  currentReputation: integer("current_reputation").notNull().default(0),
  active: boolean("active").notNull().default(true),
  passportTokenId: numeric("passport_token_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ownerIdx: index("agents_owner_idx").on(t.ownerAddress),
}));

// ---------- tools ----------
export const tools = pgTable("tools", {
  id: numeric("id").primaryKey(),
  providerAddress: varchar("provider_address", { length: 42 }).notNull(),
  payoutAddress: varchar("payout_address", { length: 42 }).notNull(),
  version: integer("version").notNull(),
  pricePerCallWei: numeric("price_per_call_wei").notNull(),
  schemaHash: varchar("schema_hash", { length: 66 }).notNull(), // 0x + 64 hex
  schemaJson: jsonb("schema_json"),
  endpoint: text("endpoint").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  enabled: boolean("enabled").notNull().default(true),
  totalCalls: integer("total_calls").notNull().default(0),
  totalRevenueWei: numeric("total_revenue_wei").notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  providerIdx: index("tools_provider_idx").on(t.providerAddress),
  enabledIdx: index("tools_enabled_idx").on(t.enabled),
}));

// ---------- tasks ----------
// PK is local uuid; on-chain taskId (bytes32) is filled after startTask() lands.
export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: numeric("agent_id").notNull(),
  onChainTaskId: varchar("on_chain_task_id", { length: 66 }), // bytes32 hex
  parentTaskId: uuid("parent_task_id"),
  status: taskStatus("status").notNull().default("pending"),
  prompt: text("prompt").notNull(),
  promptHash: varchar("prompt_hash", { length: 66 }),
  salt: varchar("salt", { length: 66 }),
  resultText: text("result_text"),
  resultHash: varchar("result_hash", { length: 66 }),
  planJson: jsonb("plan_json"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  agentIdx: index("tasks_agent_idx").on(t.agentId),
  parentIdx: index("tasks_parent_idx").on(t.parentTaskId),
  onChainIdx: index("tasks_on_chain_idx").on(t.onChainTaskId),
}));

// ---------- tool_calls ----------
export const toolCalls = pgTable("tool_calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull(),
  stepIdx: integer("step_idx").notNull(),
  toolId: numeric("tool_id").notNull(),
  toolVersion: integer("tool_version").notNull(),
  amountWei: numeric("amount_wei").notNull(),
  status: toolCallStatus("status").notNull().default("planned"),
  txHash: varchar("tx_hash", { length: 66 }),
  receiptId: varchar("receipt_id", { length: 66 }),
  attempt: integer("attempt").notNull().default(0),
  inputJson: jsonb("input_json"),
  inputHash: varchar("input_hash", { length: 66 }),
  outputJson: jsonb("output_json"),
  outputHash: varchar("output_hash", { length: 66 }),
  httpStatus: integer("http_status"),
  providerLatencyMs: integer("provider_latency_ms"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  taskIdx: index("tool_calls_task_idx").on(t.taskId),
  taskStepUnique: unique("tool_calls_task_step_uq").on(t.taskId, t.stepIdx),
}));

// ---------- task_events (SSE log) ----------
export const taskEvents = pgTable("task_events", {
  id: bigserial("id", { mode: "bigint" }).primaryKey(),
  taskId: uuid("task_id").notNull(),
  seq: integer("seq").notNull(),
  type: text("type").notNull(),
  payloadJson: jsonb("payload_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  taskSeqUnique: unique("task_events_task_seq_uq").on(t.taskId, t.seq),
}));

// ---------- ratings ----------
export const ratings = pgTable("ratings", {
  agentId: numeric("agent_id").notNull(),
  taskId: uuid("task_id").notNull(),
  stars: smallint("stars").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.agentId, t.taskId] }),
}));

// ---------- chain_cursor ----------
export const chainCursor = pgTable("chain_cursor", {
  contractAddress: varchar("contract_address", { length: 42 }).primaryKey(),
  lastProcessedBlock: bigint("last_processed_block", { mode: "bigint" }).notNull(),
  headBlock: bigint("head_block", { mode: "bigint" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- operator_keys ----------
// Per-agent burner private key, AES-GCM encrypted at rest with KMS master key.
// See design doc §10.5.
export const operatorKeys = pgTable("operator_keys", {
  agentId: numeric("agent_id").primaryKey(),
  encryptedPrivkey: bytea("encrypted_privkey").notNull(),
  keyVersion: integer("key_version").notNull().default(1),
  kdfParams: jsonb("kdf_params"),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schema = {
  users,
  agents,
  tools,
  tasks,
  toolCalls,
  taskEvents,
  ratings,
  chainCursor,
  operatorKeys,
};
