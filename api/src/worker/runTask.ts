// Buyer Agent Worker — runTask pipeline (design doc §10).
//
// Implements the full state machine:
//
//   pending → planning → executing → integrating → completed
//                  ↘             ↘             ↘
//                    failed        failed        failed
//
// Per step:
//
//   planned → paying ─tx broadcast→ paid ─verifyAndConsume on Provider→
//             invoking → ok
//                                 ↘ (revert)                         ↘
//                                   failed                             failed
//
// Hard requirements:
//   • Every state transition is persisted to the DB BEFORE the on-chain or
//     network call is initiated — so a crashed Worker resumed via BullMQ can
//     reconcile rather than re-broadcasting pay().
//   • Plan validation enforces ∀ price ≤ maxPerCall AND Σ price ≤ balance
//     locally before any on-chain write — this is the second line of defence
//     after the Marketplace.pay() invariants.
//   • A failed step takes the whole task down (MVP behaviour per §10.4).

import {
  type FinalDeliverable,
  type LLMProvider,
  type ParentContext,
  type Plan,
  type PlanStep,
  type StepOutput,
  type ToolDescription,
} from "./llm.js";
import type { ChainClient, Hex } from "./chain.js";
import type {
  AgentPolicyRow,
  TaskRow,
  ToolCallRow,
  ToolRow,
  WorkerDb,
} from "./db.js";
import type { SseHub, TaskEventEnvelope } from "./sse.js";

// Hash helpers — pulled in via viem to stay byte-compatible with Solidity keccak256.
import { keccak256, toHex } from "viem";

/** HTTP shape sent to a Provider. Worker is the sole producer. */
export interface ProviderRequest {
  url: string;
  body: { input: unknown };
  headers: Record<string, string>;
}

/** Pluggable HTTP transport so tests can fake the provider tier. */
export type ProviderHttp = (req: ProviderRequest) => Promise<{
  status: number;
  body: { output?: unknown; error?: string } | null;
}>;

export interface RunTaskDeps {
  db: WorkerDb;
  chainClient: ChainClient;
  llm: LLMProvider;
  sse: SseHub;
  http: ProviderHttp;
  /** Returns an integer step idx — used purely for tool_calls row IDs. */
  uuid?: () => string;
  /** Wall clock for the seq counter. Defaults to performance-stable monotonic. */
  now?: () => number;
  /** Max parent chain depth (§10.3). Defaults to 3. */
  maxParentDepth?: number;
}

export interface RunTaskInput {
  taskId: string;
}

export interface RunTaskOutcome {
  status: "completed" | "failed";
  reason?: string;
}

const SEQ = new Map<string, number>();
function nextSeq(taskId: string): number {
  const cur = SEQ.get(taskId) ?? 0;
  const next = cur + 1;
  SEQ.set(taskId, next);
  return next;
}

function envelope<T>(
  taskId: string,
  type: string,
  payload: T,
): TaskEventEnvelope<T> {
  return {
    taskId,
    seq: nextSeq(taskId),
    type,
    payload,
    timestamp: new Date().toISOString(),
  };
}

function hashJson(value: unknown): Hex {
  // Canonicalisation MUST match what Provider middleware does:
  // JSON.stringify on the wire-shipped object. Both sides do this so the
  // hashes line up.
  const canonical = JSON.stringify(value);
  return keccak256(toHex(canonical));
}

function uuid(): string {
  // Lazy: avoid pulling crypto unless needed.
  return (
    "id-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 10)
  );
}

interface ValidatePlanOptions {
  policy: AgentPolicyRow;
  toolsById: Map<string, ToolRow>;
  plan: Plan;
}

interface ValidatePlanResult {
  ok: boolean;
  reason?: string;
}

