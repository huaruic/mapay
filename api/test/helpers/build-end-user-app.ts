// End User test app. After server.ts integration, agentsRoutes + tasksRoutes
// are registered by buildServer() itself; this helper now only resets the
// in-memory store between suites so tests are hermetic.

import "./setup-env.js";
import { buildServer } from "../../src/server.js";
import { resetStore } from "../../src/lib/in-memory-store.js";

export async function buildEndUserApp() {
  resetStore();
  const app = await buildServer();
  await app.ready();
  return app;
}
