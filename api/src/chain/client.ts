/**
 * api/src/chain/client.ts
 *
 * viem PublicClient for the AgentPay backend.
 *
 * RPC URL resolution (first non-empty wins):
 *   1. `CHAIN_RPC_URL`        — overrides everything; used for local Anvil
 *      (`http://127.0.0.1:8545`). Setting this also flips the chain to a
 *      local `Foundry`-style chain id (31337) when the URL is loopback.
 *   2. `MONAD_TESTNET_RPC_URL` — Monad public RPC by default.
 *
 * We don't import `monadTestnet` from `lib/chains.ts` because the API's
 * `tsconfig.rootDir` is `src/`. The chain spec here mirrors that file and
 * stays minimal; viem only needs `id` + RPC for `getLogs` / `watchContractEvent`.
 */
import { createPublicClient, defineChain, http, type PublicClient } from "viem";

/** Mirror of `lib/chains.ts#monadTestnet`. Kept inline so the API stays
 *  self-contained (see file header). */
export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.monad.xyz"] },
  },
  testnet: true,
});

/** Local Anvil chain (Foundry defaults). Used when `CHAIN_RPC_URL` points at
 *  a loopback address. */
export const anvilLocal = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["http://127.0.0.1:8545"] },
  },
  testnet: true,
});

function isLoopback(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname === "127.0.0.1" ||
      u.hostname === "localhost" ||
      u.hostname === "0.0.0.0" ||
      u.hostname === "::1"
    );
  } catch {
    return false;
  }
}

export function resolveRpcUrl(): string {
  const override = process.env.CHAIN_RPC_URL;
  if (override && override.length > 0) return override;
  const monad = process.env.MONAD_TESTNET_RPC_URL;
  if (monad && monad.length > 0) return monad;
  return "https://rpc.testnet.monad.xyz";
}

export function makePublicClient(): PublicClient {
  const url = resolveRpcUrl();
  const chain = isLoopback(url) ? anvilLocal : monadTestnet;
  return createPublicClient({
    chain,
    transport: http(url),
  });
}

/** Cached singleton. Routes and the watcher share one client. */
let _client: PublicClient | null = null;
export function getPublicClient(): PublicClient {
  if (_client === null) {
    _client = makePublicClient();
  }
  return _client;
}

/** Test seam: drop the cached client so the next call rebuilds it. Useful
 *  when tests mutate `process.env.CHAIN_RPC_URL`. */
export function resetPublicClientForTesting(): void {
  _client = null;
}
