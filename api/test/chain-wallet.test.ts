/**
 * api/test/chain-wallet.test.ts
 *
 * Integration test for the write-capable `ChainClient` implemented in
 * `src/chain/wallet.ts`. Boots a local Anvil node, deploys Passport +
 * Marketplace via Foundry's DeployLocal script, then drives the four write
 * methods end-to-end.
 *
 * The suite skips itself cleanly when:
 *   - `SKIP_ANVIL_TESTS` is set (CI escape hatch), OR
 *   - `anvil` / `forge` binaries are not on PATH (devs without Foundry).
 *
 * Run locally with Foundry installed:
 *   curl -L https://foundry.paradigm.xyz | bash && foundryup
 *   cd api && npm test -- chain-wallet
 */

import "./helpers/setup-env.js";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
} from "vitest";
import {
  createPublicClient,
  createWalletClient,
  http as httpTransport,
  keccak256,
  parseEther,
  parseEventLogs,
  toBytes,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { spawn, type ChildProcess, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const ANVIL_PK: Hex =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ANVIL_PK_2: Hex =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CONTRACTS_DIR = join(REPO_ROOT, "contracts");

function which(bin: string): boolean {
  const r = spawnSync("which", [bin], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim().length > 0;
}

const hasFoundry = which("anvil") && which("forge");
const skipReason =
  process.env.SKIP_ANVIL_TESTS
    ? "SKIP_ANVIL_TESTS is set"
    : !hasFoundry
      ? "anvil/forge not installed on PATH"
      : !existsSync(CONTRACTS_DIR)
        ? `contracts dir not found at ${CONTRACTS_DIR}`
        : null;

async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (typeof addr === "object" && addr !== null && "port" in addr) {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("could not derive port")));
      }
    });
  });
}

async function waitForRpc(url: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_chainId",
          params: [],
          id: 1,
        }),
      });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`anvil did not respond at ${url} within ${timeoutMs}ms`);
}

interface Spawned {
  proc: ChildProcess;
  port: number;
  rpcUrl: string;
}

async function startAnvil(): Promise<Spawned> {
  const port = await getFreePort();
  const proc = spawn(
    "anvil",
    ["--port", String(port), "--accounts", "5", "--silent"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    },
  );
  const rpcUrl = `http://127.0.0.1:${port}`;
  await waitForRpc(rpcUrl);
  return { proc, port, rpcUrl };
}

function killProc(proc: ChildProcess): void {
  if (!proc.killed) {
    try {
      proc.kill("SIGKILL");
    } catch {
      // best-effort
    }
  }
}

interface Deployed {
  passport: Address;
  marketplace: Address;
}

function deployContracts(rpcUrl: string): Deployed {
  // Use forge script with broadcast. Run inside contracts dir; pass RPC URL
  // and the default Anvil PK. Forge script auto-prints addresses in the
  // broadcast JSON; we additionally parse the console.log output.
  const result = spawnSync(
    "forge",
    [
      "script",
      "script/DeployLocal.s.sol:DeployLocal",
      "--rpc-url",
      rpcUrl,
      "--private-key",
      ANVIL_PK,
      "--broadcast",
      "--skip-simulation",
      "-vvv",
    ],
    {
      cwd: CONTRACTS_DIR,
      encoding: "utf8",
      env: { ...process.env, PRIVATE_KEY: ANVIL_PK },
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `forge script failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`,
    );
  }
  // Parse the console2.log lines for addresses. Output looks like:
  //   Passport:     0x...
  //   Marketplace:  0x...
  const txt = result.stdout;
  const passport = /Passport:\s+(0x[0-9a-fA-F]{40})/.exec(txt)?.[1];
  const marketplace = /Marketplace:\s+(0x[0-9a-fA-F]{40})/.exec(txt)?.[1];
  if (!passport || !marketplace) {
    throw new Error(`failed to parse deploy output:\n${txt}`);
  }
  return {
    passport: passport as Address,
    marketplace: marketplace as Address,
  };
}

// ── Always-on unit tests (don't need anvil) ─────────────────────────────────

