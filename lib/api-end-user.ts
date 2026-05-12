/**
 * lib/api-end-user.ts — typed client for the End User flow endpoints.
 * Separate from lib/api.ts so Track D (which owns lib/api.ts) and the End User
 * track (this file) don't fight over the same module.
 *
 * All requests use `credentials: "include"` so the SIWE cookie set by
 * /api/auth/verify flows automatically. Throws ApiError on non-2xx so callers
 * can `try { } catch (err) { if (err instanceof ApiError) ... }`.
 */

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

type RequestInitNoBody = Omit<RequestInit, "body">;

async function request<T>(
  path: string,
  init: RequestInitNoBody & { body?: unknown } = {},
): Promise<T> {
  const { body, headers, ...rest } = init;
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    credentials: "include",
    headers: {
      ...(headers ?? {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let parsed: unknown = null;
  const text = await res.text();
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) throw new ApiError(res.status, parsed);
  return parsed as T;
}

// ── Types ───────────────────────────────────────────────────────────────────

export type AgentDetail = {
  id: string;
  name: string;
  goal: string;
  owner: `0x${string}`;
  operator: `0x${string}`;
  totalBudget: string;
  balance: string;
  maxPerCall: string;
  dailySpendCap: string;
  reputation: number;
  tasks: number;
  status: "Ready" | "Needs funding" | "Executing";
  currentTaskId: string | null;
  chainAgentId: string | null;
};

export type AgentListResponse = { agents: AgentDetail[] };

export type AgentStatsResponse = {
  agents: number;
  totalBalance: string;
  completedTasks: number;
  highestReputation: number;
};

export type PrepareCreateBody = {
  name: string;
  goal: string;
  totalBudget: string;
  maxPerCall: string;
  dailySpendCap: string;
};

export type CalldataResponse = {
  calldata: { to: `0x${string}`; data: `0x${string}`; value: string };
  operatorAddress?: `0x${string}`;
  expectedAgentId?: string;
};

export type TaskSnapshot = {
  id: string;
  agentId: string;
  prompt: string;
  parentTaskId: string | null;
  status: "queued" | "executing" | "completed" | "failed";
  createdAt: number;
  completedAt: number | null;
  resultHash: string | null;
  deliverable: unknown;
  events: Array<{
    seq: number;
    taskId: string;
    timestamp: number;
    type: string;
    payload?: Record<string, unknown>;
  }>;
};

// ── Agent endpoints ─────────────────────────────────────────────────────────

export const listAgents = () => request<AgentListResponse>("/api/agents");

export const agentStats = () =>
  request<AgentStatsResponse>("/api/agents/aggregate-stats");

export const getAgent = (id: string) =>
  request<AgentDetail>(`/api/agents/${encodeURIComponent(id)}`);

export const prepareCreateAgent = (body: PrepareCreateBody) =>
  request<CalldataResponse>("/api/agents/prepare-create", {
    method: "POST",
    body,
  });

export const prepareFundAgent = (id: string, amount: string) =>
  request<CalldataResponse>(`/api/agents/${encodeURIComponent(id)}/prepare-fund`, {
    method: "POST",
    body: { amount },
  });

export const prepareWithdrawAgent = (id: string, amount: string) =>
  request<CalldataResponse>(
    `/api/agents/${encodeURIComponent(id)}/prepare-withdraw`,
    { method: "POST", body: { amount } },
  );

// ── Task endpoints ──────────────────────────────────────────────────────────

export const submitTask = (
  agentId: string,
  body: { prompt: string; parentTaskId?: string },
) =>
  request<{ taskId: string }>(
    `/api/agents/${encodeURIComponent(agentId)}/tasks`,
    { method: "POST", body },
  );

export const getTask = (id: string) =>
  request<TaskSnapshot>(`/api/tasks/${encodeURIComponent(id)}`);

export const prepareRateTask = (id: string, stars: number) =>
  request<CalldataResponse>(
    `/api/tasks/${encodeURIComponent(id)}/prepare-rate`,
    { method: "POST", body: { stars } },
  );
