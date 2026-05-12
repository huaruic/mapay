import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { env } from "../src/lib/env.js";
import { buildTestApp } from "./helpers/build-app.js";

describe("Server boot + plugin registration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  test("app boots and exposes hasDecorator for jwt", () => {
    // `@fastify/jwt` decorates the instance with `jwt`
    expect(app.hasDecorator("jwt")).toBe(true);
    // `@fastify/cookie` decorates with `parseCookie`
    expect(app.hasDecorator("parseCookie")).toBe(true);
  });

  test("CORS preflight allows the configured origin with credentials", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/marketplace/tools",
      headers: {
        origin: env.CORS_ORIGIN,
        "access-control-request-method": "GET",
      },
    });
    // Preflight should be 204 (Fastify CORS default) or 200; either is fine.
    expect([200, 204]).toContain(res.statusCode);
    expect(res.headers["access-control-allow-origin"]).toBe(env.CORS_ORIGIN);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  test("404 for unknown route", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/this/route/does/not/exist",
    });
    expect(res.statusCode).toBe(404);
  });

  test("known routes are registered", async () => {
    // printRoutes() output format varies with route count; assert reachability
    // directly rather than parse the tree string.
    const health = await app.inject({ method: "GET", url: "/healthz" });
    expect(health.statusCode).toBe(200);
    const nonce = await app.inject({ method: "POST", url: "/api/auth/nonce" });
    expect(nonce.statusCode).toBe(200);
    const tools = await app.inject({
      method: "GET",
      url: "/api/marketplace/tools?limit=1",
    });
    expect(tools.statusCode).toBe(200);
  });
});
