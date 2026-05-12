import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { MOCK_TOOLS, type Tool } from "../src/lib/mock-tools.js";
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
