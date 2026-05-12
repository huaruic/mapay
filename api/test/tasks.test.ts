import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { decodeFunctionData } from "viem";
import { COOKIE_NAME } from "../src/lib/env.js";
import { MARKETPLACE_ABI } from "../src/lib/marketplace-abi.js";
import { resetStore } from "../src/lib/in-memory-store.js";
import { buildEndUserApp } from "./helpers/build-end-user-app.js";
import { siweSignin } from "./helpers/siwe-signin.js";

// Speed the demo event tick way down so tests don't stall.
process.env.TASK_EVENT_TICK_MS = "10";

type PrepareCreateOk = {
  calldata: { to: string; data: `0x${string}`; value: string };
  operatorAddress: `0x${string}`;
  expectedAgentId: string;
};

async function createAgent(
  app: FastifyInstance,
  cookie: string,
): Promise<string> {
  const create = await app.inject({
    method: "POST",
    url: "/api/agents/prepare-create",
    cookies: { [COOKIE_NAME]: cookie },
    payload: {
      name: "Test Agent",
      goal: "test goal",
      totalBudget: "0.5",
      maxPerCall: "0.15",
      dailySpendCap: "0.3",
    },
  });
  return (create.json() as PrepareCreateOk).expectedAgentId;
}

describe("Tasks — submit + snapshot + replay + rate", () => {
  let app: FastifyInstance;
  let cookie: string;
  let agentId: string;

  beforeAll(async () => {
    app = await buildEndUserApp();
    ({ cookie } = await siweSignin(app));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    resetStore();
    agentId = await createAgent(app, cookie);
  });

  // ---------------------------------------------------------------------------
  test("POST /api/agents/:id/tasks requires auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/tasks`,
      payload: { prompt: "do the thing" },
    });
    expect(res.statusCode).toBe(401);
  });

  test("POST /api/agents/:id/tasks rejects empty prompt", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/tasks`,
      cookies: { [COOKIE_NAME]: cookie },
      payload: { prompt: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  test("POST /api/agents/:id/tasks returns a uuid taskId", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/tasks`,
      cookies: { [COOKIE_NAME]: cookie },
      payload: { prompt: "make 3 tweets" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { taskId: string };
    expect(body.taskId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  // ---------------------------------------------------------------------------
  test("event sequence emits in expected order via /events endpoint", async () => {
    const submit = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/tasks`,
      cookies: { [COOKIE_NAME]: cookie },
      payload: { prompt: "make 3 tweets" },
    });
    const { taskId } = submit.json() as { taskId: string };

    // Poll the replay endpoint until task.completed shows up (or timeout).
    const expectedOrder = [
      "plan.generated",
      "tool.discovered",
      "tool.call.started",
      "payment.confirmed",
      "tool.call.completed",
      "integration.started",
      "task.completed",
    ];

    let attempts = 0;
    let events: Array<{ seq: number; type: string }> = [];
    while (attempts < 200) {
      attempts += 1;
      const res = await app.inject({
        method: "GET",
        url: `/api/tasks/${taskId}/events`,
        cookies: { [COOKIE_NAME]: cookie },
      });
      expect(res.statusCode).toBe(200);
      events = (res.json() as { events: Array<{ seq: number; type: string }> })
        .events;
      if (events.length >= expectedOrder.length) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    const seenTypes = events.map((e) => e.type);
    expect(seenTypes).toEqual(expectedOrder);

    // seq numbers are monotonically increasing 1..N
    for (let i = 0; i < events.length; i += 1) {
      expect(events[i].seq).toBe(i + 1);
    }
  });

  test("GET /api/tasks/:id snapshot contains prompt + events + status", async () => {
    const submit = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/tasks`,
      cookies: { [COOKIE_NAME]: cookie },
      payload: { prompt: "snapshot test" },
    });
    const { taskId } = submit.json() as { taskId: string };

    // Wait for completion.
    let body: {
      status: string;
      prompt: string;
      events: Array<{ type: string }>;
      deliverable: unknown;
    } | null = null;
    for (let i = 0; i < 200; i += 1) {
      const res = await app.inject({
        method: "GET",
        url: `/api/tasks/${taskId}`,
        cookies: { [COOKIE_NAME]: cookie },
      });
      expect(res.statusCode).toBe(200);
      body = res.json() as typeof body;
      if (body && body.status === "completed") break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(body).not.toBeNull();
    expect(body!.prompt).toBe("snapshot test");
    expect(body!.status).toBe("completed");
    expect(body!.deliverable).toBeTruthy();
    expect(body!.events.length).toBeGreaterThanOrEqual(7);
  });

  test("GET /api/tasks/:id/events?after=N returns only newer events", async () => {
    const submit = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/tasks`,
      cookies: { [COOKIE_NAME]: cookie },
      payload: { prompt: "replay test" },
    });
    const { taskId } = submit.json() as { taskId: string };
    // wait for first event
    for (let i = 0; i < 200; i += 1) {
      const res = await app.inject({
        method: "GET",
        url: `/api/tasks/${taskId}/events`,
        cookies: { [COOKIE_NAME]: cookie },
      });
      const { events } = res.json() as {
        events: Array<{ seq: number; type: string }>;
      };
      if (events.length >= 7) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    const after2 = await app.inject({
      method: "GET",
      url: `/api/tasks/${taskId}/events?after=2`,
      cookies: { [COOKIE_NAME]: cookie },
    });
    const { events } = after2.json() as {
      events: Array<{ seq: number; type: string }>;
    };
    // seq starts at 1; with after=2 we should skip events 1 and 2.
    expect(events[0]?.seq).toBe(3);
    for (const e of events) {
      expect(e.seq).toBeGreaterThan(2);
    }
  });

  // ---------------------------------------------------------------------------
  test("SSE stream emits all expected events in order", async () => {
    const submit = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/tasks`,
      cookies: { [COOKIE_NAME]: cookie },
      payload: { prompt: "sse test" },
    });
    const { taskId } = submit.json() as { taskId: string };

    // app.inject with payloadAsStream surfaces the raw response stream so we
    // can parse SSE frames.
    const res = await app.inject({
      method: "GET",
      url: `/api/tasks/${taskId}/stream`,
      cookies: { [COOKIE_NAME]: cookie },
      headers: { accept: "text/event-stream" },
      payloadAsStream: true,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");

    const seenEvents: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const safety = setTimeout(() => {
        reject(new Error(`stream did not complete; saw: ${seenEvents.join(",")}`));
      }, 5000);
      let buffer = "";
      res.stream().on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        // SSE frames are separated by \n\n.
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const eventLine = frame
            .split("\n")
            .find((l) => l.startsWith("event:"));
          if (eventLine) seenEvents.push(eventLine.slice("event:".length).trim());
        }
      });
      res.stream().on("end", () => {
        clearTimeout(safety);
        resolve();
      });
      res.stream().on("error", (err: Error) => {
        clearTimeout(safety);
        reject(err);
      });
    });

    expect(seenEvents).toEqual([
      "plan.generated",
      "tool.discovered",
      "tool.call.started",
      "payment.confirmed",
      "tool.call.completed",
      "integration.started",
      "task.completed",
    ]);
  });

  // ---------------------------------------------------------------------------
  test("POST /api/tasks/:id/prepare-rate encodes rateTask(bytes32 id, uint8 stars)", async () => {
    const submit = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/tasks`,
      cookies: { [COOKIE_NAME]: cookie },
      payload: { prompt: "rate me" },
    });
    const { taskId } = submit.json() as { taskId: string };

    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${taskId}/prepare-rate`,
      cookies: { [COOKIE_NAME]: cookie },
      payload: { stars: 5 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      calldata: { data: `0x${string}`; value: string };
    };
    expect(body.calldata.value).toBe("0");
    const decoded = decodeFunctionData({
      abi: MARKETPLACE_ABI,
      data: body.calldata.data,
    });
    expect(decoded.functionName).toBe("rateTask");
    expect((decoded.args[0] as string).startsWith("0x")).toBe(true);
    expect((decoded.args[0] as string)).toHaveLength(66);
    expect(decoded.args[1]).toBe(5);
  });

  test("POST /api/tasks/:id/prepare-rate rejects out-of-range stars", async () => {
    const submit = await app.inject({
      method: "POST",
      url: `/api/agents/${agentId}/tasks`,
      cookies: { [COOKIE_NAME]: cookie },
      payload: { prompt: "bad rate" },
    });
    const { taskId } = submit.json() as { taskId: string };

    const res = await app.inject({
      method: "POST",
      url: `/api/tasks/${taskId}/prepare-rate`,
      cookies: { [COOKIE_NAME]: cookie },
      payload: { stars: 7 },
    });
    expect(res.statusCode).toBe(400);
  });
});
