// End-to-end Worker pipeline tests with all integrations mocked: the in-memory
// DB, a controllable ChainClient stub, a deterministic LLM, and an inline
// HTTP responder. These tests are the source of truth for the §10 state
// machine — every transition listed in the design doc is asserted here.

import { describe, expect, test, vi } from "vitest";
import { MockLLMProvider } from "./llm.js";
import {
  InMemoryWorkerDb,
  type AgentPolicyRow,
  type ToolCallRow,
  type ToolRow,
} from "./db.js";
import { runTask, type ProviderHttp, type ProviderRequest } from "./runTask.js";
import type { ChainClient, Hex, PayResult, StartTaskResult } from "./chain.js";
import { createInMemorySseHub, type TaskEventEnvelope } from "./sse.js";

const AGENT_ID = "1";
const TASK_ID = "task-uuid-1";

function makePolicy(): AgentPolicyRow {
  return {
    id: AGENT_ID,
    ownerAddress: "0x" + "11".repeat(20),
    operatorAddress: "0x" + "22".repeat(20),
    balanceWei: "1000",
    maxPerCallWei: "200",
    dailySpendCapWei: "1000",
    dailySpentWei: "0",
  };
}

function makeTools(): ToolRow[] {
  return [
    {
      id: "10",
      version: 1,
      pricePerCallWei: "100",
      endpoint: "http://provider-a/invoke",
      enabled: true,
      name: "tool-a",
      description: "first tool",
    },
    {
      id: "11",
      version: 1,
      pricePerCallWei: "150",
      endpoint: "http://provider-b/invoke",
      enabled: true,
      name: "tool-b",
      description: "second tool",
    },
    {
      id: "12",
      version: 1,
      pricePerCallWei: "175",
      endpoint: "http://provider-c/invoke",
      enabled: true,
      name: "tool-c",
      description: "third tool",
    },
  ];
}

function seed(opts: { policy?: AgentPolicyRow; tools?: ToolRow[] } = {}) {
  const db = new InMemoryWorkerDb();
  db.tasks.set(TASK_ID, {
    id: TASK_ID,
    agentId: AGENT_ID,
    parentTaskId: null,
    status: "pending",
    prompt: "write a marketing tweet about agents",
    promptHash: null,
    salt: null,
    onChainTaskId: null,
    resultText: null,
    resultHash: null,
    planJson: null,
    error: null,
  });
  db.agents.set(AGENT_ID, opts.policy ?? makePolicy());
  db.tools = opts.tools ?? makeTools();
  return db;
}

interface ChainStubOptions {
  payRevert?: string;
}

function makeChainStub(opts: ChainStubOptions = {}): ChainClient & {
  payCalls: number;
} {
  const stub = {
    payCalls: 0,
    async startTask(): Promise<StartTaskResult> {
      return {
        onChainTaskId: ("0x" + "ab".repeat(32)) as Hex,
        txHash: ("0x" + "cd".repeat(32)) as Hex,
      };
    },
    async pay({
      toolId,
    }: {
      toolId: string;
      onChainTaskId: Hex;
      toolVersion: number;
      expectedPriceWei: string;
      inputHash: Hex;
    }): Promise<PayResult> {
      stub.payCalls += 1;
      if (opts.payRevert) {
        throw new Error(opts.payRevert);
      }
      return {
        receiptId: (`0x${"de".repeat(31)}${stub.payCalls.toString(16).padStart(2, "0")}`) as Hex,
        stepIdx: stub.payCalls,
        txHash: (`0x${"ee".repeat(31)}${stub.payCalls.toString(16).padStart(2, "0")}`) as Hex,
      };
      void toolId;
    },
    async completeTask() {
      return { txHash: ("0x" + "fe".repeat(32)) as Hex };
    },
    async reconcilePayTx(_txHash: Hex) {
      return { confirmed: false };
    },
  };
  return stub;
}

function makeHttp(
  responder: (req: ProviderRequest) => Promise<{
    status: number;
    body: { output?: unknown; error?: string } | null;
  }>,
): ProviderHttp {
  return vi.fn(responder);
}

function recordEvents(taskId: string, hub: ReturnType<typeof createInMemorySseHub>) {
  const events: TaskEventEnvelope[] = [];
  hub.subscribe(taskId, (e) => events.push(e));
  return events;
}

