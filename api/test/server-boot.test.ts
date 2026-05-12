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
    const routes = app.printRoutes();
    expect(routes).toContain("healthz");
    expect(routes).toContain("auth");
    expect(routes).toContain("marketplace");
  });
});
