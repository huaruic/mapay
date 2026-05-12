// Integration test: boot the real Fastify server in-process via app.inject(),
// fake the on-chain receipt verification via a stub ViemBundle, fake the
// DeepSeek fetch with a canned response, and assert the wire format.

import { describe, expect, test, vi } from "vitest";
import { keccak256, toHex, type Address, type Hex } from "viem";
import type { ViemBundle } from "@agentpay/provider-middleware";
import { buildCopywriterProvider } from "../src/server.js";
import { DeepSeekCopywriter } from "../src/llm.js";

const MARKETPLACE = "0x000000000000000000000000000000000000beef" as Address;
const PROVIDER = "0x0000000000000000000000000000000000001234" as Address;
const TOOL_ID = "7";

function makeViemBundle(): ViemBundle {
  return {
    account: PROVIDER,
    publicClient: {
      // Always returns ok = true, so the middleware passes.
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
        async () => ("0x" + "ab".repeat(32)) as Hex,
      ) as unknown as ViemBundle["walletClient"]["writeContract"],
    },
  };
}

function makeMockFetch(content: object) {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: { role: "assistant", content: JSON.stringify(content) },
            finish_reason: "stop",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  ) as unknown as typeof fetch;
}

describe("copywriter provider — integration", () => {
  test("paid request: 5 headers + valid body → 200 with 3 tweets", async () => {
    const fakeDeepSeek = makeMockFetch({
      tweets: [
        "Ship faster with onchain agents — they pay their own bills",
        "Stop babysitting agents. Give them a wallet + a guardrail",
        "AgentPay: budgets that the smart contract enforces, not vibes",
      ],
      suggestedHashtags: ["AgentPay", "AI", "crypto"],
    });
    const copywriter = new DeepSeekCopywriter({
      apiKey: "sk-test",
      fetchImpl: fakeDeepSeek,
    });

    const app = await buildCopywriterProvider({
      agentPay: {
        marketplaceAddress: MARKETPLACE,
        providerAddress: PROVIDER,
        toolId: TOOL_ID,
        priceWei: "30000000000000000",
        viem: makeViemBundle(),
        logger: { warn: () => {} },
      },
      copywriter,
    });
    await app.ready();

    // Canonical body (must match exactly what we hash).
    const body = {
      input: { topic: "AgentPay launch", tone: "hype", count: 3 },
    };
    const rawBody = JSON.stringify(body);
    const inputHash = keccak256(toHex(rawBody));

    const res = await app.inject({
      method: "POST",
      url: "/invoke",
      headers: {
        "content-type": "application/json",
        "x-agentpay-receipt": "0x" + "11".repeat(32),
        "x-agentpay-agent-id": "42",
        "x-agentpay-tool-id": TOOL_ID,
        "x-agentpay-step": "1",
        "x-agentpay-input-hash": inputHash,
      },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);
    const json = res.json() as {
      output: { tweets: string[]; suggestedHashtags: string[] };
    };
    expect(json.output.tweets).toHaveLength(3);
    for (const t of json.output.tweets) {
      expect(t.length).toBeLessThanOrEqual(140);
    }
    expect(json.output.suggestedHashtags.length).toBeGreaterThan(0);
    expect(fakeDeepSeek).toHaveBeenCalledOnce();

    await app.close();
  });

  test("missing headers → 402 (receipt gate fires before DeepSeek)", async () => {
    const fakeDeepSeek = makeMockFetch({
      tweets: ["should never be sent"],
      suggestedHashtags: [],
    });
    const copywriter = new DeepSeekCopywriter({
      apiKey: "sk-test",
      fetchImpl: fakeDeepSeek,
    });

    const app = await buildCopywriterProvider({
      agentPay: {
        marketplaceAddress: MARKETPLACE,
        providerAddress: PROVIDER,
        toolId: TOOL_ID,
        priceWei: "30000000000000000",
        viem: makeViemBundle(),
        logger: { warn: () => {} },
      },
      copywriter,
    });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/invoke",
      headers: { "content-type": "application/json" },
      payload: { input: { topic: "x", tone: "casual", count: 1 } },
    });
    expect(res.statusCode).toBe(402);
    expect(res.headers["www-authenticate"]).toMatch(
      new RegExp(`^AgentPay tool=${TOOL_ID} price=`),
    );
    // Critically: DeepSeek must NOT have been called — quota guard.
    expect(fakeDeepSeek).not.toHaveBeenCalled();

    await app.close();
  });

  test("paid but DeepSeek 500s → 502 with provider_failure code", async () => {
    const fakeDeepSeek = vi.fn(async () =>
      new Response("upstream broken", { status: 500 }),
    ) as unknown as typeof fetch;
    const copywriter = new DeepSeekCopywriter({
      apiKey: "sk-test",
      fetchImpl: fakeDeepSeek,
    });

    const app = await buildCopywriterProvider({
      agentPay: {
        marketplaceAddress: MARKETPLACE,
        providerAddress: PROVIDER,
        toolId: TOOL_ID,
        priceWei: "30000000000000000",
        viem: makeViemBundle(),
        logger: { warn: () => {} },
      },
      copywriter,
    });
    await app.ready();

    const body = {
      input: { topic: "anything", tone: "professional", count: 2 },
    };
    const rawBody = JSON.stringify(body);
    const inputHash = keccak256(toHex(rawBody));

    const res = await app.inject({
      method: "POST",
      url: "/invoke",
      headers: {
        "content-type": "application/json",
        "x-agentpay-receipt": "0x" + "22".repeat(32),
        "x-agentpay-agent-id": "1",
        "x-agentpay-tool-id": TOOL_ID,
        "x-agentpay-step": "1",
        "x-agentpay-input-hash": inputHash,
      },
      payload: rawBody,
    });
    expect(res.statusCode).toBe(502);
    const j = res.json() as { error: string; code: string };
    expect(j.error).toBe("provider_failure");
    expect(j.code).toBe("DEEPSEEK_HTTP_ERROR");

    await app.close();
  });
});
