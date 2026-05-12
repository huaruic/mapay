import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { decodeFunctionData, parseEther } from "viem";
import { COOKIE_NAME } from "../src/lib/env.js";
import { MARKETPLACE_ABI } from "../src/lib/marketplace-abi.js";
import { resetStore } from "../src/lib/in-memory-store.js";
import { buildEndUserApp } from "./helpers/build-end-user-app.js";
import { siweSignin, TEST_ADDRESS } from "./helpers/siwe-signin.js";

type PrepareCreateOk = {
  calldata: { to: string; data: `0x${string}`; value: string };
  operatorAddress: `0x${string}`;
  expectedAgentId: string;
};

describe("Agents — prepare-create + GET + ownership", () => {
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    app = await buildEndUserApp();
    ({ cookie } = await siweSignin(app));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    // Each test should start with a clean store — but we still want the cookie
    // from sign-in to remain valid across tests, so we only nuke the agents
    // portion of state here. (resetStore clears everything else too; auth
    // doesn't live in this store.)
    resetStore();
  });

  // ---------------------------------------------------------------------------
  test("GET /api/agents requires auth", async () => {
    const res = await app.inject({ method: "GET", url: "/api/agents" });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: string }).error).toBe("unauthenticated");
  });

  test("GET /api/agents returns empty list for fresh owner", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/agents",
      cookies: { [COOKIE_NAME]: cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ agents: [] });
  });

  // ---------------------------------------------------------------------------
  test("POST /api/agents/prepare-create returns valid calldata + operator", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/agents/prepare-create",
      cookies: { [COOKIE_NAME]: cookie },
      payload: {
        name: "Marketing Agent",
        goal: "生成 3 条带配图的 SaaS 发布推文",
        totalBudget: "0.5",
        maxPerCall: "0.15",
        dailySpendCap: "0.3",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as PrepareCreateOk;

    expect(body.calldata.to).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(body.calldata.data).toMatch(/^0x[0-9a-fA-F]+$/);
    expect(BigInt(body.calldata.value)).toBe(parseEther("0.5"));
    expect(body.operatorAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(body.expectedAgentId).toBe("1");

    // Decode calldata to verify each parameter survives the encode roundtrip.
    const decoded = decodeFunctionData({
      abi: MARKETPLACE_ABI,
      data: body.calldata.data,
    });
    expect(decoded.functionName).toBe("createAndFundAgent");
    const [maxPerCall, dailySpendCap, operator, name, goal] = decoded.args as [
      bigint,
      bigint,
      `0x${string}`,
      string,
      string,
    ];
    expect(maxPerCall).toBe(parseEther("0.15"));
    expect(dailySpendCap).toBe(parseEther("0.3"));
    expect(operator.toLowerCase()).toBe(body.operatorAddress.toLowerCase());
    expect(name).toBe("Marketing Agent");
    expect(goal).toBe("生成 3 条带配图的 SaaS 发布推文");
  });

  test("prepare-create rejects maxPerCall > totalBudget", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/agents/prepare-create",
      cookies: { [COOKIE_NAME]: cookie },
      payload: {
        name: "Greedy Agent",
        goal: "spend everything",
        totalBudget: "0.1",
        maxPerCall: "0.2",
        dailySpendCap: "0.2",
      },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe("invalid_body");
  });

  test("prepare-create rejects dailySpendCap > totalBudget", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/agents/prepare-create",
      cookies: { [COOKIE_NAME]: cookie },
      payload: {
        name: "Loose Agent",
        goal: "no daily limit",
        totalBudget: "0.1",
        maxPerCall: "0.05",
        dailySpendCap: "1.0",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  test("prepare-create rejects dailySpendCap < maxPerCall", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/agents/prepare-create",
      cookies: { [COOKIE_NAME]: cookie },
      payload: {
        name: "Inconsistent Agent",
        goal: "daily cap below per-call",
        totalBudget: "0.5",
        maxPerCall: "0.2",
        dailySpendCap: "0.1",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  test("prepare-create rejects zero or negative totalBudget", async () => {
    const zero = await app.inject({
      method: "POST",
      url: "/api/agents/prepare-create",
      cookies: { [COOKIE_NAME]: cookie },
      payload: {
        name: "Zero Agent",
        goal: "no funds",
        totalBudget: "0",
        maxPerCall: "0",
        dailySpendCap: "0",
      },
    });
    expect(zero.statusCode).toBe(400);
  });

  test("prepare-create rejects oversized name", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/agents/prepare-create",
      cookies: { [COOKIE_NAME]: cookie },
      payload: {
        name: "x".repeat(51),
        goal: "ok",
        totalBudget: "0.5",
        maxPerCall: "0.1",
        dailySpendCap: "0.2",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  // ---------------------------------------------------------------------------
  test("GET /api/agents/:id returns the agent for its owner", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/agents/prepare-create",
      cookies: { [COOKIE_NAME]: cookie },
      payload: {
        name: "Marketing Agent",
        goal: "goal",
        totalBudget: "0.5",
        maxPerCall: "0.15",
        dailySpendCap: "0.3",
      },
    });
    expect(create.statusCode).toBe(200);
    const { expectedAgentId } = create.json() as PrepareCreateOk;

    const get = await app.inject({
      method: "GET",
      url: `/api/agents/${expectedAgentId}`,
      cookies: { [COOKIE_NAME]: cookie },
    });
    expect(get.statusCode).toBe(200);
    const body = get.json() as { id: string; name: string; owner: string };
    expect(body.id).toBe(expectedAgentId);
    expect(body.name).toBe("Marketing Agent");
    expect(body.owner.toLowerCase()).toBe(TEST_ADDRESS.toLowerCase());
  });

  test("GET /api/agents/:id returns 404 for unknown id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/agents/9999",
      cookies: { [COOKIE_NAME]: cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  test("GET /api/agents/:id rejects non-owner with 403", async () => {
    // Create an agent as user A.
    const create = await app.inject({
      method: "POST",
      url: "/api/agents/prepare-create",
      cookies: { [COOKIE_NAME]: cookie },
      payload: {
        name: "Owner A Agent",
        goal: "g",
        totalBudget: "0.5",
        maxPerCall: "0.15",
        dailySpendCap: "0.3",
      },
    });
    const { expectedAgentId } = create.json() as PrepareCreateOk;

    // Sign in as user B (different test PK).
    const userB = await siweSignin(
      app,
      "0x8da4ef21b864d2cc526dbdb2a120bd2874c36c9d0a1fb7f8c63d7f7a8b41de8f" as `0x${string}`,
    );

    const res = await app.inject({
      method: "GET",
      url: `/api/agents/${expectedAgentId}`,
      cookies: { [COOKIE_NAME]: userB.cookie },
    });
    expect(res.statusCode).toBe(403);
  });

  // ---------------------------------------------------------------------------
  test("POST /api/agents/:id/prepare-fund encodes fundAgent(id) with value", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/agents/prepare-create",
      cookies: { [COOKIE_NAME]: cookie },
      payload: {
        name: "Fund target",
        goal: "g",
        totalBudget: "0.5",
        maxPerCall: "0.1",
        dailySpendCap: "0.2",
      },
    });
    const { expectedAgentId } = create.json() as PrepareCreateOk;

    const res = await app.inject({
      method: "POST",
      url: `/api/agents/${expectedAgentId}/prepare-fund`,
      cookies: { [COOKIE_NAME]: cookie },
      payload: { amount: "0.25" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      calldata: { to: string; data: `0x${string}`; value: string };
    };
    expect(BigInt(body.calldata.value)).toBe(parseEther("0.25"));
    const decoded = decodeFunctionData({
      abi: MARKETPLACE_ABI,
      data: body.calldata.data,
    });
    expect(decoded.functionName).toBe("fundAgent");
    expect(decoded.args[0]).toBe(BigInt(expectedAgentId));
  });

  test("POST /api/agents/:id/prepare-withdraw encodes withdrawAgentBalance", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/agents/prepare-create",
      cookies: { [COOKIE_NAME]: cookie },
      payload: {
        name: "Withdraw target",
        goal: "g",
        totalBudget: "0.5",
        maxPerCall: "0.1",
        dailySpendCap: "0.2",
      },
    });
    const { expectedAgentId } = create.json() as PrepareCreateOk;

    const res = await app.inject({
      method: "POST",
      url: `/api/agents/${expectedAgentId}/prepare-withdraw`,
      cookies: { [COOKIE_NAME]: cookie },
      payload: { amount: "0.1" },
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
    expect(decoded.functionName).toBe("withdrawAgentBalance");
    expect(decoded.args[0]).toBe(BigInt(expectedAgentId));
    expect(decoded.args[1]).toBe(parseEther("0.1"));
  });

  // ---------------------------------------------------------------------------
  test("GET /api/agents/aggregate-stats returns sums for caller", async () => {
    // Seed one agent.
    await app.inject({
      method: "POST",
      url: "/api/agents/prepare-create",
      cookies: { [COOKIE_NAME]: cookie },
      payload: {
        name: "Marketing",
        goal: "g",
        totalBudget: "0.5",
        maxPerCall: "0.15",
        dailySpendCap: "0.3",
      },
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/agents/aggregate-stats",
      cookies: { [COOKIE_NAME]: cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      agents: number;
      totalBalance: string;
      completedTasks: number;
      highestReputation: number;
    };
    expect(body.agents).toBe(1);
    expect(body.totalBalance).toBe("0.5");
    expect(body.completedTasks).toBe(0);
    expect(body.highestReputation).toBe(50);
  });
});
