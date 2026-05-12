import type { FastifyInstance } from "fastify";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "vitest";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { MOCK_TOOLS, type Tool } from "../src/lib/mock-tools.js";
import { MarketplaceAbi } from "../src/chain/abi.js";
import {
  ingestLogForTesting,
  stopWatcher,
  type CachedTool,
} from "../src/chain/watcher.js";
import { buildTestApp } from "./helpers/build-app.js";

type ToolListResponse = {
  tools: Tool[];
  nextCursor: string | null;
};

function assertToolShape(t: Tool) {
  expect(typeof t.id).toBe("string");
  expect(typeof t.provider).toBe("string");
  expect(t.provider.startsWith("0x")).toBe(true);
  expect(typeof t.name).toBe("string");
  expect(typeof t.priceWei).toBe("string");
  expect(typeof t.priceDisplay).toBe("string");
  expect(typeof t.version).toBe("number");
  expect(typeof t.schemaHash).toBe("string");
  expect(t.schemaHash.startsWith("0x")).toBe(true);
  expect(typeof t.endpoint).toBe("string");
  expect(typeof t.enabled).toBe("boolean");
  expect(typeof t.calls).toBe("number");
  expect(t.rating === null || typeof t.rating === "number").toBe(true);
}

describe("Marketplace routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /api/marketplace/tools", () => {
    test("returns all 3 mocked tools with correct shape", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/marketplace/tools",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as ToolListResponse;
      expect(body.tools).toHaveLength(MOCK_TOOLS.length);
      expect(body.tools).toHaveLength(3);
      expect(body.nextCursor).toBeNull();
      for (const tool of body.tools) {
        assertToolShape(tool);
      }
    });

    test("limit=2 returns 2 tools plus a non-null nextCursor", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/marketplace/tools?limit=2",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as ToolListResponse;
      expect(body.tools).toHaveLength(2);
      expect(body.nextCursor).toBe("2");
    });

    test("cursor=2&limit=2 returns the tail and nextCursor=null", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/marketplace/tools?cursor=2&limit=2",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as ToolListResponse;
      // Only 1 tool remains after offset 2 (3 total)
      expect(body.tools).toHaveLength(MOCK_TOOLS.length - 2);
      expect(body.nextCursor).toBeNull();
    });

    test("limit=999 is rejected (exceeds max=100)", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/marketplace/tools?limit=999",
      });
      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toBe("invalid_query");
    });

    test("limit=100 is accepted (boundary)", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/marketplace/tools?limit=100",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as ToolListResponse;
      // With only 3 mocks, limit=100 returns everything
      expect(body.tools.length).toBeLessThanOrEqual(100);
      expect(body.tools).toHaveLength(MOCK_TOOLS.length);
    });

    test("limit=-1 returns 400 (zod validation)", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/marketplace/tools?limit=-1",
      });
      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toBe("invalid_query");
    });

    test("cursor=abc (NaN) returns 400 invalid_cursor", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/marketplace/tools?cursor=abc",
      });
      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toBe("invalid_cursor");
    });
  });

  describe("GET /api/tools/:id", () => {
    test("returns tool 1 with full mock-tool shape", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/tools/1",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Tool;
      expect(body.id).toBe("1");
      expect(body.name).toBe("Copywriter Agent");
      assertToolShape(body);
    });

    test("returns 404 for unknown id", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/tools/does-not-exist",
      });
      expect(res.statusCode).toBe(404);
      const body = res.json() as { error: string };
      expect(body.error).toBe("tool_not_found");
    });
  });
});

// ── Chain-aware mode ─────────────────────────────────────────────────────────
//
// When MARKETPLACE_ADDRESS is set, the route reads from the watcher's in-memory
// cache instead of the mock list. These tests inject synthetic logs via
// `ingestLogForTesting` so we don't need a real chain — we only care that:
//   (a) the route flips source based on env,
//   (b) the cache row's wire shape matches Tool,
//   (c) re-ingesting the same (txHash, logIndex) is idempotent.

const TEST_MARKETPLACE_ADDRESS =
  "0x0000000000000000000000000000000000c0ffee" as const;

function makeToolRegisteredLog(toolId: bigint, txHash: `0x${string}`, logIndex: number) {
  // ToolRegistered(toolId, provider, price, version): toolId + provider are
  // indexed (in topics); price + version are non-indexed and live in `data`.
  // viem's decodeEventLog refuses to decode if `data` is shorter than the
  // non-indexed param list, so we encode dummy but valid values here.
  const provider = "0x000000000000000000000000000000000000a1bc" as const;
  const topics = encodeEventTopics({
    abi: MarketplaceAbi,
    eventName: "ToolRegistered",
    args: { toolId, provider },
  });
  const data = encodeAbiParameters(
    [{ type: "uint128" }, { type: "uint64" }],
    [0n, 1n],
  );
  return {
    address: TEST_MARKETPLACE_ADDRESS,
    blockNumber: 100n,
    blockHash: ("0x" + "ab".repeat(32)) as `0x${string}`,
    transactionHash: txHash,
    transactionIndex: 0,
    logIndex,
    removed: false,
    data,
    topics: topics as readonly [`0x${string}`, ...`0x${string}`[]],
  };
}

