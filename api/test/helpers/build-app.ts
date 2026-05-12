// Test-mode app factory. Env vars are seeded by `./setup-env.ts`, loaded as a
// vitest `setupFile` (see `vitest.config.ts`). Import this helper from any
// test file to obtain a fresh Fastify instance backed by the real routes.
import "./setup-env.js";
import { buildServer } from "../../src/server.js";

export async function buildTestApp() {
  const app = await buildServer();
  await app.ready();
  return app;
}
