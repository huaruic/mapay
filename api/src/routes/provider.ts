// INTEGRATION: register in api/src/server.ts via: app.register(providerRoutes);
//
// Provider-side routes — registering paid tools on chain, viewing earnings,
// etc. For this turn we ship the prepare-register flow; the others (stats,
// withdraw) will land alongside Track G/H follow-ups.

import type { FastifyPluginAsync } from "fastify";
import { encodeFunctionData, keccak256, parseEther, toHex } from "viem";
import { z } from "zod";
import { requireAuth } from "../lib/auth-guard.js";
import {
  MARKETPLACE_ABI,
  MARKETPLACE_ADDRESS,
} from "../lib/marketplace-abi.js";

const registerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  endpoint: z.string().trim().url(),
  priceMon: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/, "priceMon must be a non-negative decimal"),
  payout: z
    .string()
    .trim()
    .regex(/^0x[a-fA-F0-9]{40}$/, "payout must be a 0x-prefixed address"),
  schemaJson: z.string().trim().min(2).optional(),
});

export const providerRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/provider/tools/prepare-register
  //
  // Returns viem-encoded calldata for `Marketplace.registerTool(...)`.
  // The frontend uses `useSendTransaction` to broadcast; once mined, chain
  // watcher picks up `ToolRegistered` and serves the tool via marketplace
  // routes.
  app.post("/api/provider/tools/prepare-register", async (request, reply) => {
    const owner = await requireAuth(request, reply);
    if (!owner) return;

    if (!MARKETPLACE_ADDRESS) {
      return reply.code(503).send({
        error: "marketplace_address_unset",
        message: "Set MARKETPLACE_ADDRESS in api/.env to enable registration.",
      });
    }

    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const { name, description, endpoint, priceMon, payout, schemaJson } =
      parsed.data;

    // schemaJson is optional in MVP — we hash the JSON string if provided,
    // otherwise fall back to keccak256 of a canonical placeholder so the
    // on-chain field is never zero (zero would look like "no schema" to
    // future Worker validations).
    const schemaBytes = schemaJson
      ? new TextEncoder().encode(schemaJson)
      : new TextEncoder().encode(`{"name":"${name}","placeholder":true}`);
    const schemaHash = keccak256(toHex(schemaBytes));

    let priceWei: bigint;
    try {
      priceWei = parseEther(priceMon);
    } catch {
      return reply
        .code(400)
        .send({ error: "invalid_price", message: "priceMon parse failed" });
    }

    const data = encodeFunctionData({
      abi: MARKETPLACE_ABI,
      functionName: "registerTool",
      args: [
        endpoint,
        schemaHash,
        priceWei,
        name,
        description,
        payout as `0x${string}`,
      ],
    });

    return {
      calldata: {
        to: MARKETPLACE_ADDRESS,
        data,
        value: "0x0" as const,
      },
      schemaHash,
      priceWei: priceWei.toString(),
    };
  });
};