describe("ChainClient — wallet.ts env validation", () => {
  test("makeChainClient throws when CHAIN_RPC_URL is missing", async () => {
    const prev = process.env.CHAIN_RPC_URL;
    delete process.env.CHAIN_RPC_URL;
    process.env.OPERATOR_PK = "0x" + "11".repeat(32);
    process.env.MARKETPLACE_ADDRESS = "0x" + "22".repeat(20);
    try {
      const { makeChainClient } = await import("../src/chain/wallet.js");
      expect(() => makeChainClient()).toThrow(/CHAIN_RPC_URL/);
    } finally {
      if (prev !== undefined) process.env.CHAIN_RPC_URL = prev;
      delete process.env.OPERATOR_PK;
      delete process.env.MARKETPLACE_ADDRESS;
    }
  });

  test("makeChainClient rejects malformed OPERATOR_PK", async () => {
    process.env.CHAIN_RPC_URL = "http://127.0.0.1:8545";
    process.env.OPERATOR_PK = "0xnothex";
    process.env.MARKETPLACE_ADDRESS = "0x" + "22".repeat(20);
    try {
      const { makeChainClient } = await import("../src/chain/wallet.js");
      expect(() => makeChainClient()).toThrow(/OPERATOR_PK/);
    } finally {
      delete process.env.CHAIN_RPC_URL;
      delete process.env.OPERATOR_PK;
      delete process.env.MARKETPLACE_ADDRESS;
    }
  });
});

