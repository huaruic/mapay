// INTEGRATION: register in api/src/server.ts via: app.register(agentsRoutes);

import type { FastifyPluginAsync } from "fastify";
import { encodeFunctionData, parseEther } from "viem";
import {
  generatePrivateKey,
  privateKeyToAddress,
} from "viem/accounts";
import { z } from "zod";
import { requireAuth } from "../lib/auth-guard.js";
import {
  createAgent,
  getAgent,
  listAgents,
  storeBurnerKey,
} from "../lib/in-memory-store.js";
import {
  MARKETPLACE_ABI,
  MARKETPLACE_ADDRESS,
} from "../lib/marketplace-abi.js";

// Decimal MON string validator. Accepts "0", "0.5", "1.25" etc. Disallows
// negatives and scientific notation so parseEther stays predictable.
const monAmount = z
  .string()
  .regex(/^\d+(\.\d{1,18})?$/, "must be a decimal MON value")
  .refine((s) => {
    try {
      return parseEther(s) > 0n;
    } catch {
      return false;
    }
  }, "must be > 0");

const prepareCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    goal: z.string().trim().min(1).max(500),
    totalBudget: monAmount,
    maxPerCall: monAmount,
    dailySpendCap: monAmount,
  })
  .refine(
    (data) => parseEther(data.maxPerCall) <= parseEther(data.totalBudget),
    { message: "maxPerCall must be ≤ totalBudget", path: ["maxPerCall"] },
  )
  .refine(
    (data) => parseEther(data.dailySpendCap) >= parseEther(data.maxPerCall),
    { message: "dailySpendCap must be ≥ maxPerCall", path: ["dailySpendCap"] },
  )
  .refine(
    (data) => parseEther(data.dailySpendCap) <= parseEther(data.totalBudget),
    { message: "dailySpendCap must be ≤ totalBudget", path: ["dailySpendCap"] },
  );

const prepareFundSchema = z.object({ amount: monAmount });
const prepareWithdrawSchema = z.object({ amount: monAmount });

function serializeAgent(agent: ReturnType<typeof getAgent>) {
  if (!agent) return null;
  return {
    id: agent.id,
    name: agent.name,
    goal: agent.goal,
    owner: agent.ownerAddress,
    operator: agent.operatorAddress,
    totalBudget: agent.totalBudget,
    balance: agent.balance,
    maxPerCall: agent.maxPerCall,
    dailySpendCap: agent.dailySpendCap,
    reputation: agent.reputation,
    tasks: agent.tasks,
    status: agent.status,
    currentTaskId: agent.currentTaskId,
    chainAgentId: agent.chainAgentId,
  };
}

