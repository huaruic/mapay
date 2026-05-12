// Worker-facing database interface.
//
// The Worker doesn't import Drizzle directly so tests can plug an in-memory
// store in.  The real implementation (PostgresWorkerDb) is built on top of
// drizzle-orm and is added by the routes layer / chain layer before
// startWorker() is called; that wiring lives in api/src/server.ts (which we
// don't modify here — orchestrator integrates).

export type TaskStatus =
  | "pending"
  | "planning"
  | "executing"
  | "integrating"
  | "completed"
  | "failed";

export type ToolCallStatus =
  | "planned"
  | "paying"
  | "paid"
  | "invoking"
  | "ok"
  | "failed";

export interface TaskRow {
  id: string;
  agentId: string;
  parentTaskId: string | null;
  status: TaskStatus;
  prompt: string;
  promptHash: `0x${string}` | null;
  salt: `0x${string}` | null;
  onChainTaskId: `0x${string}` | null;
  resultText: string | null;
  resultHash: `0x${string}` | null;
  planJson: unknown;
  error: string | null;
}

export interface ToolCallRow {
  id: string;
  taskId: string;
  stepIdx: number;
  toolId: string;
  toolVersion: number;
  amountWei: string;
  status: ToolCallStatus;
  txHash: `0x${string}` | null;
  receiptId: `0x${string}` | null;
  attempt: number;
  inputJson: unknown;
  inputHash: `0x${string}` | null;
  outputJson: unknown;
  outputHash: `0x${string}` | null;
  httpStatus: number | null;
  error: string | null;
}

export interface AgentPolicyRow {
  id: string;
  ownerAddress: string;
  operatorAddress: string;
  balanceWei: string;
  maxPerCallWei: string;
  dailySpendCapWei: string;
  dailySpentWei: string;
}

export interface ToolRow {
  id: string;
  version: number;
  pricePerCallWei: string;
  endpoint: string;
  enabled: boolean;
  name: string;
  description: string | null;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface WorkerDb {
  getTask(taskId: string): Promise<TaskRow | null>;
  /** Walk parent_task_id up to N levels — most recent ancestor last. */
  getParentChain(taskId: string, maxDepth: number): Promise<TaskRow[]>;
  updateTaskStatus(taskId: string, status: TaskStatus, fields?: Partial<TaskRow>): Promise<void>;
  setTaskOnChainId(taskId: string, onChainId: `0x${string}`, promptHash: `0x${string}`, salt: `0x${string}`): Promise<void>;
  setTaskResult(taskId: string, resultText: string, resultHash: `0x${string}`): Promise<void>;
  setTaskError(taskId: string, error: string): Promise<void>;
  setTaskPlan(taskId: string, plan: unknown): Promise<void>;

  getAgentPolicy(agentId: string): Promise<AgentPolicyRow | null>;
  listEnabledTools(): Promise<ToolRow[]>;

  listToolCalls(taskId: string): Promise<ToolCallRow[]>;
  insertToolCall(row: ToolCallRow): Promise<void>;
  updateToolCall(id: string, fields: Partial<ToolCallRow>): Promise<void>;
}

// ── In-memory implementation ───────────────────────────────────────────────

export class InMemoryWorkerDb implements WorkerDb {
  tasks = new Map<string, TaskRow>();
  toolCallsByTask = new Map<string, ToolCallRow[]>();
  agents = new Map<string, AgentPolicyRow>();
  tools: ToolRow[] = [];

  async getTask(taskId: string): Promise<TaskRow | null> {
    return this.tasks.get(taskId) ?? null;
  }

  async getParentChain(taskId: string, maxDepth: number): Promise<TaskRow[]> {
    const out: TaskRow[] = [];
    let cur = this.tasks.get(taskId);
    let depth = 0;
    while (cur?.parentTaskId && depth < maxDepth) {
      const parent = this.tasks.get(cur.parentTaskId);
      if (!parent) break;
      out.unshift(parent);
      cur = parent;
      depth += 1;
    }
    return out;
  }

  async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    fields?: Partial<TaskRow>,
  ): Promise<void> {
    const cur = this.tasks.get(taskId);
    if (!cur) throw new Error(`task ${taskId} not found`);
    this.tasks.set(taskId, { ...cur, ...fields, status });
  }

  async setTaskOnChainId(
    taskId: string,
    onChainId: `0x${string}`,
    promptHash: `0x${string}`,
    salt: `0x${string}`,
  ): Promise<void> {
    const cur = this.tasks.get(taskId);
    if (!cur) throw new Error(`task ${taskId} not found`);
    this.tasks.set(taskId, { ...cur, onChainTaskId: onChainId, promptHash, salt });
  }

  async setTaskResult(
    taskId: string,
    resultText: string,
    resultHash: `0x${string}`,
  ): Promise<void> {
    const cur = this.tasks.get(taskId);
    if (!cur) throw new Error(`task ${taskId} not found`);
    this.tasks.set(taskId, { ...cur, resultText, resultHash });
  }

  async setTaskError(taskId: string, error: string): Promise<void> {
    const cur = this.tasks.get(taskId);
    if (!cur) throw new Error(`task ${taskId} not found`);
    this.tasks.set(taskId, { ...cur, error });
  }

  async setTaskPlan(taskId: string, plan: unknown): Promise<void> {
    const cur = this.tasks.get(taskId);
    if (!cur) throw new Error(`task ${taskId} not found`);
    this.tasks.set(taskId, { ...cur, planJson: plan });
  }

  async getAgentPolicy(agentId: string): Promise<AgentPolicyRow | null> {
    return this.agents.get(agentId) ?? null;
  }

  async listEnabledTools(): Promise<ToolRow[]> {
    return this.tools.filter((t) => t.enabled);
  }

  async listToolCalls(taskId: string): Promise<ToolCallRow[]> {
    return [...(this.toolCallsByTask.get(taskId) ?? [])].sort(
      (a, b) => a.stepIdx - b.stepIdx,
    );
  }

  async insertToolCall(row: ToolCallRow): Promise<void> {
    const arr = this.toolCallsByTask.get(row.taskId) ?? [];
    arr.push({ ...row });
    this.toolCallsByTask.set(row.taskId, arr);
  }

  async updateToolCall(id: string, fields: Partial<ToolCallRow>): Promise<void> {
    for (const arr of this.toolCallsByTask.values()) {
      const idx = arr.findIndex((r) => r.id === id);
      if (idx >= 0) {
        const cur = arr[idx];
        if (!cur) return;
        arr[idx] = { ...cur, ...fields };
        return;
      }
    }
    throw new Error(`tool_call ${id} not found`);
  }
}
