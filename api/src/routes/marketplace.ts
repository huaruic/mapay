import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { MOCK_TOOLS, type Tool } from "../lib/mock-tools.js";
import { getCachedTools, getCachedTool } from "../chain/watcher.js";

const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Source-of-truth for whether the marketplace routes serve chain data.
 *  Evaluated per-request so tests can flip `process.env.MARKETPLACE_ADDRESS`
 *  between cases without rebuilding the Fastify app. */
function isChainMode(): boolean {
  const addr = process.env.MARKETPLACE_ADDRESS;
  return typeof addr === "string" && addr.length > 0;
}

function readTools(): Tool[] {
  if (isChainMode()) {
    // CachedTool's wire shape is a structural superset of Tool — same field
    // names + types. Casting through `unknown` keeps tsc happy when the cache
    // row's Address-typed `provider` widens to Tool's `0x${string}` literal.
    return getCachedTools() as unknown as Tool[];
  }
  return MOCK_TOOLS;
}

function readTool(id: string): Tool | undefined {
  if (isChainMode()) {
    const t = getCachedTool(id);
    return t as unknown as Tool | undefined;
  }
  return MOCK_TOOLS.find((t) => t.id === id);
}

export const marketplaceRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/marketplace/tools?cursor=&limit=20
  // Naive cursor = stringified index. When MARKETPLACE_ADDRESS is set, reads
  // from the chain-watcher cache (api/src/chain/watcher.ts); otherwise falls
  // back to the in-repo mock tools — both share an identical wire shape.
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

    const all = readTools();
    const slice = all.slice(offset, offset + limit);
    const nextOffset = offset + slice.length;
    const nextCursor = nextOffset < all.length ? String(nextOffset) : null;

    return { tools: slice, nextCursor };
  });

  // GET /api/tools/:id
  app.get<{ Params: { id: string } }>("/api/tools/:id", async (request, reply) => {
    const tool = readTool(request.params.id);
    if (!tool) return reply.code(404).send({ error: "tool_not_found" });
    return tool;
  });
};
