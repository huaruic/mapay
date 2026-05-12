import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/healthz", async () => ({
    ok: true,
    ts: new Date().toISOString(),
  }));
};
