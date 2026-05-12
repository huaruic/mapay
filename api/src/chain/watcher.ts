// INTEGRATION: add to server.ts after app.listen():
//   if (process.env.MARKETPLACE_ADDRESS) await startWatcher({ marketplaceAddress: process.env.MARKETPLACE_ADDRESS as `0x${string}`, fromBlock: 0n });
//
// api/src/chain/watcher.ts
//
// Marketplace event watcher (design doc §6.1):
//   1. Backfill via eth_getLogs from `fromBlock` → `currentBlock - finalityDepth`
//   2. Idempotent upsert keyed by (txHash, logIndex)
//   3. Live tail via viem watchContractEvent
//   4. Exposes a synchronous in-memory cache (`getCachedTools`, `getCachedTool`)
//      that routes query — real DB integration is deferred (see §6.3 schema).
//
// Reorgs are documented in the design doc but are not implemented in this
// in-memory cache: a reorg would require resetting + replaying from the last
// finalized block. The Postgres-backed cursor + chain_cursor table is the
// proper home for that logic; rebuilding it here would be premature.

import type {
  Abi,
  Address,
  Log,
  PublicClient,
} from "viem";
import { decodeEventLog } from "viem";
import { getPublicClient } from "./client.js";
import { MarketplaceAbi } from "./abi.js";

// ── Cached row shape — wire-compatible with mock-tools.ts ───────────────────

export type CachedTool = {
  id: string;
  provider: `0x${string}`;
  name: string;
  description: string;
  priceWei: string;
  priceDisplay: string;
  version: number;
  schemaHash: `0x${string}`;
  endpoint: string;
  enabled: boolean;
  // Aggregates not (yet) tracked from events. The watcher keeps these zero
  // until call accounting is wired up — frontend renders "—" when null.
  calls: number;
  rating: number | null;
};

// ── Module state ────────────────────────────────────────────────────────────

const toolCache = new Map<string, CachedTool>();
const seenLogs = new Set<string>(); // dedup key = `${txHash}:${logIndex}`
let unwatch: (() => void) | null = null;
let started = false;
let lastSyncedBlock = 0n;

/** Default Monad finality buffer. Design doc §6.1 step 5 says "use 5 blocks"
 *  until we can measure real finality. Local Anvil mines instantly so a 5-block
 *  buffer effectively means "all blocks visible to backfill". */
const DEFAULT_FINALITY_DEPTH = 5n;

// ── Public surface ──────────────────────────────────────────────────────────

export type StartWatcherOpts = {
  marketplaceAddress: Address;
  fromBlock: bigint;
  /** Override for tests; default uses the cached singleton. */
  client?: PublicClient;
  /** Override the per-batch reorg-buffer depth. */
  finalityDepth?: bigint;
  /** When true, skip the live `watchContractEvent` subscription (tests use this). */
  skipLiveTail?: boolean;
};

/**
 * Boot the watcher. Idempotent — if already started, returns immediately.
 *
 * Backfills synchronously before returning so callers can rely on the cache
 * being warm after `await startWatcher(...)`.
 */
export async function startWatcher(opts: StartWatcherOpts): Promise<void> {
  if (started) return;
  started = true;

  const client = opts.client ?? getPublicClient();
  const finalityDepth = opts.finalityDepth ?? DEFAULT_FINALITY_DEPTH;

  await backfill(client, opts.marketplaceAddress, opts.fromBlock, finalityDepth);

  if (!opts.skipLiveTail) {
    unwatch = client.watchContractEvent({
      address: opts.marketplaceAddress,
      abi: MarketplaceAbi,
      onLogs: (logs) => {
        // Live-tail logs may not yet have finality; surface them anyway —
        // the UI is read-mostly, and a one-block reorg on Monad is rare
        // enough that the simple cache is "good enough" for the hackathon.
        void ingestLogs(client, opts.marketplaceAddress, logs as Log[]);
      },
      onError: (err) => {
        // Don't crash the API on transient subscription errors.
        // eslint-disable-next-line no-console
        console.error("[watcher] subscription error:", err);
      },
    });
  }
}

/** Stop the live subscription and reset module state. Tests use this between
 *  cases; production also calls it on graceful shutdown. */
export function stopWatcher(): void {
  if (unwatch !== null) {
    try {
      unwatch();
    } catch {
      /* swallow; cleanup is best-effort */
    }
    unwatch = null;
  }
  started = false;
  lastSyncedBlock = 0n;
  toolCache.clear();
  seenLogs.clear();
}

/** Snapshot of every cached tool, sorted by numeric id ascending. */
export function getCachedTools(): CachedTool[] {
  return Array.from(toolCache.values()).sort((a, b) => {
    const ai = BigInt(a.id);
    const bi = BigInt(b.id);
    if (ai < bi) return -1;
    if (ai > bi) return 1;
    return 0;
  });
}

export function getCachedTool(id: string): CachedTool | undefined {
  return toolCache.get(id);
}

export function getLastSyncedBlock(): bigint {
  return lastSyncedBlock;
}

// ── Test seam: directly ingest log objects without a real chain ─────────────

/**
 * Inject a synthetic log into the cache, with chain reads disabled. Tests use
 * this to verify event decoding + cache shape without an RPC.
 *
 * The injected log MUST have its full Tool view supplied via `toolView`, since
 * we skip the on-chain `getTool` round-trip.
 */
