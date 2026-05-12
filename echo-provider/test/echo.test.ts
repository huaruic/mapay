// Smoke test: the wired plugin returns 402 without proper headers and includes
// a WWW-Authenticate hint so an AgentPay-aware client can negotiate.

import { describe, expect, test, vi } from "vitest";
import type { Address, Hex } from "viem";
import { buildEchoProvider } from "../src/server.js";
import type { ViemBundle } from "@agentpay/provider-middleware";

const MARKETPLACE = "0x000000000000000000000000000000000000beef" as Address;
const PROVIDER = "0x0000000000000000000000000000000000001234" as Address;

function makeBundle(): ViemBundle {
  return {
    account: PROVIDER,
    publicClient: {
      simulateContract: vi.fn(async () => ({
        result: true,
        request: {} as unknown,
      })) as unknown as ViemBundle["publicClient"]["simulateContract"],
      waitForTransactionReceipt: vi.fn(async () => ({
        status: "success" as const,
      })) as unknown as ViemBundle["publicClient"]["waitForTransactionReceipt"],
    },
    walletClient: {
      writeContract: vi.fn(
        async () => ("0x" + "cd".repeat(32)) as Hex,
      ) as unknown as ViemBundle["walletClient"]["writeContract"],
    },
  };
}

describe("echo-provider", () => {
  test("POST /invoke without AgentPay headers → 402 + WWW-Authenticate", async () => {
    const app = await buildEchoProvider({
      agentPay: {
        marketplaceAddress: MARKETPLACE,
        providerAddress: PROVIDER,
        toolId: "1",
        priceWei: "1000000000000000",
        viem: makeBundle(),
        logger: { warn: () => {} },
      },
    });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/invoke",
      headers: { "content-type": "application/json" },
      payload: { input: { hello: "world" } },
    });
    expect(res.statusCode).toBe(402);
    expect(res.headers["www-authenticate"]).toMatch(/^AgentPay tool=1 price=/);

    await app.close();
  });
});
