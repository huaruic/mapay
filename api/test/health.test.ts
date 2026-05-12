import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildTestApp } from "./helpers/build-app.js";

describe("GET /healthz", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  test("returns 200 with ok=true and ISO timestamp", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; ts: string };
    expect(body.ok).toBe(true);
    expect(typeof body.ts).toBe("string");
    // ISO 8601 string parses to a finite Date
    const parsed = new Date(body.ts);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
    // The ts roundtrips cleanly through Date.
    expect(parsed.toISOString()).toBe(body.ts);
  });
});
