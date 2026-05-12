// End-to-end tests for @agentpay/provider-middleware via Fastify's app.inject().
// Viem is fully mocked through the ViemBundle injection point, so these tests
// hit zero network.

import Fastify from "fastify";
import { keccak256, type Hex, type Address } from "viem";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  AGENTPAY_HEADERS,
  agentPay,
  type AgentPayPluginOptions,
  type ViemBundle,
} from "../src/index.js";

const MARKETPLACE = "0x000000000000000000000000000000000000beef" as Address;
const PROVIDER = "0x0000000000000000000000000000000000001234" as Address;
const TOOL_ID = "42";

const RECEIPT: Hex = `0x${"ab".repeat(32)}` as Hex;
const BAD_RECEIPT: Hex = `0x${"00".repeat(32)}` as Hex;

interface MockState {
  shouldReturnFalse: boolean;
  shouldRevert: string | null;
  simulateCalls: number;
  writeCalls: number;
}

function makeMockBundle(state: MockState): ViemBundle {
  return {
    account: PROVIDER,
    publicClient: {
      simulateContract: vi.fn(async (_args: unknown) => {
        state.simulateCalls += 1;
        if (state.shouldRevert) {
          throw new Error(state.shouldRevert);
        }
        return {
          result: state.shouldReturnFalse ? false : true,
          request: {
            address: MARKETPLACE,
            abi: [],
            functionName: "verifyAndConsumeReceipt",
            args: [],
            account: PROVIDER,
          },
        };
      }) as unknown as ViemBundle["publicClient"]["simulateContract"],
      waitForTransactionReceipt: vi.fn(async (_args: unknown) => ({
        status: "success" as const,
      })) as unknown as ViemBundle["publicClient"]["waitForTransactionReceipt"],
    },
    walletClient: {
      writeContract: vi.fn(async (_args: unknown) => {
        state.writeCalls += 1;
        return ("0x" + "cd".repeat(32)) as Hex;
      }) as unknown as ViemBundle["walletClient"]["writeContract"],
    },
  };
}

function bodyHash(obj: unknown): Hex {
  const canonical = JSON.stringify(obj);
  const bytes = `0x${Buffer.from(canonical, "utf8").toString("hex")}` as Hex;
  return keccak256(bytes);
}

async function buildAppWith(opts: Partial<AgentPayPluginOptions>, state: MockState) {
  const app = Fastify({ logger: false });
  await app.register(agentPay, {
    marketplaceAddress: MARKETPLACE,
    providerAddress: PROVIDER,
    toolId: TOOL_ID,
    priceWei: "1000000000000000",
    viem: makeMockBundle(state),
    logger: { warn: () => {} },
    ...opts,
  });
  app.post("/invoke", async (req) => ({
    ctx: req.agentPay,
    echo: req.body,
  }));
  await app.ready();
  return app;
}