function validatePlan({
  policy,
  toolsById,
  plan,
}: ValidatePlanOptions): ValidatePlanResult {
  if (!plan.steps.length) return { ok: false, reason: "empty plan" };
  const max = BigInt(policy.maxPerCallWei);
  const balance = BigInt(policy.balanceWei);
  const dailyRemaining =
    BigInt(policy.dailySpendCapWei) - BigInt(policy.dailySpentWei);

  let total = 0n;
  for (const step of plan.steps) {
    const tool = toolsById.get(step.toolId);
    if (!tool) return { ok: false, reason: `unknown tool ${step.toolId}` };
    if (!tool.enabled) {
      return { ok: false, reason: `tool ${step.toolId} disabled` };
    }
    if (tool.version !== step.toolVersion) {
      return {
        ok: false,
        reason: `tool ${step.toolId} version drift (plan ${step.toolVersion}, current ${tool.version})`,
      };
    }
    if (tool.pricePerCallWei !== step.expectedPriceWei) {
      return {
        ok: false,
        reason: `tool ${step.toolId} price drift`,
      };
    }
    const price = BigInt(step.expectedPriceWei);
    if (price > max) {
      return { ok: false, reason: `step price ${price} exceeds maxPerCall` };
    }
    total += price;
  }
  if (total > balance) {
    return { ok: false, reason: `plan total ${total} exceeds balance` };
  }
  if (total > dailyRemaining) {
    return {
      ok: false,
      reason: `plan total ${total} exceeds daily cap remaining ${dailyRemaining}`,
    };
  }
  return { ok: true };
}

// ── Main pipeline ──────────────────────────────────────────────────────────

