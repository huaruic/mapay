// Public types for @agentpay/provider-middleware.
//
// We keep this file dependency-light so consumers can import the types without
// pulling in viem types when they only need to reference req.agentPay shape.

import type { Address, Hex, PublicClient, WalletClient } from "viem";

/** Five protocol headers sent on every Worker → Provider request (§9). */
export const AGENTPAY_HEADERS = {
  receipt: "x-agentpay-receipt",
  agentId: "x-agentpay-agent-id",
  toolId: "x-agentpay-tool-id",
  step: "x-agentpay-step",
  inputHash: "x-agentpay-input-hash",
} as const;

/** Decoded agentpay metadata attached to the FastifyRequest after middleware passes. */
export interface AgentPayRequestContext {
  receiptId: Hex;
  agentId: string;
  toolId: string;
  stepIdx: number;
  inputHash: Hex;
}

/** Minimal viem-shaped surface the plugin needs. Lets tests inject a mock. */
export interface ViemBundle {
  publicClient: Pick<PublicClient, "simulateContract" | "waitForTransactionReceipt">;
  walletClient: Pick<WalletClient, "writeContract">;
  /** Address of the wallet that's authorised as Tool.provider on the Marketplace. */
  account: Address;
}

/** Configuration for the `agentPay` Fastify plugin. */
export interface AgentPayPluginOptions {
  /** Deployed Marketplace.sol address. */
  marketplaceAddress: Address;
  /** This provider's wallet address — must match Tool.provider for `toolId`. */
  providerAddress: Address;
  /** Tool id this server fronts (uint, decimal string). */
  toolId: bigint | string | number;
  /** Per-call price in wei — surfaced in 402 WWW-Authenticate header. */
  priceWei: bigint | string;
  /** Either a JSON-RPC URL (plugin builds viem clients) or a pre-built ViemBundle (tests). */
  rpcUrl?: string;
  /** Hex private key for the provider account. Required when rpcUrl is given. */
  privateKey?: Hex;
  /** Override the viem clients entirely (e.g. for mocks in vitest). */
  viem?: ViemBundle;
  /** Custom logger. Defaults to console. */
  logger?: { warn: (msg: string, meta?: unknown) => void };
}

// Augment FastifyRequest so consumers see `req.agentPay`.
declare module "fastify" {
  interface FastifyRequest {
    agentPay?: AgentPayRequestContext;
  }
}
