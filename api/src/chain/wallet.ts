/**
 * api/src/chain/wallet.ts
 *
 * Write-capable ChainClient — wraps a viem WalletClient + the Marketplace ABI
 * and implements the `ChainClient` interface consumed by the Buyer Agent
 * Worker (`api/src/worker/runTask.ts`).
 *
 * Design notes
 * ------------
 *  - The Worker calls four state-changing methods (`startTask`, `pay`,
 *    `completeTask`, `cancelTask`) plus one read recovery path
 *    (`reconcilePayTx`) used by the crash-resume flow in §10.2 of the design
 *    doc. Every write goes through `simulateContract` first so reverts surface
 *    as clean `Error`s instead of opaque RPC failures.
 *
 *  - Public read paths (`reconcilePayTx`, log decoding) reuse the existing
 *    `getPublicClient()` from `./client.js` so we share one transport+chain
 *    setup between the read-side watcher and the write-side worker.
 *
 *  - Env-driven config:
 *       CHAIN_RPC_URL         (required)  RPC endpoint — same one the watcher uses.
 *       OPERATOR_PK           (required)  0x-prefixed private key for the operator
 *                                         account. Signs every write below.
 *       MARKETPLACE_ADDRESS   (required)  Deployed Marketplace contract.
 *       CHAIN_ID              (optional)  Override viem chain inference; defaults
 *                                         to the chain returned by `getPublicClient`.
 *
 *    `makeChainClient()` throws a precise error if any required env is missing.
 */

import {
  ContractFunctionRevertedError,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  parseEventLogs,
  toBytes,
  type Abi,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MarketplaceAbi } from "./abi.js";
import { anvilLocal, getPublicClient, monadTestnet } from "./client.js";
import type {
  ChainClient,
  PayResult,
  ReconcileResult,
  StartTaskResult,
} from "../worker/chain.js";

// ── Options + env wiring ────────────────────────────────────────────────────

export interface WalletChainClientOptions {
  /** Required JSON-RPC URL. */
  rpcUrl: string;
  /** Operator private key (0x-prefixed, 32 bytes). */
  operatorPk: Hex;
  /** Marketplace contract address. */
  marketplaceAddress: Address;
  /** Optional numeric chain id override. Defaults to inferred-from-URL. */
  chainId?: number;
  /** Optional already-built PublicClient (tests inject this). */
  publicClient?: PublicClient;
}

const ANVIL_LOOPBACK = /127\.0\.0\.1|localhost|0\.0\.0\.0|::1/;