function makeToolView(overrides: Partial<{
  pricePerCall: bigint;
  enabled: boolean;
  name: string;
}> = {}) {
  return {
    provider: "0x000000000000000000000000000000000000a1bc" as const,
    payout: "0x000000000000000000000000000000000000a1bc" as const,
    pricePerCall: overrides.pricePerCall ?? 30_000_000_000_000_000n, // 0.030 MON
    version: 1,
    enabled: overrides.enabled ?? true,
    schemaHash:
      "0x0000000000000000000000000000000000000000000000000000000000000abc" as const,
    endpoint: "https://tools.example.com/chain-tool",
    name: overrides.name ?? "Chain Tool",
    description: "from chain watcher",
  };
}

describe("Marketplace routes (chain-aware mode)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.MARKETPLACE_ADDRESS = TEST_MARKETPLACE_ADDRESS;
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.MARKETPLACE_ADDRESS;
    stopWatcher();
  });

  afterEach(() => {
    stopWatcher();
  });

  test("empty cache returns 0 tools (NOT mocks) when in chain mode", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/marketplace/tools",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { tools: CachedTool[]; nextCursor: string | null };
    expect(body.tools).toHaveLength(0);
    expect(body.nextCursor).toBeNull();
  });

  test("ingested ToolRegistered log appears in /api/marketplace/tools", async () => {
    await ingestLogForTesting({
      log: makeToolRegisteredLog(1n, ("0x" + "11".repeat(32)) as `0x${string}`, 0),
      toolView: makeToolView({ name: "Chain Tool A" }),
    });
    await ingestLogForTesting({
      log: makeToolRegisteredLog(2n, ("0x" + "22".repeat(32)) as `0x${string}`, 0),
      toolView: makeToolView({ name: "Chain Tool B", pricePerCall: 55_000_000_000_000_000n }),
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/marketplace/tools",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { tools: CachedTool[]; nextCursor: string | null };
    expect(body.tools).toHaveLength(2);

    const t1 = body.tools.find((t) => t.id === "1");
    expect(t1?.name).toBe("Chain Tool A");
    expect(t1?.priceWei).toBe("30000000000000000");
    expect(t1?.priceDisplay).toBe("0.030 MON");
    expect(t1?.version).toBe(1);
    expect(t1?.enabled).toBe(true);
    expect(t1?.schemaHash.startsWith("0x")).toBe(true);

    const t2 = body.tools.find((t) => t.id === "2");
    expect(t2?.name).toBe("Chain Tool B");
    expect(t2?.priceDisplay).toBe("0.055 MON");
  });

  test("GET /api/tools/:id finds chain-cached tool", async () => {
    await ingestLogForTesting({
      log: makeToolRegisteredLog(42n, ("0x" + "42".repeat(32)) as `0x${string}`, 0),
      toolView: makeToolView({ name: "Tool 42" }),
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/tools/42",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as CachedTool;
    expect(body.id).toBe("42");
    expect(body.name).toBe("Tool 42");

    // unknown id still 404s
    const miss = await app.inject({
      method: "GET",
      url: "/api/tools/9999",
    });
    expect(miss.statusCode).toBe(404);
  });

  test("re-ingesting same (txHash, logIndex) is idempotent (no duplicate)", async () => {
    const txHash = ("0x" + "ab".repeat(32)) as `0x${string}`;
    await ingestLogForTesting({
      log: makeToolRegisteredLog(7n, txHash, 0),
      toolView: makeToolView({ name: "Original" }),
    });
    // Re-ingest the same log with a different view — should be ignored.
    await ingestLogForTesting({
      log: makeToolRegisteredLog(7n, txHash, 0),
      toolView: makeToolView({ name: "Changed" }),
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/marketplace/tools",
    });
    const body = res.json() as { tools: CachedTool[] };
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0]?.name).toBe("Original");
  });

  test("pagination on chain-cached tools (limit=1)", async () => {
    await ingestLogForTesting({
      log: makeToolRegisteredLog(1n, ("0x" + "01".repeat(32)) as `0x${string}`, 0),
      toolView: makeToolView({ name: "A" }),
    });
    await ingestLogForTesting({
      log: makeToolRegisteredLog(2n, ("0x" + "02".repeat(32)) as `0x${string}`, 0),
      toolView: makeToolView({ name: "B" }),
    });

    const first = await app.inject({
      method: "GET",
      url: "/api/marketplace/tools?limit=1",
    });
    const firstBody = first.json() as { tools: CachedTool[]; nextCursor: string | null };
    expect(firstBody.tools).toHaveLength(1);
    expect(firstBody.nextCursor).toBe("1");

    const second = await app.inject({
      method: "GET",
      url: "/api/marketplace/tools?cursor=1&limit=1",
    });
    const secondBody = second.json() as { tools: CachedTool[]; nextCursor: string | null };
    expect(secondBody.tools).toHaveLength(1);
    expect(secondBody.nextCursor).toBeNull();
  });
});
