import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import Fastify, { type FastifyInstance } from "fastify";
import { COOKIE_NAME, env } from "./lib/env.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { marketplaceRoutes } from "./routes/marketplace.js";
import { agentsRoutes } from "./routes/agents.js";
import { tasksRoutes } from "./routes/tasks.js";
import { providerRoutes } from "./routes/provider.js";
import { startWatcher, stopWatcher } from "./chain/watcher.js";
import type { WorkerHandle } from "./worker/queue.js";
import type { SseHub } from "./worker/sse.js";
import type { WorkerDb } from "./worker/db.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { address: string };
    user: { address: string };
  }
}

// `app.worker` / `app.sse` are populated when OPERATOR_PK +
// MARKETPLACE_ADDRESS are set; otherwise routes fall back to the mock-worker
// timer baked into routes/tasks.ts.
declare module "fastify" {
  interface FastifyInstance {
    worker?: WorkerHandle;
    sse?: SseHub;
    workerDb?: WorkerDb;
  }
}

export interface BuildServerOptions {
  /**
   * Skip the live ChainClient + Worker wiring even when the env vars are
   * present. Tests use this so the routes don't try to connect to a real RPC.
   */
  disableWorker?: boolean;
}

export async function buildServer(opts: BuildServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
    trustProxy: true,
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true,
  });

  await app.register(cookie);

  await app.register(jwt, {
    secret: env.JWT_SECRET,
    cookie: {
      cookieName: COOKIE_NAME,
      signed: false,
    },
  });

  // Worker wiring — must happen BEFORE tasksRoutes registers so request
  // handlers can read `app.worker` / `app.sse` from the route's encapsulated
  // FastifyInstance. We start the worker eagerly here; the same handles are
  // stopped in main()'s shutdown hook.
  if (
    !opts.disableWorker &&
    process.env.OPERATOR_PK &&
    process.env.MARKETPLACE_ADDRESS
  ) {
    try {
      const { makeChainClient } = await import("./chain/wallet.js");
      const { startWorker } = await import("./worker/queue.js");
      const { makeLLMProvider } = await import("./worker/llm.js");
      const { createInMemorySseHub } = await import("./worker/sse.js");
      const { InMemoryWorkerDb } = await import("./worker/db.js");
      const { defaultProviderHttp } = await import("./worker/http.js");

      const sse = createInMemorySseHub();
      const db = new InMemoryWorkerDb();
      const worker = await startWorker({
        db,
        chainClient: makeChainClient(),
        llm: makeLLMProvider(),
        sse,
        http: defaultProviderHttp(),
      });
      app.decorate("worker", worker);
      app.decorate("sse", sse);
      app.decorate("workerDb", db);
      app.log.info("worker started with live ChainClient");
    } catch (err) {
      app.log.error(
        { err },
        "failed to start worker; routes will fall back to mock SSE",
      );
    }
  } else {
    app.log.info(
      "OPERATOR_PK or MARKETPLACE_ADDRESS missing; worker disabled (mock SSE)",
    );
  }

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(marketplaceRoutes);
  await app.register(agentsRoutes);
  await app.register(tasksRoutes);
  await app.register(providerRoutes);

  return app;
}

async function main() {
  const app = await buildServer();
  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Chain watcher (Track D): only if MARKETPLACE_ADDRESS is set, otherwise the
  // marketplace routes serve mock data and the watcher is a no-op.
  const marketplaceAddress = process.env.MARKETPLACE_ADDRESS;
  if (marketplaceAddress) {
    try {
      // Public Monad RPCs cap eth_getLogs range (Ankr ~10k blocks). Start from
      // MARKETPLACE_FROM_BLOCK (set to the deploy block) or 0 for local Anvil.
      const fromBlock = process.env.MARKETPLACE_FROM_BLOCK
        ? BigInt(process.env.MARKETPLACE_FROM_BLOCK)
        : 0n;
      await startWatcher({
        marketplaceAddress: marketplaceAddress as `0x${string}`,
        fromBlock,
      });
      app.log.info({ marketplaceAddress }, "chain watcher started");
    } catch (err) {
      app.log.error({ err }, "chain watcher failed to start");
    }
  } else {
    app.log.info("MARKETPLACE_ADDRESS not set; serving mock marketplace data");
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    try {
      stopWatcher();
      if (app.worker) {
        await app.worker.stop();
      }
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error(err, "error during shutdown");
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

const isDirectEntry = import.meta.url === `file://${process.argv[1]}`;
if (isDirectEntry) {
  void main();
}
