// Echo provider service — reference impl of an AgentPay-aware tool.
//
// Reads config from env, registers @agentpay/provider-middleware as a
// preHandler, then exposes POST /invoke which simply echoes back the payload.
// Useful as the "first tool" in the Worker pipeline integration test.

import Fastify, { type FastifyInstance } from "fastify";
import {
  agentPay,
  type AgentPayPluginOptions,
} from "@agentpay/provider-middleware";
import type { Address, Hex } from "viem";

export interface EchoProviderOptions {
  agentPay: AgentPayPluginOptions;
  logger?: boolean;
}

export async function buildEchoProvider(
  opts: EchoProviderOptions,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(agentPay, opts.agentPay);

  app.post<{ Body: { input?: unknown } }>(
    "/invoke",
    async (req, _reply) => {
      const input = req.body?.input ?? null;
      return { output: { echo: input } };
    },
  );

  return app;
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 4100);
  const marketplaceAddress = requireAddr("MARKETPLACE_ADDRESS");
  const providerAddress = requireAddr("PROVIDER_ADDRESS");
  const toolId = required("TOOL_ID");
  const priceWei = required("PRICE_WEI");
  const rpcUrl = required("RPC_URL");
  const privateKey = requireHex("PROVIDER_PRIVATE_KEY");

  const app = await buildEchoProvider({
    agentPay: {
      marketplaceAddress,
      providerAddress,
      toolId,
      priceWei,
      rpcUrl,
      privateKey,
    },
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
