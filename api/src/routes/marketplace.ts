import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { MOCK_TOOLS } from "../lib/mock-tools.js";

const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const marketplaceRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/marketplace/tools?cursor=&limit=20
  // Naive cursor = stringified index. Replace with on-chain event cache later.
  app.get("/api/marketplace/tools", async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query" });
    }
    const { cursor, limit } = parsed.data;
    const offset = cursor ? Number(cursor) : 0;
    if (!Number.isFinite(offset) || offset < 0) {
      return reply.code(400).send({ error: "invalid_cursor" });
    }

    const slice = MOCK_TOOLS.slice(offset, offset + limit);
    const nextOffset = offset + slice.length;
    const nextCursor =
      nextOffset < MOCK_TOOLS.length ? String(nextOffset) : null;

    return { tools: slice, nextCursor };
  });

  // GET /api/tools/:id
  app.get<{ Params: { id: string } }>("/api/tools/:id", async (request, reply) => {
    const tool = MOCK_TOOLS.find((t) => t.id === request.params.id);
    if (!tool) return reply.code(404).send({ error: "tool_not_found" });
    return tool;
  });
};
