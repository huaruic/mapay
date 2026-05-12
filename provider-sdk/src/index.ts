// @agentpay/provider-middleware
// ---------------------------------------------------------------------------
// Fastify plugin that turns any HTTP endpoint into an AgentPay-compatible
// provider tool.  On every request:
//
//   1. Read the 5 protocol headers (§9).
//   2. Re-hash the raw body with keccak256 and compare to X-AgentPay-Input-Hash.
//   3. Atomically Marketplace.verifyAndConsumeReceipt(receiptId, inputHash) by
//      sending a state-changing tx as the provider's signer.
//   4. On success: attach `req.agentPay = { ... }` and pass through.
//   5. On any failure: reply 402 with WWW-Authenticate per §9 fallback.
//
// The plugin only deals with the *gate*. Once it passes, the consumer's
// handler runs as normal and is responsible for the actual tool work.

import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  createPublicClient,
  createWalletClient,
  http,
  isHex,
  keccak256,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { marketplaceAbi } from "./abi.js";
import {
  AGENTPAY_HEADERS,
  type AgentPayPluginOptions,
  type AgentPayRequestContext,
  type ViemBundle,
} from "./types.js";

export type {
  AgentPayPluginOptions,
  AgentPayRequestContext,
  ViemBundle,
} from "./types.js";
export { AGENTPAY_HEADERS } from "./types.js";

interface NormalizedHeaders {
  receiptId: Hex;
  agentId: string;
  toolId: string;
  stepIdx: number;
  inputHash: Hex;
}

const HEX32_RE = /^0x[0-9a-fA-F]{64}$/;

/** Build the Fastify `WWW-Authenticate` per §9.2 fallback. */
function wwwAuth(toolId: string | number | bigint, priceWei: string): string {
  return `AgentPay tool=${String(toolId)} price=${priceWei}`;
}