describe("runTask — §10 state machine", () => {
  test("happy path: 2-step plan walks all transitions to completed", async () => {
    const db = seed();
    const chain = makeChainStub();
    const sse = createInMemorySseHub();
    const events = recordEvents(TASK_ID, sse);
    const http = makeHttp(async (req) => ({
      status: 200,
      body: { output: { echoed: req.body.input } },
    }));

    const result = await runTask(
      { taskId: TASK_ID },
      {
        db,
        chainClient: chain,
        llm: new MockLLMProvider({ stepCount: 2 }),
        sse,
        http,
      },
    );

    expect(result.status).toBe("completed");
    const task = await db.getTask(TASK_ID);
    expect(task?.status).toBe("completed");
    expect(task?.resultText).toContain("mock integration");
    expect(task?.onChainTaskId).toMatch(/^0x[0-9a-f]+/);

    // Step rows show full progression to ok.
    const calls = await db.listToolCalls(TASK_ID);
    expect(calls.length).toBe(2);
    for (const c of calls) {
      expect(c.status).toBe("ok");
      expect(c.txHash).not.toBeNull();
      expect(c.receiptId).not.toBeNull();
      expect(c.outputHash).not.toBeNull();
    }

    // SSE traces: each step emits started → payment.confirmed → completed
    const types = events.map((e) => e.type);
    expect(types).toContain("task.planning");
    expect(types).toContain("plan.generated");
    expect(types.filter((t) => t === "tool.call.started").length).toBe(2);
    expect(types.filter((t) => t === "payment.confirmed").length).toBe(2);
    expect(types.filter((t) => t === "tool.call.completed").length).toBe(2);
    expect(types).toContain("integration.started");
    expect(types).toContain("task.completed");

    // seq is monotonic
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1] as TaskEventEnvelope;
      const cur = events[i] as TaskEventEnvelope;
      expect(cur.seq).toBeGreaterThan(prev.seq);
    }
  });

  test("plan exceeding budget is rejected → task.failed, no chain calls", async () => {
    const policy = makePolicy();
    policy.balanceWei = "50"; // less than even the cheapest tool
    const db = seed({ policy });
    const chain = makeChainStub();
    const http = makeHttp(async () => ({ status: 200, body: { output: {} } }));
    const sse = createInMemorySseHub();
    const events = recordEvents(TASK_ID, sse);

    const result = await runTask(
      { taskId: TASK_ID },
      {
        db,
        chainClient: chain,
        llm: new MockLLMProvider({ stepCount: 2 }),
        sse,
        http,
      },
    );
    expect(result.status).toBe("failed");
    expect(chain.payCalls).toBe(0);
    const task = await db.getTask(TASK_ID);
    expect(task?.status).toBe("failed");
    expect(task?.error?.length).toBeGreaterThan(0);
    expect(events.map((e) => e.type)).toContain("task.failed");
  });

  test("tool HTTP failure → step+task failed, payment is NOT rolled back (§9.2)", async () => {
    const db = seed();
    const chain = makeChainStub();
    const sse = createInMemorySseHub();
    recordEvents(TASK_ID, sse);
    const http = makeHttp(async () => ({
      status: 500,
      body: { error: "boom" },
    }));

    const result = await runTask(
      { taskId: TASK_ID },
      {
        db,
        chainClient: chain,
        llm: new MockLLMProvider({ stepCount: 2 }),
        sse,
        http,
      },
    );

    expect(result.status).toBe("failed");
    expect(chain.payCalls).toBe(1); // first step still paid before the failure
    const calls = await db.listToolCalls(TASK_ID);
    const first = calls[0] as ToolCallRow;
    expect(first.status).toBe("failed");
    expect(first.txHash).not.toBeNull(); // payment did happen (no refund)
    expect(first.error).toContain("500");
  });

  test("pay() revert → step+task failed, no HTTP call", async () => {
    const db = seed();
    const chain = makeChainStub({ payRevert: "tool version mismatch" });
    const sse = createInMemorySseHub();
    let httpCalls = 0;
    const http = makeHttp(async () => {
      httpCalls += 1;
      return { status: 200, body: { output: {} } };
    });

    const result = await runTask(
      { taskId: TASK_ID },
      {
        db,
        chainClient: chain,
        llm: new MockLLMProvider({ stepCount: 1 }),
        sse,
        http,
      },
    );

    expect(result.status).toBe("failed");
    expect(httpCalls).toBe(0);
    const calls = await db.listToolCalls(TASK_ID);
    expect(calls[0]?.status).toBe("failed");
    expect(calls[0]?.txHash).toBeNull();
  });

  test("reconcile-after-crash: pre-existing paying row whose tx confirmed is picked up", async () => {
    const db = seed();
    // Simulate: previous Worker run wrote a tool_calls row in state `paying`
    // with a known txHash, then crashed before the chain receipt came back.
    const recovered: ToolCallRow = {
      id: "tc-pre",
      taskId: TASK_ID,
      stepIdx: 1,
      toolId: "10", // matches what MockLLM will plan (cheapest first)
      toolVersion: 1,
      amountWei: "100",
      status: "paying",
      txHash: ("0x" + "aa".repeat(32)) as Hex,
      receiptId: null,
      attempt: 0,
      inputJson: { prompt: "write a marketing tweet about agents" },
      inputHash: null,
      outputJson: null,
      outputHash: null,
      httpStatus: null,
      error: null,
    };
    await db.insertToolCall(recovered);

    const RECOVERED_RECEIPT = ("0x" + "12".repeat(32)) as Hex;
    const chain: ChainClient & { payCalls: number; reconcileCalls: number } = {
      payCalls: 0,
      reconcileCalls: 0,
      async startTask() {
        return {
          onChainTaskId: ("0x" + "ab".repeat(32)) as Hex,
          txHash: ("0x" + "cd".repeat(32)) as Hex,
        };
      },
      async pay() {
        this.payCalls += 1;
        return {
          receiptId: ("0x" + "11".repeat(32)) as Hex,
          stepIdx: this.payCalls + 1,
          txHash: ("0x" + "22".repeat(32)) as Hex,
        };
      },
      async completeTask() {
        return { txHash: ("0x" + "fe".repeat(32)) as Hex };
      },
      async reconcilePayTx(txHash: Hex) {
        this.reconcileCalls += 1;
        expect(txHash).toBe(recovered.txHash);
        return {
          confirmed: true,
          reverted: false,
          receiptId: RECOVERED_RECEIPT,
          stepIdx: 1,
        };
      },
    };

    const sse = createInMemorySseHub();
    const events = recordEvents(TASK_ID, sse);
    const http = makeHttp(async () => ({
      status: 200,
      body: { output: { echoed: "ok" } },
    }));

    const result = await runTask(
      { taskId: TASK_ID },
      {
        db,
        chainClient: chain,
        llm: new MockLLMProvider({ stepCount: 2 }),
        sse,
        http,
      },
    );

    expect(result.status).toBe("completed");
    expect(chain.reconcileCalls).toBe(1);

    // CRITICAL: step 1 was NOT paid a second time — only step 2 should have
    // gone through pay().
    expect(chain.payCalls).toBe(1);

    // The recovered row now carries the receipt the reconcile resolved.
    const calls = await db.listToolCalls(TASK_ID);
    const step1 = calls.find((c) => c.stepIdx === 1);
    expect(step1?.receiptId).toBe(RECOVERED_RECEIPT);
    expect(step1?.status).toBe("ok");

    // Recovery emits a payment.confirmed with recovered=true so the UI can
    // distinguish a normal payment from a reconciled one.
    const recovered_event = events.find(
      (e) =>
        e.type === "payment.confirmed" &&
        (e.payload as { recovered?: boolean }).recovered === true,
    );
    expect(recovered_event).toBeDefined();
  });

  test("reconcile-after-crash: prior pay() tx reverted → task.failed without re-broadcast", async () => {
    const db = seed();
    const recovered: ToolCallRow = {
      id: "tc-pre",
      taskId: TASK_ID,
      stepIdx: 1,
      toolId: "10",
      toolVersion: 1,
      amountWei: "100",
      status: "paying",
      txHash: ("0x" + "aa".repeat(32)) as Hex,
      receiptId: null,
      attempt: 0,
      inputJson: null,
      inputHash: null,
      outputJson: null,
      outputHash: null,
      httpStatus: null,
      error: null,
    };
    await db.insertToolCall(recovered);

    const chain: ChainClient & { payCalls: number } = {
      payCalls: 0,
      async startTask() {
        return {
          onChainTaskId: ("0x" + "ab".repeat(32)) as Hex,
          txHash: ("0x" + "cd".repeat(32)) as Hex,
        };
      },
      async pay() {
        this.payCalls += 1;
        return {
          receiptId: ("0x" + "11".repeat(32)) as Hex,
          stepIdx: 1,
          txHash: ("0x" + "22".repeat(32)) as Hex,
        };
      },
      async completeTask() {
        return { txHash: ("0x" + "fe".repeat(32)) as Hex };
      },
      async reconcilePayTx() {
        return { confirmed: true, reverted: true };
      },
    };

    const sse = createInMemorySseHub();
    const http = makeHttp(async () => ({ status: 200, body: { output: {} } }));
    const result = await runTask(
      { taskId: TASK_ID },
      {
        db,
        chainClient: chain,
        llm: new MockLLMProvider({ stepCount: 1 }),
        sse,
        http,
      },
    );

    expect(result.status).toBe("failed");
    expect(chain.payCalls).toBe(0); // no re-broadcast
    const calls = await db.listToolCalls(TASK_ID);
    expect(calls[0]?.status).toBe("failed");
  });

  test("LLM returns empty plan → task.failed before any on-chain write", async () => {
    const db = seed();
    const chain = makeChainStub();
    const sse = createInMemorySseHub();
    const http = makeHttp(async () => ({ status: 200, body: { output: {} } }));
    // Force empty plan
    const llm = new MockLLMProvider({ stepCount: 0 });

    const result = await runTask(
      { taskId: TASK_ID },
      { db, chainClient: chain, llm, sse, http },
    );
    expect(result.status).toBe("failed");
    expect(chain.payCalls).toBe(0);
  });
});