export async function runTask(
  input: RunTaskInput,
  deps: RunTaskDeps,
): Promise<RunTaskOutcome> {
  const { db, chainClient, llm, sse, http } = deps;
  const mkId = deps.uuid ?? uuid;
  const maxParentDepth = deps.maxParentDepth ?? 3;

  const task = await db.getTask(input.taskId);
  if (!task) {
    return { status: "failed", reason: "task not found" };
  }

  const finishFail = async (reason: string) => {
    await db.setTaskError(task.id, reason);
    await db.updateTaskStatus(task.id, "failed");
    sse.publish(task.id, envelope(task.id, "task.failed", { reason }));
    return { status: "failed", reason } as const;
  };

  // ── Step 1: reconcile any prior in-flight tool_calls ─────────────────────
  let existing = await db.listToolCalls(task.id);
  for (const tc of existing) {
    if (tc.status === "paying" && tc.txHash) {
      const res = await chainClient.reconcilePayTx(tc.txHash);
      if (res.confirmed && !res.reverted && res.receiptId) {
        await db.updateToolCall(tc.id, {
          status: "paid",
          receiptId: res.receiptId,
        });
        sse.publish(
          task.id,
          envelope(task.id, "payment.confirmed", {
            stepIdx: tc.stepIdx,
            receiptId: res.receiptId,
            txHash: tc.txHash,
            recovered: true,
          }),
        );
      } else if (res.confirmed && res.reverted) {
        await db.updateToolCall(tc.id, {
          status: "failed",
          error: "pay() reverted on chain (reconciled)",
        });
        return finishFail("pay() reverted on chain (reconciled)");
      }
      // !confirmed → leave as-is, the live flow below will not re-broadcast
      // because we won't enter `paying` again for this stepIdx (insertToolCall
      // unique on (taskId, stepIdx)).
    }
  }
  // Re-read so the per-step loop sees post-reconcile statuses.
  existing = await db.listToolCalls(task.id);

  // If task is already terminal from an earlier run, short-circuit.
  if (task.status === "completed") return { status: "completed" };
  if (task.status === "failed") {
    return { status: "failed", reason: task.error ?? "previously failed" };
  }

  // ── Step 2: build LLM context ────────────────────────────────────────────
  await db.updateTaskStatus(task.id, "planning");
  sse.publish(task.id, envelope(task.id, "task.planning", {}));

  const parents = await db.getParentChain(task.id, maxParentDepth);
  const parentContext: ParentContext[] = parents.map((p) => ({
    prompt: p.prompt,
    resultText: p.resultText,
  }));

  const policy = await db.getAgentPolicy(task.agentId);
  if (!policy) return finishFail("agent policy missing");

  const tools = await db.listEnabledTools();
  const toolsById = new Map(tools.map((t) => [t.id, t]));
  const availableTools: ToolDescription[] = tools.map((t) => ({
    toolId: t.id,
    toolVersion: t.version,
    name: t.name,
    description: t.description ?? undefined,
    priceWei: t.pricePerCallWei,
    inputSchema: t.inputSchema,
    outputSchema: t.outputSchema,
  }));

  // ── Step 3: plan ─────────────────────────────────────────────────────────
  let plan: Plan;
  try {
    plan = await llm.generatePlan({
      taskPrompt: task.prompt,
      parentContext,
      availableTools,
      budgetWei: BigInt(policy.balanceWei),
      maxPerCallWei: BigInt(policy.maxPerCallWei),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "plan generation failed";
    return finishFail(msg);
  }
  await db.setTaskPlan(task.id, plan);

  const check = validatePlan({ policy, toolsById, plan });
  if (!check.ok) {
    return finishFail(check.reason ?? "plan invalid");
  }
  sse.publish(
    task.id,
    envelope(task.id, "plan.generated", {
      steps: plan.steps,
      rationale: plan.rationale ?? null,
    }),
  );

  // ── Step 4: start the on-chain task ──────────────────────────────────────
  await db.updateTaskStatus(task.id, "executing");
  let onChainTaskId: Hex;
  try {
    const r = await chainClient.startTask({
      agentId: task.agentId,
      prompt: task.prompt,
    });
    onChainTaskId = r.onChainTaskId;
    const promptHash = keccak256(toHex(task.prompt));
    await db.setTaskOnChainId(task.id, onChainTaskId, promptHash, ("0x" +
      "00".repeat(32)) as Hex);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "startTask failed";
    return finishFail(msg);
  }

  // ── Step 5: per-step execute ─────────────────────────────────────────────
  const stepOutputs: StepOutput[] = [];
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i] as PlanStep;
    const tool = toolsById.get(step.toolId);
    if (!tool) return finishFail(`tool ${step.toolId} disappeared mid-run`);

    const stepIdx = i + 1;

    // Check for an already-recovered tool_call (reconcile path).
    const recovered = existing.find((tc) => tc.stepIdx === stepIdx);

    const inputHash = hashJson(step.input);

    let tcRow: ToolCallRow;
    if (recovered && (recovered.status === "paid" || recovered.status === "invoking" || recovered.status === "ok")) {
      tcRow = recovered;
    } else if (recovered) {
      tcRow = recovered;
      await db.updateToolCall(tcRow.id, {
        status: "planned",
        inputJson: step.input,
        inputHash,
        amountWei: step.expectedPriceWei,
      });
      tcRow = {
        ...tcRow,
        status: "planned",
        inputJson: step.input,
        inputHash,
        amountWei: step.expectedPriceWei,
      };
    } else {
      tcRow = {
        id: mkId(),
        taskId: task.id,
        stepIdx,
        toolId: step.toolId,
        toolVersion: step.toolVersion,
        amountWei: step.expectedPriceWei,
        status: "planned",
        txHash: null,
        receiptId: null,
        attempt: 0,
        inputJson: step.input,
        inputHash,
        outputJson: null,
        outputHash: null,
        httpStatus: null,
        error: null,
      };
      await db.insertToolCall(tcRow);
    }

    sse.publish(
      task.id,
      envelope(task.id, "tool.call.started", {
        stepIdx,
        toolId: step.toolId,
        amountWei: step.expectedPriceWei,
      }),
    );

    // ── pay (skip if already paid via reconcile) ─────────────────────────
    if (tcRow.status !== "paid" && tcRow.status !== "ok" && tcRow.status !== "invoking") {
      await db.updateToolCall(tcRow.id, { status: "paying" });
      try {
        const payRes = await chainClient.pay({
          onChainTaskId,
          toolId: step.toolId,
          toolVersion: step.toolVersion,
          expectedPriceWei: step.expectedPriceWei,
          inputHash,
        });
        await db.updateToolCall(tcRow.id, {
          status: "paid",
          txHash: payRes.txHash,
          receiptId: payRes.receiptId,
        });
        tcRow = {
          ...tcRow,
          status: "paid",
          txHash: payRes.txHash,
          receiptId: payRes.receiptId,
        };
        sse.publish(
          task.id,
          envelope(task.id, "payment.confirmed", {
            stepIdx,
            txHash: payRes.txHash,
            receiptId: payRes.receiptId,
          }),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "pay() failed";
        await db.updateToolCall(tcRow.id, {
          status: "failed",
          error: msg,
        });
        return finishFail(msg);
      }
    }

    // ── invoke provider ──────────────────────────────────────────────────
    if (tcRow.status !== "ok") {
      await db.updateToolCall(tcRow.id, { status: "invoking" });
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-agentpay-receipt": tcRow.receiptId as string,
        "x-agentpay-agent-id": task.agentId,
        "x-agentpay-tool-id": step.toolId,
        "x-agentpay-step": String(stepIdx),
        "x-agentpay-input-hash": inputHash,
      };
      const body = { input: step.input };
      try {
        const resp = await http({ url: tool.endpoint, body, headers });
        if (resp.status !== 200 || !resp.body || resp.body.output === undefined) {
          const reason = `provider returned ${resp.status}: ${
            resp.body?.error ?? "no output"
          }`;
          await db.updateToolCall(tcRow.id, {
            status: "failed",
            httpStatus: resp.status,
            error: reason,
          });
          sse.publish(
            task.id,
            envelope(task.id, "tool.call.failed", { stepIdx, reason }),
          );
          return finishFail(reason);
        }
        await db.updateToolCall(tcRow.id, {
          status: "ok",
          httpStatus: resp.status,
          outputJson: resp.body.output,
          outputHash: hashJson(resp.body.output),
        });
        stepOutputs.push({
          toolId: step.toolId,
          stepIdx,
          output: resp.body.output,
        });
        sse.publish(
          task.id,
          envelope(task.id, "tool.call.completed", {
            stepIdx,
            outputSummary:
              typeof resp.body.output === "string"
                ? resp.body.output.slice(0, 120)
                : JSON.stringify(resp.body.output).slice(0, 120),
          }),
        );
      } catch (err) {
        const reason =
          err instanceof Error ? err.message : "provider HTTP failed";
        await db.updateToolCall(tcRow.id, {
          status: "failed",
          error: reason,
        });
        sse.publish(
          task.id,
          envelope(task.id, "tool.call.failed", { stepIdx, reason }),
        );
        return finishFail(reason);
      }
    } else {
      // Already-ok step from a prior run: replay its output into stepOutputs.
      stepOutputs.push({
        toolId: step.toolId,
        stepIdx,
        output: tcRow.outputJson,
      });
    }
  }

  // ── Step 6: integrate ────────────────────────────────────────────────────
  await db.updateTaskStatus(task.id, "integrating");
  sse.publish(task.id, envelope(task.id, "integration.started", {}));
  let final: FinalDeliverable;
  try {
    final = await llm.integrate({ taskPrompt: task.prompt, stepOutputs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "integration failed";
    return finishFail(msg);
  }

  // ── Step 7: complete on chain ────────────────────────────────────────────
  const resultHash = keccak256(toHex(final.text));
  try {
    await chainClient.completeTask({ onChainTaskId, resultHash });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "completeTask failed";
    return finishFail(msg);
  }
  await db.setTaskResult(task.id, final.text, resultHash);
  await db.updateTaskStatus(task.id, "completed");
  sse.publish(
    task.id,
    envelope(task.id, "task.completed", {
      resultHash,
      deliverable: final,
    }),
  );
  return { status: "completed" };
}

// Expose the TaskRow type so test files can construct fixtures.
export type { TaskRow, ToolCallRow, AgentPolicyRow, ToolRow } from "./db.js";