export async function ingestLogForTesting(opts: {
  log: Log;
  toolView: {
    provider: Address;
    payout: Address;
    pricePerCall: bigint;
    version: number;
    enabled: boolean;
    schemaHash: `0x${string}`;
    endpoint: string;
    name: string;
    description: string;
  };
}): Promise<void> {
  const dedupKey = makeDedupKey(opts.log);
  if (dedupKey === null || seenLogs.has(dedupKey)) return;

  const decoded = tryDecode(opts.log);
  if (decoded === null) return;
  const toolId = decoded.toolId.toString();

  seenLogs.add(dedupKey);
  upsertFromView(toolId, opts.toolView);
}

// ── Internals ───────────────────────────────────────────────────────────────

async function backfill(
  client: PublicClient,
  address: Address,
  fromBlock: bigint,
  finalityDepth: bigint,
): Promise<void> {
  const head = await client.getBlockNumber();
  const toBlock = head > finalityDepth ? head - finalityDepth : 0n;
  if (toBlock < fromBlock) {
    // Nothing finalized yet within the requested window.
    lastSyncedBlock = fromBlock;
    return;
  }

  // Public Monad RPCs cap block-range per request (Tatum=100, Ankr=...).
  // Chunk the backfill in safe steps so we don't blow the limit. Configurable
  // via CHAIN_BACKFILL_CHUNK env (default 50 blocks/request).
  const chunk = BigInt(process.env.CHAIN_BACKFILL_CHUNK ?? "50");
  for (let start = fromBlock; start <= toBlock; start += chunk) {
    const end = start + chunk - 1n > toBlock ? toBlock : start + chunk - 1n;
    const logs = await client.getContractEvents({
      address,
      abi: MarketplaceAbi,
      fromBlock: start,
      toBlock: end,
    });
    await ingestLogs(client, address, logs as Log[]);
    lastSyncedBlock = end;
  }
}

async function ingestLogs(
  client: PublicClient,
  address: Address,
  logs: Log[],
): Promise<void> {
  // Sort by (blockNumber, logIndex) so replayed events apply in canonical order.
  const sorted = [...logs].sort((a, b) => {
    const ab = a.blockNumber ?? 0n;
    const bb = b.blockNumber ?? 0n;
    if (ab !== bb) return ab < bb ? -1 : 1;
    const ai = a.logIndex ?? 0;
    const bi = b.logIndex ?? 0;
    return ai - bi;
  });

  for (const log of sorted) {
    const dedupKey = makeDedupKey(log);
    if (dedupKey === null || seenLogs.has(dedupKey)) continue;

    const decoded = tryDecode(log);
    if (decoded === null) continue;

    seenLogs.add(dedupKey);
    await refreshTool(client, address, decoded.toolId);
  }
}

type DecodedToolEvent = { name: "ToolRegistered" | "ToolUpdated"; toolId: bigint };

function tryDecode(log: Log): DecodedToolEvent | null {
  try {
    const decoded = decodeEventLog({
      abi: MarketplaceAbi,
      data: log.data,
      topics: log.topics,
    });
    if (
      decoded.eventName === "ToolRegistered" ||
      decoded.eventName === "ToolUpdated"
    ) {
      // Both events have `toolId` as their first indexed arg. `decoded.args`
      // is typed as `readonly unknown[] | { ... }` by viem since it widens
      // across the full ABI union — narrow through `unknown` here.
      const args = decoded.args as unknown as { toolId: bigint };
      return { name: decoded.eventName, toolId: args.toolId };
    }
    return null;
  } catch {
    return null;
  }
}

function makeDedupKey(log: Log): string | null {
  if (!log.transactionHash) return null;
  if (log.logIndex === null || log.logIndex === undefined) return null;
  return `${log.transactionHash}:${log.logIndex}`;
}

/** Fetch the canonical Tool struct from chain and upsert into the cache.
 *  Events alone don't carry `endpoint` / `name` / `description`, so we always
 *  re-read on update — Marketplace `tools` mapping is the source of truth. */
async function refreshTool(
  client: PublicClient,
  address: Address,
  toolId: bigint,
): Promise<void> {
  try {
    const tool = (await client.readContract({
      address,
      abi: MarketplaceAbi as Abi,
      functionName: "getTool",
      args: [toolId],
    })) as {
      provider: Address;
      payout: Address;
      pricePerCall: bigint;
      version: number;
      enabled: boolean;
      schemaHash: `0x${string}`;
      endpoint: string;
      name: string;
      description: string;
    };
    upsertFromView(toolId.toString(), tool);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[watcher] getTool(${toolId}) failed:`, err);
  }
}

function upsertFromView(
  id: string,
  view: {
    provider: Address;
    pricePerCall: bigint;
    version: number;
    enabled: boolean;
    schemaHash: `0x${string}`;
    endpoint: string;
    name: string;
    description: string;
  },
): void {
  const existing = toolCache.get(id);
  const row: CachedTool = {
    id,
    provider: view.provider,
    name: view.name,
    description: view.description,
    priceWei: view.pricePerCall.toString(),
    priceDisplay: formatMon(view.pricePerCall),
    version: Number(view.version),
    schemaHash: view.schemaHash,
    endpoint: view.endpoint,
    enabled: view.enabled,
    // Preserve aggregates across updates; they're filled by a future
    // call-accounting source (see §6.3 schema).
    calls: existing?.calls ?? 0,
    rating: existing?.rating ?? null,
  };
  toolCache.set(id, row);
}

/** Render a wei value as `<int>.<3-decimals> MON`. Matches the formatter used
 *  by `mock-tools.ts` so the wire shape stays identical between mock + chain. */
function formatMon(wei: bigint): string {
  const ONE = 10n ** 18n;
  const whole = wei / ONE;
  const frac = wei % ONE;
  const fracStr = frac.toString().padStart(18, "0").slice(0, 3);
  return `${whole}.${fracStr} MON`;
}
