/**
 * api/test/worker-integration.test.ts
 *
 * End-to-end Worker pipeline test:
 *   live ChainClient (anvil) + MockLLMProvider + mocked Provider HTTP →
 *   asserts SSE events fire in order and the task ends in `completed`.
 *
 * Skips when Foundry isn't available (same gate as `chain-wallet.test.ts`).
 */

import "./helpers/setup-env.js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  http as httpTransport,
  parseEther,
  parseEventLogs,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { spawn, type ChildProcess, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { existsSync } from "node:fs";

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

describe.skipIf(skipReason !== null)(
  `Worker pipeline — runTask with live ChainClient (${skipReason ?? "live"})`,
  () => {
    let proc: ChildProcess;
    let rpcUrl: string;
    let pub: PublicClient;
    let marketplaceAddress: Address;
    let agentId: bigint;
    let toolId: bigint;

    beforeAll(async () => {
      const port = await getFreePort();
      proc = spawn(
        "anvil",
        ["--port", String(port), "--accounts", "5", "--silent"],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      rpcUrl = `http://127.0.0.1:${port}`;
      await waitForRpc(rpcUrl);

      // Deploy via forge
      const r = spawnSync(
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
      if (r.status !== 0) {
        throw new Error(`forge script failed: ${r.stdout}\n${r.stderr}`);
      }
      const marketplace = /Marketplace:\s+(0x[0-9a-fA-F]{40})/.exec(
        r.stdout,
      )?.[1];
      if (!marketplace) {
        throw new Error(`could not parse marketplace addr: ${r.stdout}`);
      }
      marketplaceAddress = marketplace as Address;

      pub = createPublicClient({
        transport: httpTransport(rpcUrl),
      }) as PublicClient;

      // Register a tool + fund an agent so the Worker can transact.
      const { MarketplaceAbi } = await import("../src/chain/abi.js");
      const ownerWallet = createWalletClient({
        account: privateKeyToAccount(ANVIL_PK),
        transport: httpTransport(rpcUrl),
      });
      const operator = privateKeyToAccount(ANVIL_PK_2);

      const regHash = await ownerWallet.writeContract({
        address: marketplaceAddress,
        abi: MarketplaceAbi,
        functionName: "registerTool",
        args: [
          "https://example.com/tool",
          ("0x" + "ab".repeat(32)) as Hex,
          parseEther("0.01"),
          "MockTool",
          "stub",
          privateKeyToAccount(ANVIL_PK).address,
        ],
        chain: null,
      });
      const regReceipt = await pub.waitForTransactionReceipt({ hash: regHash });
      toolId = (
        parseEventLogs({
          abi: MarketplaceAbi,
          logs: regReceipt.logs,
          eventName: "ToolRegistered",
        })[0]!.args as unknown as { toolId: bigint }
      ).toolId;

      const fundHash = await ownerWallet.writeContract({
        address: marketplaceAddress,
        abi: MarketplaceAbi,
        functionName: "createAndFundAgent",
        args: [
          parseEther("0.5"),
          parseEther("1.0"),
          operator.address,
          "Worker Agent",
          "g",
        ],
        value: parseEther("1.0"),
        chain: null,
      });
      const fundReceipt = await pub.waitForTransactionReceipt({
        hash: fundHash,
      });
      agentId = (
        parseEventLogs({
          abi: MarketplaceAbi,
          logs: fundReceipt.logs,
          eventName: "AgentCreated",
        })[0]!.args as unknown as { agentId: bigint }
      ).agentId;
    }, 60_000);

    afterAll(() => {
      if (proc && !proc.killed) {
        try {
          proc.kill("SIGKILL");
        } catch {
          // best-effort
        }
      }
    });

    test("runTask: plan → pay → invoke → integrate → complete with real chain", async () => {
      const { createWalletChainClient } = await import(
        "../src/chain/wallet.js"
      );
      const { InMemoryWorkerDb } = await import("../src/worker/db.js");
      const { MockLLMProvider } = await import("../src/worker/llm.js");
      const { createInMemorySseHub } = await import("../src/worker/sse.js");
      const { runTask } = await import("../src/worker/runTask.js");

      const chainClient = createWalletChainClient({
        rpcUrl,
        operatorPk: ANVIL_PK_2,
        marketplaceAddress,
        chainId: 31337,
        publicClient: pub,
      });

      const db = new InMemoryWorkerDb();
      // Seed agent policy (string ids per WorkerDb contract).
      const agentIdStr = agentId.toString();
      db.agents.set(agentIdStr, {
        id: agentIdStr,
        ownerAddress: privateKeyToAccount(ANVIL_PK).address,
        operatorAddress: privateKeyToAccount(ANVIL_PK_2).address,
        balanceWei: parseEther("1.0").toString(),
        maxPerCallWei: parseEther("0.5").toString(),
        dailySpendCapWei: parseEther("1.0").toString(),
        dailySpentWei: "0",
      });
      // Seed tool.
      db.tools.push({
        id: toolId.toString(),
        version: 1,
        pricePerCallWei: parseEther("0.01").toString(),
        endpoint: "https://example.com/tool",
        enabled: true,
        name: "MockTool",
        description: "stub",
      });
      // Seed task.
      const taskId = "task-int-1";
      db.tasks.set(taskId, {
        id: taskId,
        agentId: agentIdStr,
        parentTaskId: null,
        status: "pending",
        prompt: "test prompt",
        promptHash: null,
        salt: null,
        onChainTaskId: null,
        resultText: null,
        resultHash: null,
        planJson: null,
        error: null,
      });

      const sse = createInMemorySseHub();
      const seen: string[] = [];
      sse.subscribe(taskId, (evt) => seen.push(evt.type));

      // Stub Provider HTTP — always returns a successful output.
      const http = async () =>
        ({ status: 200, body: { output: "hello world" } }) as const;

      const outcome = await runTask(
        { taskId },
        {
          db,
          chainClient,
          llm: new MockLLMProvider({ stepCount: 1 }),
          sse,
          http,
        },
      );

      expect(outcome.status).toBe("completed");
      // Required event order — mock provider gives us one step.
      const required = [
        "task.planning",
        "plan.generated",
        "tool.call.started",
        "payment.confirmed",
        "tool.call.completed",
        "integration.started",
        "task.completed",
      ];
      for (const r of required) {
        expect(seen).toContain(r);
      }
      // task.completed must be last.
      expect(seen[seen.length - 1]).toBe("task.completed");

      const finalRow = await db.getTask(taskId);
      expect(finalRow?.status).toBe("completed");
      expect(finalRow?.resultHash).toMatch(/^0x[0-9a-f]{64}$/);
    }, 60_000);
  },
);