export const agentsRoutes: FastifyPluginAsync = async (app) => {
  // ---------------------------------------------------------------------------
  // GET /api/agents — list caller's agents
  // ---------------------------------------------------------------------------
  // TODO(track-d): swap in chain-watcher read (filter Passport Transfer events
  // by owner). For now we return whatever the in-memory store knows.
  app.get("/api/agents", async (request, reply) => {
    const owner = await requireAuth(request, reply);
    if (!owner) return;
    const list = listAgents(owner);
    return { agents: list.map(serializeAgent) };
  });

  // ---------------------------------------------------------------------------
  // GET /api/agents/aggregate-stats — totals for the agents-list header
  // ---------------------------------------------------------------------------
  app.get("/api/agents/aggregate-stats", async (request, reply) => {
    const owner = await requireAuth(request, reply);
    if (!owner) return;
    const list = listAgents(owner);
    // Sum balances as bigint via parseEther → format to keep precision.
    let totalBalanceWei = 0n;
    let completedTasks = 0;
    let highestReputation = 0;
    for (const a of list) {
      try {
        totalBalanceWei += parseEther(a.balance);
      } catch {
        // ignore malformed; pre-MVP only
      }
      completedTasks += a.tasks;
      if (a.reputation > highestReputation) highestReputation = a.reputation;
    }
    // Format wei back to decimal MON (truncate to 3 decimals for display).
    const totalBalance = formatWeiToMon(totalBalanceWei);
    return {
      agents: list.length,
      totalBalance,
      completedTasks,
      highestReputation,
    };
  });

  // ---------------------------------------------------------------------------
  // POST /api/agents/prepare-create — encode calldata + mint burner operator
  // ---------------------------------------------------------------------------
  app.post("/api/agents/prepare-create", async (request, reply) => {
    const owner = await requireAuth(request, reply);
    if (!owner) return;

    const parsed = prepareCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_body",
        issues: parsed.data ?? parsed.error.flatten(),
      });
    }
    const { name, goal, totalBudget, maxPerCall, dailySpendCap } = parsed.data;

    // Mint a burner key for this agent. TODO(track-d): wrap with KMS before
    // persisting; right now we just keep it in-process.
    const burnerPk = generatePrivateKey();
    const operatorAddress = privateKeyToAddress(burnerPk);
    storeBurnerKey(operatorAddress, burnerPk);

    const totalBudgetWei = parseEther(totalBudget);
    const maxPerCallWei = parseEther(maxPerCall);
    const dailySpendCapWei = parseEther(dailySpendCap);

    const data = encodeFunctionData({
      abi: MARKETPLACE_ABI,
      functionName: "createAndFundAgent",
      args: [maxPerCallWei, dailySpendCapWei, operatorAddress, name, goal],
    });

    // Persist the off-chain mirror so subsequent /api/agents/:id calls see the
    // agent. The chain Tx hasn't landed yet; once Track D wires the chain
    // watcher, `chainAgentId` will get filled from the Transfer/AgentCreated
    // event. For demo, the mirror id (string sequence) doubles as the chain id.
    const agent = createAgent({
      ownerAddress: owner,
      operatorAddress,
      name,
      goal,
      totalBudget,
      maxPerCall,
      dailySpendCap,
    });

    return {
      calldata: {
        to: MARKETPLACE_ADDRESS,
        data,
        value: totalBudgetWei.toString(),
      },
      operatorAddress,
      // Hint for the frontend: this is the row we'd redirect to once the tx
      // confirms. Track D may replace with on-chain agentId from logs.
      expectedAgentId: agent.id,
    };
  });

  // ---------------------------------------------------------------------------
  // GET /api/agents/:id — fetch a single agent (ownership check)
  // ---------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>("/api/agents/:id", async (request, reply) => {
    const owner = await requireAuth(request, reply);
    if (!owner) return;
    const agent = getAgent(request.params.id);
    if (!agent) return reply.code(404).send({ error: "agent_not_found" });
    if (agent.ownerAddress.toLowerCase() !== owner.toLowerCase()) {
      return reply.code(403).send({ error: "forbidden" });
    }
    return serializeAgent(agent);
  });

  // ---------------------------------------------------------------------------
  // POST /api/agents/:id/prepare-fund — fundAgent calldata
  // ---------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/api/agents/:id/prepare-fund",
    async (request, reply) => {
      const owner = await requireAuth(request, reply);
      if (!owner) return;
      const agent = getAgent(request.params.id);
      if (!agent) return reply.code(404).send({ error: "agent_not_found" });
      if (agent.ownerAddress.toLowerCase() !== owner.toLowerCase()) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const parsed = prepareFundSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body" });
      }
      const amountWei = parseEther(parsed.data.amount);
      const data = encodeFunctionData({
        abi: MARKETPLACE_ABI,
        functionName: "fundAgent",
        args: [BigInt(agent.id)],
      });
      return {
        calldata: {
          to: MARKETPLACE_ADDRESS,
          data,
          value: amountWei.toString(),
        },
      };
    },
  );

  // ---------------------------------------------------------------------------
  // POST /api/agents/:id/prepare-withdraw — withdrawAgentBalance calldata
  // ---------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/api/agents/:id/prepare-withdraw",
    async (request, reply) => {
      const owner = await requireAuth(request, reply);
      if (!owner) return;
      const agent = getAgent(request.params.id);
      if (!agent) return reply.code(404).send({ error: "agent_not_found" });
      if (agent.ownerAddress.toLowerCase() !== owner.toLowerCase()) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const parsed = prepareWithdrawSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body" });
      }
      const amountWei = parseEther(parsed.data.amount);
      const data = encodeFunctionData({
        abi: MARKETPLACE_ABI,
        functionName: "withdrawAgentBalance",
        args: [BigInt(agent.id), amountWei],
      });
      return {
        calldata: { to: MARKETPLACE_ADDRESS, data, value: "0" },
      };
    },
  );
};

// Compact bigint-wei → "0.XYZ MON-style" decimal string. Internal; not exported
// because the rest of the API still trades decimal strings end-to-end.
function formatWeiToMon(wei: bigint): string {
  if (wei === 0n) return "0";
  const denom = 10n ** 18n;
  const whole = wei / denom;
  const frac = wei % denom;
  if (frac === 0n) return whole.toString();
  // 18-digit fractional part, trim trailing zeros, cap at 6 for display.
  const fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "");
  const trimmed = fracStr.slice(0, 6);
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}