describe("@agentpay/provider-middleware", () => {
  let state: MockState;

  beforeEach(() => {
    state = {
      shouldReturnFalse: false,
      shouldRevert: null,
      simulateCalls: 0,
      writeCalls: 0,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("happy path passes through and attaches req.agentPay", async () => {
    const app = await buildAppWith({}, state);
    const body = { input: { foo: "bar", n: 7 } };
    const hash = bodyHash(body);

    const res = await app.inject({
      method: "POST",
      url: "/invoke",
      headers: {
        "content-type": "application/json",
        [AGENTPAY_HEADERS.receipt]: RECEIPT,
        [AGENTPAY_HEADERS.agentId]: "1",
        [AGENTPAY_HEADERS.toolId]: TOOL_ID,
        [AGENTPAY_HEADERS.step]: "3",
        [AGENTPAY_HEADERS.inputHash]: hash,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    const parsed = res.json() as {
      ctx: { receiptId: string; stepIdx: number; toolId: string };
      echo: unknown;
    };
    expect(parsed.ctx.receiptId).toBe(RECEIPT);
    expect(parsed.ctx.stepIdx).toBe(3);
    expect(parsed.ctx.toolId).toBe(TOOL_ID);
    expect(parsed.echo).toEqual(body);
    expect(state.simulateCalls).toBe(1);
    expect(state.writeCalls).toBe(1);

    await app.close();
  });

  test("missing X-AgentPay-Receipt → 402 with WWW-Authenticate", async () => {
    const app = await buildAppWith({}, state);
    const body = { input: { foo: "bar" } };
    const hash = bodyHash(body);
    const res = await app.inject({
      method: "POST",
      url: "/invoke",
      headers: {
        "content-type": "application/json",
        [AGENTPAY_HEADERS.agentId]: "1",
        [AGENTPAY_HEADERS.toolId]: TOOL_ID,
        [AGENTPAY_HEADERS.step]: "1",
        [AGENTPAY_HEADERS.inputHash]: hash,
      },
      payload: body,
    });
    expect(res.statusCode).toBe(402);
    expect(res.headers["www-authenticate"]).toMatch(/^AgentPay tool=42 price=/);
    expect(state.simulateCalls).toBe(0);
    await app.close();
  });

  test("inputHash mismatch → 402 (chain never called)", async () => {
    const app = await buildAppWith({}, state);
    const body = { input: { foo: "bar" } };
    const res = await app.inject({
      method: "POST",
      url: "/invoke",
      headers: {
        "content-type": "application/json",
        [AGENTPAY_HEADERS.receipt]: RECEIPT,
        [AGENTPAY_HEADERS.agentId]: "1",
        [AGENTPAY_HEADERS.toolId]: TOOL_ID,
        [AGENTPAY_HEADERS.step]: "1",
        // wrong hash (of a different object)
        [AGENTPAY_HEADERS.inputHash]: bodyHash({ different: true }),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(402);
    expect(state.simulateCalls).toBe(0);
    expect(state.writeCalls).toBe(0);
    await app.close();
  });

  test("verifyAndConsume reverts → 402 (no write attempted)", async () => {
    state.shouldRevert = "receipt already consumed";
    const app = await buildAppWith({}, state);
    const body = { input: { foo: "bar" } };
    const hash = bodyHash(body);
    const res = await app.inject({
      method: "POST",
      url: "/invoke",
      headers: {
        "content-type": "application/json",
        [AGENTPAY_HEADERS.receipt]: BAD_RECEIPT,
        [AGENTPAY_HEADERS.agentId]: "1",
        [AGENTPAY_HEADERS.toolId]: TOOL_ID,
        [AGENTPAY_HEADERS.step]: "1",
        [AGENTPAY_HEADERS.inputHash]: hash,
      },
      payload: body,
    });
    expect(res.statusCode).toBe(402);
    expect(state.simulateCalls).toBe(1);
    expect(state.writeCalls).toBe(0);
    await app.close();
  });

  test("simulate returns false (non-provider caller modelled) → 402", async () => {
    state.shouldReturnFalse = true;
    const app = await buildAppWith({}, state);
    const body = { input: { foo: "bar" } };
    const hash = bodyHash(body);
    const res = await app.inject({
      method: "POST",
      url: "/invoke",
      headers: {
        "content-type": "application/json",
        [AGENTPAY_HEADERS.receipt]: RECEIPT,
        [AGENTPAY_HEADERS.agentId]: "1",
        [AGENTPAY_HEADERS.toolId]: TOOL_ID,
        [AGENTPAY_HEADERS.step]: "1",
        [AGENTPAY_HEADERS.inputHash]: hash,
      },
      payload: body,
    });
    expect(res.statusCode).toBe(402);
    expect(state.writeCalls).toBe(0);
    await app.close();
  });

  test("toolId header mismatching plugin config → 402", async () => {
    const app = await buildAppWith({}, state);
    const body = { input: { foo: "bar" } };
    const hash = bodyHash(body);
    const res = await app.inject({
      method: "POST",
      url: "/invoke",
      headers: {
        "content-type": "application/json",
        [AGENTPAY_HEADERS.receipt]: RECEIPT,
        [AGENTPAY_HEADERS.agentId]: "1",
        [AGENTPAY_HEADERS.toolId]: "999",
        [AGENTPAY_HEADERS.step]: "1",
        [AGENTPAY_HEADERS.inputHash]: hash,
      },
      payload: body,
    });
    expect(res.statusCode).toBe(402);
    expect(state.simulateCalls).toBe(0);
    await app.close();
  });
});