describe.skipIf(skipReason !== null)(
  `ChainClient — wallet.ts integration (${skipReason ?? "live"})`,
  () => {
    let spawned: Spawned;
    let deployed: Deployed;
    let pub: PublicClient;
    let tmpDir: string;

    beforeAll(async () => {
      tmpDir = mkdtempSync(join(tmpdir(), "agentpay-chain-test-"));
      spawned = await startAnvil();
      deployed = deployContracts(spawned.rpcUrl);
      pub = createPublicClient({
        transport: httpTransport(spawned.rpcUrl),
      }) as PublicClient;
    }, 60_000);

    afterAll(() => {
      killProc(spawned.proc);
      if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    });

    test("e2e: registerTool → createAndFundAgent → startTask → pay → completeTask", async () => {
      // Build the write-side ChainClient under test.
      const { createWalletChainClient } = await import("../src/chain/wallet.js");
      // Use Anvil account 1 as the operator (different from the deployer so
      // we exercise the operator-only check on startTask/pay).
      const operatorAccount = privateKeyToAccount(ANVIL_PK_2);

      // ── (1) Register a tool from the deployer (provider role) ──────────
      const ownerWallet = createWalletClient({
        account: privateKeyToAccount(ANVIL_PK),
        transport: httpTransport(spawned.rpcUrl),
      });
      const { MarketplaceAbi } = await import("../src/chain/abi.js");
      const regHash = await ownerWallet.writeContract({
        address: deployed.marketplace,
        abi: MarketplaceAbi,
        functionName: "registerTool",
        args: [
          "https://example.com/tool",
          ("0x" + "11".repeat(32)) as Hex,
          parseEther("0.01"),
          "TestTool",
          "test",
          privateKeyToAccount(ANVIL_PK).address,
        ],
        chain: null,
      });
      const regReceipt = await pub.waitForTransactionReceipt({ hash: regHash });
      const regEvents = parseEventLogs({
        abi: MarketplaceAbi,
        logs: regReceipt.logs,
        eventName: "ToolRegistered",
      });
      const toolId = (regEvents[0]!.args as unknown as { toolId: bigint })
        .toolId;
      expect(toolId).toBeGreaterThan(0n);

      // ── (2) Create + fund an agent owned by deployer, operator = account 1.
      const fundHash = await ownerWallet.writeContract({
        address: deployed.marketplace,
        abi: MarketplaceAbi,
        functionName: "createAndFundAgent",
        args: [
          parseEther("0.5"),
          parseEther("1.0"),
          operatorAccount.address,
          "Test Agent",
          "test goal",
        ],
        value: parseEther("1.0"),
        chain: null,
      });
      const fundReceipt = await pub.waitForTransactionReceipt({
        hash: fundHash,
      });
      const agentEvents = parseEventLogs({
        abi: MarketplaceAbi,
        logs: fundReceipt.logs,
        eventName: "AgentCreated",
      });
      const agentId = (agentEvents[0]!.args as unknown as { agentId: bigint })
        .agentId;

      // ── (3) Now drive the ChainClient as the operator ──────────────────
      const client = createWalletChainClient({
        rpcUrl: spawned.rpcUrl,
        operatorPk: ANVIL_PK_2,
        marketplaceAddress: deployed.marketplace,
        chainId: 31337,
        publicClient: pub,
      });

      const startRes = await client.startTask({
        agentId: agentId.toString(),
        prompt: "draft 3 tweets about Monad",
      });
      expect(startRes.onChainTaskId).toMatch(/^0x[0-9a-f]{64}$/);
      expect(startRes.txHash).toMatch(/^0x[0-9a-f]{64}$/);

      const inputHash = keccak256(toBytes(JSON.stringify({ prompt: "hi" })));
      const payRes = await client.pay({
        onChainTaskId: startRes.onChainTaskId,
        toolId: toolId.toString(),
        toolVersion: 1,
        expectedPriceWei: parseEther("0.01").toString(),
        inputHash,
      });
      expect(payRes.receiptId).toMatch(/^0x[0-9a-f]{64}$/);
      expect(payRes.stepIdx).toBe(1);
      expect(payRes.txHash).toMatch(/^0x[0-9a-f]{64}$/);

      // Reconcile path: confirmed + not reverted.
      const reconcile = await client.reconcilePayTx(payRes.txHash);
      expect(reconcile.confirmed).toBe(true);
      expect(reconcile.reverted).toBe(false);
      expect(reconcile.receiptId).toBe(payRes.receiptId);
      expect(reconcile.stepIdx).toBe(1);

      const resultHash = keccak256(toBytes("done"));
      const completeRes = await client.completeTask({
        onChainTaskId: startRes.onChainTaskId,
        resultHash,
      });
      expect(completeRes.txHash).toMatch(/^0x[0-9a-f]{64}$/);

      // On-chain state: task is now Completed.
      const taskView = (await pub.readContract({
        address: deployed.marketplace,
        abi: MarketplaceAbi,
        functionName: "getTask",
        args: [startRes.onChainTaskId],
      })) as { status: number; resultHash: Hex };
      // TaskStatus enum: 0 None, 1 Open, 2 Completed.
      expect(taskView.status).toBe(2);
      expect(taskView.resultHash).toBe(resultHash);
    }, 60_000);

    test("revert path: pay() with bad expectedPrice surfaces clean error", async () => {
      const { createWalletChainClient } = await import("../src/chain/wallet.js");
      const { MarketplaceAbi } = await import("../src/chain/abi.js");
      const ownerWallet = createWalletClient({
        account: privateKeyToAccount(ANVIL_PK),
        transport: httpTransport(spawned.rpcUrl),
      });
      // Fresh tool + agent for this case.
      const regHash = await ownerWallet.writeContract({
        address: deployed.marketplace,
        abi: MarketplaceAbi,
        functionName: "registerTool",
        args: [
          "https://example.com/tool2",
          ("0x" + "22".repeat(32)) as Hex,
          parseEther("0.01"),
          "ToolB",
          "test",
          privateKeyToAccount(ANVIL_PK).address,
        ],
        chain: null,
      });
      const regReceipt = await pub.waitForTransactionReceipt({ hash: regHash });
      const toolId = (
        parseEventLogs({
          abi: MarketplaceAbi,
          logs: regReceipt.logs,
          eventName: "ToolRegistered",
        })[0]!.args as unknown as { toolId: bigint }
      ).toolId;

      const operator = privateKeyToAccount(ANVIL_PK_2);
      const fundHash = await ownerWallet.writeContract({
        address: deployed.marketplace,
        abi: MarketplaceAbi,
        functionName: "createAndFundAgent",
        args: [
          parseEther("0.5"),
          parseEther("1.0"),
          operator.address,
          "Agent2",
          "g",
        ],
        value: parseEther("1.0"),
        chain: null,
      });
      const fundReceipt = await pub.waitForTransactionReceipt({
        hash: fundHash,
      });
      const agentId = (
        parseEventLogs({
          abi: MarketplaceAbi,
          logs: fundReceipt.logs,
          eventName: "AgentCreated",
        })[0]!.args as unknown as { agentId: bigint }
      ).agentId;

      const client = createWalletChainClient({
        rpcUrl: spawned.rpcUrl,
        operatorPk: ANVIL_PK_2,
        marketplaceAddress: deployed.marketplace,
        chainId: 31337,
        publicClient: pub,
      });
      const startRes = await client.startTask({
        agentId: agentId.toString(),
        prompt: "p",
      });

      // expectedPriceWei mismatches the on-chain price → revert.
      await expect(
        client.pay({
          onChainTaskId: startRes.onChainTaskId,
          toolId: toolId.toString(),
          toolVersion: 1,
          expectedPriceWei: parseEther("0.02").toString(), // wrong
          inputHash: ("0x" + "00".repeat(32)) as Hex,
        }),
      ).rejects.toThrow(/price mismatch|pay reverted/);
    }, 60_000);
  },
);