function readHeader(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

function normalizeHeaders(req: FastifyRequest): NormalizedHeaders | string {
  const receiptId = readHeader(req, AGENTPAY_HEADERS.receipt);
  const agentId = readHeader(req, AGENTPAY_HEADERS.agentId);
  const toolId = readHeader(req, AGENTPAY_HEADERS.toolId);
  const stepStr = readHeader(req, AGENTPAY_HEADERS.step);
  const inputHash = readHeader(req, AGENTPAY_HEADERS.inputHash);

  if (!receiptId || !agentId || !toolId || !stepStr || !inputHash) {
    return "missing required AgentPay header";
  }
  if (!HEX32_RE.test(receiptId)) return "X-AgentPay-Receipt must be 32-byte hex";
  if (!HEX32_RE.test(inputHash)) return "X-AgentPay-Input-Hash must be 32-byte hex";
  const stepIdx = Number.parseInt(stepStr, 10);
  if (!Number.isFinite(stepIdx) || stepIdx <= 0) {
    return "X-AgentPay-Step must be a positive integer";
  }

  return {
    receiptId: receiptId as Hex,
    agentId,
    toolId,
    stepIdx,
    inputHash: inputHash as Hex,
  };
}

/** Body → keccak256. Handles Buffer, string, parsed-JSON, undefined. */
function hashBody(rawBody: unknown, fallback: unknown): Hex {
  // Prefer the rawBody Fastify keeps when contentTypeParser hasn't replaced it.
  let bytes: Hex | undefined;
  if (rawBody instanceof Buffer) {
    bytes = `0x${rawBody.toString("hex")}` as Hex;
  } else if (typeof rawBody === "string") {
    bytes = `0x${Buffer.from(rawBody, "utf8").toString("hex")}` as Hex;
  } else {
    // Reconstruct canonical JSON from parsed body. Worker side MUST produce
    // its inputHash using the same canonical form (JSON.stringify on the
    // exact object that gets wire-shipped).
    const canonical = JSON.stringify(fallback ?? {});
    bytes = `0x${Buffer.from(canonical, "utf8").toString("hex")}` as Hex;
  }
  return keccak256(bytes);
}

function buildViemBundleFromConfig(
  opts: AgentPayPluginOptions,
): ViemBundle {
  if (opts.viem) return opts.viem;
  if (!opts.rpcUrl) {
    throw new Error("agentPay plugin: opts.rpcUrl or opts.viem must be provided");
  }
  if (!opts.privateKey) {
    throw new Error(
      "agentPay plugin: opts.privateKey is required when opts.rpcUrl is used",
    );
  }
  if (!isHex(opts.privateKey)) {
    throw new Error("agentPay plugin: opts.privateKey must be 0x-prefixed hex");
  }
  const account = privateKeyToAccount(opts.privateKey);
  const transport = http(opts.rpcUrl);
  const publicClient = createPublicClient({ transport });
  const walletClient = createWalletClient({ account, transport });
  return {
    publicClient,
    walletClient,
    account: account.address,
  };
}

const pluginImpl: FastifyPluginAsync<AgentPayPluginOptions> = async (
  app,
  opts,
) => {
  const log = opts.logger ?? {
    warn: (msg: string, meta?: unknown) =>
      app.log.warn({ meta }, `[agentpay] ${msg}`),
  };
  const bundle = buildViemBundleFromConfig(opts);
  const priceWei = String(opts.priceWei);
  const toolIdStr = String(opts.toolId);

  // Make sure Fastify gives us the raw body so we can hash it. This is the
  // simplest config that works for both JSON bodies and arbitrary content
  // types; we attach a Buffer copy on the request.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (_req, body, done) => {
      try {
        if (!Buffer.isBuffer(body) || body.length === 0) {
          done(null, {});
          return;
        }
        const parsed = JSON.parse(body.toString("utf8")) as unknown;
        // Stash the raw bytes; the hook reads them.
        (_req as FastifyRequest & { rawBody?: Buffer }).rawBody = body;
        done(null, parsed);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  const reject = (reply: FastifyReply, reason: string, status = 402) => {
    log.warn(`request rejected: ${reason}`);
    reply
      .code(status)
      .header("www-authenticate", wwwAuth(toolIdStr, priceWei))
      .send({ error: "agentpay_rejected", reason });
  };

  app.addHook("preHandler", async (req, reply) => {
    const headerCheck = normalizeHeaders(req);
    if (typeof headerCheck === "string") {
      return reject(reply, headerCheck);
    }
    const headers = headerCheck;

    // 1. Verify input hash matches raw body.
    const raw = (req as FastifyRequest & { rawBody?: Buffer }).rawBody;
    const computed = hashBody(raw, req.body);
    if (computed.toLowerCase() !== headers.inputHash.toLowerCase()) {
      return reject(reply, "input hash mismatch");
    }

    // Defensive check: only this provider's toolId is served by this plugin.
    if (headers.toolId !== toolIdStr) {
      return reject(reply, "tool id mismatch for this endpoint");
    }

    // 2. Atomically verify+consume the receipt on chain. Must be a real tx
    //    because the function is state-changing (sets receipt.consumed = true).
    try {
      // simulateContract returns the call result without state, lets us trap
      // reverts before we burn a tx slot. The actual consume happens via
      // writeContract below.
      const sim = await bundle.publicClient.simulateContract({
        address: opts.marketplaceAddress,
        abi: marketplaceAbi,
        functionName: "verifyAndConsumeReceipt",
        args: [headers.receiptId, headers.inputHash],
        account: bundle.account,
      });
      if (sim.result !== true) {
        return reject(reply, "verifyAndConsumeReceipt returned false");
      }

      const txHash = await bundle.walletClient.writeContract({
        ...sim.request,
        account: bundle.account,
        chain: null,
      } as Parameters<typeof bundle.walletClient.writeContract>[0]);

      // Wait until the tx is mined so we don't return success before consume
      // actually happens. In high-throughput production you'd skip this and
      // rely on the simulate guarantee, but MVP wants the strong invariant.
      await bundle.publicClient.waitForTransactionReceipt({ hash: txHash });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "verifyAndConsumeReceipt failed";
      return reject(reply, msg);
    }

    // 3. Attach decoded context for handlers.
    const ctx: AgentPayRequestContext = {
      receiptId: headers.receiptId,
      agentId: headers.agentId,
      toolId: headers.toolId,
      stepIdx: headers.stepIdx,
      inputHash: headers.inputHash,
    };
    req.agentPay = ctx;
  });
};

/** Fastify plugin: `app.register(agentPay, { ... })`. */
export const agentPay = fp(pluginImpl, {
  name: "@agentpay/provider-middleware",
  fastify: "5.x",
});

export default agentPay;
