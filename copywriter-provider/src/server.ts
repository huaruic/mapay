// Copywriter provider service — a paid AgentPay tool.
//
// Pipeline per request:
//   1. agentPay middleware verifies + consumes the on-chain receipt BEFORE
//      this handler runs. Unpaid requests never reach DeepSeek (quota guard).
//   2. zod validates the body shape.
//   3. DeepSeekCopywriter generates the tweets.
//   4. We return { output: { tweets, suggestedHashtags } }.
//
// Per §9.2, if step (3) fails AFTER the receipt was consumed, that's "paid +
// provider failure" — protocol-normal. We surface a clean 502 with a code so
// the Buyer Agent Worker can log it; the receipt is still spent.

import Fastify, { type FastifyInstance } from "fastify";
import {
  agentPay,
  type AgentPayPluginOptions,
} from "@agentpay/provider-middleware";
import type { Address, Hex } from "viem";
import { DeepSeekCopywriter, DeepSeekError } from "./llm.js";
import {
  InvokeRequestSchema,
  type InvokeResponse,
} from "./schema.js";

export interface CopywriterProviderOptions {
  agentPay: AgentPayPluginOptions;
  copywriter: DeepSeekCopywriter;
  logger?: boolean;
}

export async function buildCopywriterProvider(
  opts: CopywriterProviderOptions,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(agentPay, opts.agentPay);

  app.post<{ Body: unknown }>("/invoke", async (req, reply) => {
    const parsed = InvokeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      // Bad input: receipt was already consumed by the middleware, but the
      // request was structurally invalid. Per §9.2 this is still a "paid"
      // failure — return 400 (client's fault) and let the Worker decide
      // what to do.
      return reply
        .code(400)
        .send({
          error: "invalid_input",
          code: "COPYWRITER_INPUT_INVALID",
          detail: parsed.error.issues,
        });
    }

    try {
      const output = await opts.copywriter.generate(parsed.data.input);
      const response: InvokeResponse = { output };
      return response;
    } catch (err) {
      const code =
        err instanceof DeepSeekError ? err.code : "COPYWRITER_INTERNAL_ERROR";
      const message =
        err instanceof Error ? err.message : "copywriter failed";
      req.log.error({ code, message }, "copywriter generation failed");
      return reply.code(502).send({
        error: "provider_failure",
        code,
        // Don't leak DeepSeek auth or full response body — message is already
        // trimmed inside DeepSeekError.
        detail: message,
      });
    }
  });

  return app;
}

// ─── boot ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 4101);
  const marketplaceAddress = requireAddr("MARKETPLACE_ADDRESS");
  const providerAddress = requireAddr("PROVIDER_ADDRESS");
  const toolId = required("TOOL_ID");
  const priceWei = required("PRICE_WEI");
  const rpcUrl = required("CHAIN_RPC_URL");
  const privateKey = requireHex("PROVIDER_PK");
  const deepseekApiKey = required("DEEPSEEK_API_KEY");

  const copywriter = new DeepSeekCopywriter({
    apiKey: deepseekApiKey,
    baseUrl: process.env.DEEPSEEK_BASE_URL,
    model: process.env.DEEPSEEK_MODEL,
  });

  const app = await buildCopywriterProvider({
    agentPay: {
      marketplaceAddress,
      providerAddress,
      toolId,
      priceWei,
      rpcUrl,
      privateKey,
    },
    copywriter,
    logger: true,
  });

  await app.listen({ port, host: "0.0.0.0" });
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
function requireAddr(name: string): Address {
  const v = required(name);
  if (!v.startsWith("0x") || v.length !== 42) {
    throw new Error(`${name} must be a 0x-prefixed 20-byte address`);
  }
  return v as Address;
}
function requireHex(name: string): Hex {
  const v = required(name);
  if (!v.startsWith("0x")) throw new Error(`${name} must be 0x-prefixed`);
  return v as Hex;
}

const isDirectEntry = import.meta.url === `file://${process.argv[1]}`;
if (isDirectEntry) {
  void main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