function chainFor(rpcUrl: string, chainId: number | undefined) {
  // Honour an explicit `CHAIN_ID` first, then fall back to URL inference. The
  // viem chain object only needs `id` + RPC for write semantics; tx params like
  // `gas` are filled in via eth_estimateGas at submit time.
  if (chainId !== undefined) {
    if (chainId === monadTestnet.id) return monadTestnet;
    if (chainId === anvilLocal.id) return anvilLocal;
    // Synthetic chain for any other id (forks, devnets). Keep the surface flat
    // so the WalletClient can sign and broadcast.
    return defineChain({
      id: chainId,
      name: `chain-${chainId}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    });
  }
  return ANVIL_LOOPBACK.test(rpcUrl) ? anvilLocal : monadTestnet;
}

// ── Event decoding helpers ──────────────────────────────────────────────────

interface TaskStartedArgs {
  taskId: Hex;
  agentId: bigint;
  promptHash: Hex;
}
interface ToolCallPaidArgs {
  receiptId: Hex;
  taskId: Hex;
  agentId: bigint;
  toolId: bigint;
  amount: bigint;
}

function findEvent<T>(
  logs: { args: unknown; eventName: string }[],
  name: string,
): T | null {
  for (const log of logs) {
    if (log.eventName === name) return log.args as T;
  }
  return null;
}

function unwrapRevert(err: unknown, label: string): Error {
  // viem wraps the revert reason inside `ContractFunctionRevertedError`; walk
  // the cause chain so we don't lose the message when it shows up nested in a
  // `ContractFunctionExecutionError`.
  if (err instanceof Error) {
    let cur: Error | undefined = err;
    while (cur) {
      if (cur instanceof ContractFunctionRevertedError) {
        const reason =
          cur.reason ?? cur.shortMessage ?? cur.message ?? "reverted";
        return new Error(`${label} reverted: ${reason}`);
      }
      cur = (cur as { cause?: Error }).cause;
    }
    return new Error(`${label} failed: ${err.message}`);
  }
  return new Error(`${label} failed: ${String(err)}`);
}

// ── ChainClient implementation ──────────────────────────────────────────────

export function createWalletChainClient(
  opts: WalletChainClientOptions,
): ChainClient {
  const chain = chainFor(opts.rpcUrl, opts.chainId);
  const account = privateKeyToAccount(opts.operatorPk);
  const wallet: WalletClient = createWalletClient({
    account,
    chain,
    transport: http(opts.rpcUrl),
  });
  const pub: PublicClient = opts.publicClient ?? getPublicClient();
  const address = opts.marketplaceAddress;
  const abi = MarketplaceAbi as Abi;

  async function simulateAndWrite<TArgs extends readonly unknown[]>(
    label: string,
    functionName: string,
    args: TArgs,
  ): Promise<Hash> {
    try {
      const { request } = await pub.simulateContract({
        account,
        address,
        abi,
        functionName,
        args,
      });
      // viem's writeContract on a WalletClient with a configured account
      // returns the tx hash directly.
      return await wallet.writeContract(request);
    } catch (err) {
      throw unwrapRevert(err, label);
    }
  }

  async function startTask({
    agentId,
    prompt,
  }: {
    agentId: string;
    prompt: string;
  }): Promise<StartTaskResult> {
    const promptHash = keccak256(toBytes(prompt));
    // 32-byte random salt — keeps taskId collisions away when two tasks share
    // (agentId, promptHash) within the same block.
    const salt = randomBytes32();
    const txHash = await simulateAndWrite("startTask", "startTask", [
      BigInt(agentId),
      promptHash,
      salt,
    ] as const);
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error("startTask: tx reverted on chain");
    }
    const decoded = parseEventLogs({
      abi,
      logs: receipt.logs,
      eventName: "TaskStarted",
    });
    const ev = findEvent<TaskStartedArgs>(
      decoded as { args: unknown; eventName: string }[],
      "TaskStarted",
    );
    if (!ev) {
      throw new Error("startTask: TaskStarted event missing from receipt");
    }
    return { onChainTaskId: ev.taskId, txHash };
  }

  async function pay(input: {
    onChainTaskId: Hex;
    toolId: string;
    toolVersion: number;
    expectedPriceWei: string;
    inputHash: Hex;
  }): Promise<PayResult> {
    const txHash = await simulateAndWrite("pay", "pay", [
      input.onChainTaskId,
      BigInt(input.toolId),
      BigInt(input.toolVersion),
      BigInt(input.expectedPriceWei),
      input.inputHash,
    ] as const);
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error("pay: tx reverted on chain");
    }
    const decoded = parseEventLogs({
      abi,
      logs: receipt.logs,
      eventName: "ToolCallPaid",
    });
    const ev = findEvent<ToolCallPaidArgs>(
      decoded as { args: unknown; eventName: string }[],
      "ToolCallPaid",
    );
    if (!ev) {
      throw new Error("pay: ToolCallPaid event missing from receipt");
    }
    // stepIdx is captured via agentStepCounter on chain. Marketplace doesn't
    // include it in the ToolCallPaid event topics today, so we re-read the
    // receipt to get the canonical value.
    const r = (await pub.readContract({
      address,
      abi,
      functionName: "getReceipt",
      args: [ev.receiptId],
    })) as { stepIdx: number };
    return {
      receiptId: ev.receiptId,
      stepIdx: Number(r.stepIdx),
      txHash,
    };
  }

  async function completeTask(input: {
    onChainTaskId: Hex;
    resultHash: Hex;
  }): Promise<{ txHash: Hex }> {
    const txHash = await simulateAndWrite("completeTask", "completeTask", [
      input.onChainTaskId,
      input.resultHash,
    ] as const);
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error("completeTask: tx reverted on chain");
    }
    return { txHash };
  }

  async function cancelTask(input: {
    onChainTaskId: Hex;
  }): Promise<{ txHash: Hex }> {
    const txHash = await simulateAndWrite("cancelTask", "cancelTask", [
      input.onChainTaskId,
    ] as const);
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error("cancelTask: tx reverted on chain");
    }
    return { txHash };
  }

  async function reconcilePayTx(txHash: Hex): Promise<ReconcileResult> {
    // Two possibilities:
    //   1. tx not yet mined → getTransactionReceipt returns null / throws.
    //   2. tx mined → status is "success" or "reverted".
    let receipt;
    try {
      receipt = await pub.getTransactionReceipt({ hash: txHash });
    } catch {
      receipt = null;
    }
    if (!receipt) return { confirmed: false };
    if (receipt.status === "reverted") {
      return { confirmed: true, reverted: true };
    }
    const decoded = parseEventLogs({
      abi,
      logs: receipt.logs,
      eventName: "ToolCallPaid",
    });
    const ev = findEvent<ToolCallPaidArgs>(
      decoded as { args: unknown; eventName: string }[],
      "ToolCallPaid",
    );
    if (!ev) {
      // The tx was confirmed but didn't emit ToolCallPaid — treat as reverted
      // for the Worker's purposes (it can't continue without a receipt).
      return { confirmed: true, reverted: true };
    }
    const r = (await pub.readContract({
      address,
      abi,
      functionName: "getReceipt",
      args: [ev.receiptId],
    })) as { stepIdx: number };
    return {
      confirmed: true,
      reverted: false,
      receiptId: ev.receiptId,
      stepIdx: Number(r.stepIdx),
    };
  }

  return {
    startTask,
    pay,
    completeTask,
    cancelTask,
    reconcilePayTx,
  } as ChainClient & {
    cancelTask: (i: { onChainTaskId: Hex }) => Promise<{ txHash: Hex }>;
  };
}

// ── Factory + helpers ───────────────────────────────────────────────────────

function randomBytes32(): Hex {
  const buf = new Uint8Array(32);
  // Node crypto.getRandomValues is on global.crypto in Node 20+.
  globalThis.crypto.getRandomValues(buf);
  let out = "0x";
  for (const b of buf) out += b.toString(16).padStart(2, "0");
  return out as Hex;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(
      `[chain/wallet] required env var ${name} is missing; cannot build ChainClient`,
    );
  }
  return value;
}

/** Build a `ChainClient` from `process.env`. Throws on missing required vars. */
export function makeChainClient(): ChainClient {
  const rpcUrl = requireEnv("CHAIN_RPC_URL");
  const operatorPk = requireEnv("OPERATOR_PK") as Hex;
  if (!operatorPk.startsWith("0x") || operatorPk.length !== 66) {
    throw new Error(
      "[chain/wallet] OPERATOR_PK must be a 0x-prefixed 32-byte hex string",
    );
  }
  const marketplaceAddress = requireEnv("MARKETPLACE_ADDRESS") as Address;
  const chainIdRaw = process.env.CHAIN_ID;
  const chainId =
    chainIdRaw && /^\d+$/.test(chainIdRaw) ? Number(chainIdRaw) : undefined;

  return createWalletChainClient({
    rpcUrl,
    operatorPk,
    marketplaceAddress,
    chainId,
  });
}
