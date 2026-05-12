# AgentPay Passport — Architecture Design

> **状态**：草案（2026-05-12）
> **来源**：[`agentpay-passport-prd.md`](../../../agentpay-passport-prd.md) 是产品需求事实；本文档是技术架构事实。
> **范围**：Hackathon (Monad Blitz @上海 V2) MVP，赛后 1-2 周内可迭代到 alpha。
> **受众**：后续 Claude / Codex / Cursor 会话以本文档为实现基线；OpenSpec changes 是本文档之上的功能 delta。

---

## 1. 目标与硬约束

### 1.1 设计目标

- 演示 PRD §7.2 的端到端闭环：Charlie 创建 agent → 提交任务 → 自主执行 → 看到整合产物 → 打分。
- 演示重心在 **End User 流**；Provider 端做到"能注册、能收钱、能提现"即可。
- 1-2 周内能继续向 alpha 迭代——不为长期堆装备，但不画死。

### 1.1.1 协议定位（Pitch 用语）

**"AgentPay Passport is MPP-aligned."** Monad 官方已把 Machine Payments Protocol (MPP) 列为一级章节；MPP 是 Stripe + Tempo Labs 推动的支付标准，**x402 是 MPP 的早期版本，MPP 向后兼容 x402**。本项目在 MPP 的"charge intent"之上叠加三件 MPP 自己不解决的事：

1. **Onchain marketplace discovery**——MPP 标准化"怎么付"，不解决"找谁付"
2. **Policy-bounded wallet**——MPP 标准化"付一次"，不解决"agent 自治预算"
3. **ERC-8004 Reputation Passport**——MPP 标准化"一次性凭证"，不解决"agent 跨场景身份"

Pitch 一句话：**"MPP standardized how an agent pays. We added what the agent decides, where it discovers, and how it remembers."**

### 1.2 PRD 衍生的非妥协约束

| 约束 | 在架构里如何体现 |
|---|---|
| 任务执行期间零人工介入 | Agent Worker 跑在后端 BullMQ 队列里；前端断开连接不影响任务推进 |
| 预算 / 单次上限协议层强制 | `Marketplace.pay()` 内 `require()`；LLM 无法绕过 |
| Provider ↔ End User 匿名 | 双方仅通过 agent 地址 + tool 地址协议层间接交互；UI 不暴露对方身份 |
| MCP 兼容 schema + onchain payment gate | Tool 注册时存 MCP-style JSON Schema；调用时 HTTP header 携带 receipt |
| Open-loop planning only | Worker plan-once-then-execute；不读中间结果回 LLM 重规划。多轮诉求通过 task 父子链解决（new task 携带 parent task 的 prompt+output 进 LLM context），每个 task 内部仍 open-loop |
| 链上可追溯 | 所有钱、注册、支付、reputation 都是链上 event；产物只锚 hash |
| 单链 Monad | 所有合约部署在 Monad testnet；MON 是结算单位 |

### 1.3 明确不做（与 PRD §10 一致）

争议仲裁、退款、KYC、内容审核、跨链、复杂 marketplace 查询（搜索/筛选/排序）、closed-loop adaptive replanning（task 内不重规划）、真实身份验证。

**多轮上下文 ≠ replanning**：用户点"调整"会创建一个新 task，新 task 的 Worker 会把父 task 的 prompt+result 拼进 LLM context——但每个 task 自己仍是 plan-once-execute，PRD §10 不动。

---

## 2. 系统架构

```
┌──────────────────┐   SIWE + REST + SSE   ┌────────────────────────────┐
│ Next.js Web App  │ ─────────────────────►│  Fastify API               │
│ (Vercel)         │ ◄─────────────────────│  + In-process Worker        │
│  wagmi/RainbowKit│                       │  (Fly.io)                  │
└────────┬─────────┘                       └──┬──────────┬──────────────┘
         │ 直签 tx                             │          │
         ▼                                      ▼          ▼
┌──────────────────────────────────┐    ┌──────────┐  ┌────────────┐
│ Monad Testnet                    │    │ Postgres │  │ Redis      │
│  Marketplace.sol + Passport.sol  │    │ (Neon)   │  │ (Upstash)  │
│  events ◄─── viem watch ────── ──┼────┘          │  │ BullMQ 队列│
└─────────────────┬────────────────┘                  └────────────┘
                  │ pay()/verifyReceipt
                  ▼
┌──────────────────────────────────┐
│ Provider Tool 服务 (Provider 自托管)│
│  @agentpay/provider-middleware    │
└──────────────────────────────────┘
```

**三个独立角色**：
- **Web** — 用户界面；wagmi 直签所有写交易；通过 EventSource 订阅 SSE。
- **API + Worker** — 物理上一个 Node 进程；逻辑上两个角色（HTTP routes + BullMQ consumer）。
- **Chain** — 钱与状态的 source of truth。

**为什么 Worker 与 API 同进程**：Hackathon 阶段一份部署最省事；BullMQ + Redis 提供持久化队列保证任务不丢；赛后改成独立 Fly.io app 是一行 `Procfile` 改动。

---

## 3. 技术栈

| 层 | 选型 | 备选/未来 |
|---|---|---|
| 智能合约 | Solidity 0.8.x + Foundry | — |
| 链交互（前后端共用） | viem v2 | — |
| 后端 | Node 22 + TypeScript + Fastify | — |
| 任务队列 | BullMQ + Upstash Redis | Hackathon 启动期可先用 in-memory 队列 |
| 数据库 | Postgres (Neon) + Drizzle ORM | — |
| LLM | **DeepSeek** (chat + tool use, OpenAI 兼容) | 抽象为 `LLMProvider` 接口，可切 Claude / GPT / OpenRouter |
| 实时推送 | Server-Sent Events | — |
| 前端 | Next.js 15 (App Router) + React 19 | — |
| 样式 | Tailwind v4 + shadcn/ui | — |
| 钱包 | wagmi v2 + RainbowKit | — |
| 前端状态 | TanStack Query (server) + Zustand (local) | — |
| 仓库 | pnpm workspaces + Turbo | — |
| Lint / Format | Biome | — |
| 测试 | Vitest (TS) + Foundry forge test (Solidity) | — |
| 部署 | Vercel (web) + Fly.io (api) + Neon + Upstash | — |

---

## 4. 仓库结构

```
mapay/
├── apps/
│   ├── web/                       # Next.js 15
│   │   ├── app/
│   │   │   ├── page.tsx           # 落地页
│   │   │   ├── agents/
│   │   │   │   ├── new/page.tsx   # 创建 agent 向导
│   │   │   │   ├── page.tsx       # agent 列表 (P1)
│   │   │   │   └── [id]/
│   │   │   │       ├── page.tsx   # agent dashboard (P1)
│   │   │   │       └── new-task/page.tsx
│   │   │   ├── tasks/[id]/
│   │   │   │   ├── page.tsx       # 三栏 Timeline 视图 (Demo 核心)
│   │   │   │   └── result/page.tsx
│   │   │   ├── marketplace/page.tsx
│   │   │   └── provider/
│   │   │       ├── page.tsx       # 控制台首页 (P1)
│   │   │       └── tools/
│   │   │           ├── new/page.tsx
│   │   │           └── [id]/page.tsx (P1)
│   │   └── lib/{wagmi,sse,api}.ts
│   └── api/
│       ├── src/
│       │   ├── server.ts          # Fastify boot + worker.run()
│       │   ├── routes/            # HTTP routes
│       │   ├── worker/
│       │   │   ├── runTask.ts     # Agent pipeline (见 §10)
│       │   │   └── llm.ts         # LLMProvider 抽象 (DeepSeek 默认)
│       │   ├── chain/             # viem client, contract bindings, event watcher
│       │   ├── db/                # Drizzle schema + migrations
│       │   └── sse/               # SSE pub/sub via Redis
│       └── fly.toml
├── packages/
│   ├── contracts/                 # Foundry
│   │   ├── src/{Marketplace,Passport}.sol
│   │   ├── test/
│   │   └── script/Deploy.s.sol
│   ├── shared/                    # zod schemas, ABI exports, 类型
│   └── provider-sdk/              # @agentpay/provider-middleware
├── openspec/                      # 已存在
├── docs/superpowers/specs/        # 本文档所在
├── agentpay-passport-prd.md
├── CLAUDE.md
├── pnpm-workspace.yaml
└── turbo.json
```

---

## 5. 智能合约

### 5.1 Marketplace.sol（一站式主合约）

四个内部模块合并到一个合约里，让 `createAndFundAgent`、`payAndCall` 等组合操作原子化。**Pull-payment 模型**：`pay()` 只更新 `providerBalances` 账本，Provider 自己 `withdrawProvider()` 拉钱——避免 `transfer()` 的 gas stipend 问题与外部调用风险。

**核心存储**

```solidity
struct Tool {
    address provider;        // 仅 provider 能 update / withdraw 本 tool 余额
    address payout;
    uint128 pricePerCall;    // wei (MON 18 decimals)
    uint64 version;          // 每次 update 自增；plan→execute 之间防价格/schema 漂移
    bool enabled;
    bytes32 schemaHash;      // MCP-style descriptor IPFS hash (§9 定义字段)
    string endpoint;         // HTTPS URL
    string name;
    string description;
}
mapping(uint256 => Tool) public tools;
uint256 public nextToolId;

struct Agent {
    address owner;           // End User 钱包；fund/withdraw/setOperator/setCap/rate 仅 owner
    address operator;        // Worker 代签地址；setAgentOperator 由 owner 更换
    uint128 balance;
    uint128 maxPerCall;
    uint128 dailySpendCap;   // 抗 operator-key 泄露 drain 的滚动 24h 上限
    uint128 dailySpent;
    uint64 dailyResetAt;
    uint128 totalBudget;     // 仅观察用：sum of deposits
    uint128 totalSpent;
    uint16 reputation;       // 0-1000，Passport NFT 同源拷贝在 agent 上方便读
    bool active;
}
mapping(uint256 => Agent) public agents;
uint256 public nextAgentId;

// 链上 Task 仅记录最少必要状态——明细在后端 DB
enum TaskStatus { Open, Completed, Cancelled }
struct Task {
    uint256 agentId;
    bytes32 promptHash;      // 提交时锚定 prompt + injection 序列 hash，防篡改
    bytes32 resultHash;      // completeTask 时写入
    uint32 stepCount;
    TaskStatus status;
    bool rated;              // 防重复打分
}
mapping(bytes32 => Task) public tasks;   // taskId = keccak256(agentId, promptHash, salt)

// Receipt：绑定 task / step / tool version / amount / inputHash / chainId / contract
// 防碰撞防替换防跨链 / 跨合约重放
struct Receipt {
    bytes32 taskId;
    uint256 agentId;
    uint256 toolId;
    uint64 toolVersion;      // 锚定 plan 时刻的 tool 版本
    uint32 stepIdx;          // task 内单调递增
    uint128 amount;
    bytes32 inputHash;       // HTTP body 的 keccak256；Provider 校验时核对
    uint64 timestamp;
    bool consumed;           // verifyAndConsumeReceipt 原子置 true
}
mapping(bytes32 => Receipt) public receipts;
mapping(uint256 => uint32) public agentStepCounter;   // agentId → 全局单调 stepIdx

// Pull payment 账本
mapping(address => uint256) public providerBalances;
```

**核心函数**（每条都附 invariants 注释）

```solidity
// === Provider ===
// invariants: msg.sender 即记作 provider；version 初始化为 1
function registerTool(string calldata endpoint, bytes32 schemaHash, uint128 price,
                      string calldata name, string calldata description, address payout)
  external returns (uint256 toolId);

// invariants: 仅 tool.provider；任一字段变化 version++（plan-time 防漂移依据）
function updateTool(uint256 toolId, uint128 newPrice, bool enabled, bytes32 newSchemaHash) external;

// invariants: providerBalances[msg.sender] ≥ amount；CEI；nonReentrant
function withdrawProvider(uint256 amount) external;

// === End User (Agent owner) ===
// invariants: maxPerCall ≤ dailySpendCap ≤ msg.value；mint Passport NFT
function createAndFundAgent(uint128 maxPerCall, uint128 dailySpendCap,
                            address operator, string calldata name, string calldata goal)
  external payable returns (uint256 agentId);

function fundAgent(uint256 agentId) external payable;                       // 仅 owner
function withdrawAgentBalance(uint256 agentId, uint128 amount) external;    // 仅 owner; CEI
function setAgentOperator(uint256 agentId, address newOperator) external;   // 仅 owner
function setAgentDailySpendCap(uint256 agentId, uint128 newCap) external;   // 仅 owner

// invariants: 仅 owner；task.status == Completed；!rated；stars ∈ [1,5]；触发 reputation 更新
function rateTask(bytes32 taskId, uint8 stars) external;

// === Buyer Agent operator ===
// invariants: 仅 agent.operator；agent.active；taskId 不可重复
function startTask(uint256 agentId, bytes32 promptHash, bytes32 salt)
  external returns (bytes32 taskId);

// invariants: 仅 operator；task.status == Open；tool.version == toolVersion；
//   tool.pricePerCall == expectedPrice；expectedPrice ≤ maxPerCall；
//   balance ≥ expectedPrice；dailySpent + price ≤ dailySpendCap（含 24h 滚动重置）
function pay(bytes32 taskId, uint256 toolId, uint64 toolVersion,
             uint128 expectedPrice, bytes32 inputHash)
  external returns (bytes32 receiptId, uint32 stepIdx);

// invariants: 仅 operator；task.status == Open
function completeTask(bytes32 taskId, bytes32 resultHash) external;

// invariants: 仅 operator 或 agent.owner；task.status == Open；emits TaskCancelled
function cancelTask(bytes32 taskId) external;

// === Provider middleware (atomic verify+consume，关闭 TOCTOU) ===
// invariants: 仅 tools[receipt.toolId].provider；!receipt.consumed；
//   receipt.inputHash == expectedInputHash；同一笔 tx 内置 consumed=true
function verifyAndConsumeReceipt(bytes32 receiptId, bytes32 expectedInputHash)
  external returns (bool ok);
```

**协议层硬约束（关键 invariant in pay()）**

```solidity
function pay(bytes32 taskId, uint256 toolId, uint64 toolVersion,
             uint128 expectedPrice, bytes32 inputHash)
  external returns (bytes32 receiptId, uint32 stepIdx)
{
    Task storage t = tasks[taskId];
    require(t.status == TaskStatus.Open, "task not open");
    Agent storage a = agents[t.agentId];
    Tool storage tool = tools[toolId];

    require(msg.sender == a.operator, "not operator");
    require(tool.enabled, "tool disabled");
    require(tool.version == toolVersion, "tool version mismatch");       // plan→execute 防漂移
    require(tool.pricePerCall == expectedPrice, "price mismatch");
    require(expectedPrice <= a.maxPerCall, "exceeds max per call");
    require(a.balance >= expectedPrice, "insufficient balance");

    // 滚动 24h 日花费上限（抗 operator key 泄露 drain）
    if (block.timestamp >= a.dailyResetAt + 1 days) {
        a.dailySpent = 0;
        a.dailyResetAt = uint64(block.timestamp);
    }
    require(a.dailySpent + expectedPrice <= a.dailySpendCap, "daily cap exceeded");
    a.dailySpent += expectedPrice;

    a.balance -= expectedPrice;
    a.totalSpent += expectedPrice;
    providerBalances[tool.payout] += expectedPrice;       // pull payment：无外部 call

    stepIdx = ++agentStepCounter[t.agentId];
    receiptId = keccak256(abi.encode(
        taskId, t.agentId, toolId, toolVersion, stepIdx,
        expectedPrice, inputHash, block.chainid, address(this)
    ));
    receipts[receiptId] = Receipt(taskId, t.agentId, toolId, toolVersion, stepIdx,
                                  expectedPrice, inputHash, uint64(block.timestamp), false);
    t.stepCount = stepIdx;
    emit ToolCallPaid(receiptId, taskId, t.agentId, toolId, expectedPrice);
}
```

**事件清单**

```
ToolRegistered(uint256 toolId, address provider, uint128 price, uint64 version)
ToolUpdated(uint256 toolId, uint128 newPrice, uint64 newVersion, bool enabled, bytes32 schemaHash)
ProviderWithdrawn(address provider, uint256 amount)

AgentCreated(uint256 agentId, address owner, address operator,
             uint128 maxPerCall, uint128 dailySpendCap)
AgentFunded(uint256 agentId, uint128 amount)
AgentWithdrawn(uint256 agentId, uint128 amount)
AgentOperatorChanged(uint256 agentId, address newOperator)
AgentDailySpendCapChanged(uint256 agentId, uint128 newCap)

TaskStarted(bytes32 taskId, uint256 agentId, bytes32 promptHash)
ToolCallPaid(bytes32 receiptId, bytes32 taskId, uint256 agentId, uint256 toolId, uint128 amount)
ReceiptConsumed(bytes32 receiptId)
TaskCompleted(bytes32 taskId, bytes32 resultHash)
TaskCancelled(bytes32 taskId)
TaskRated(bytes32 taskId, uint8 stars, uint16 newReputation)
ReputationUpdated(uint256 agentId, uint16 newReputation)
```

### 5.2 Passport.sol（Soulbound ERC-721 + ERC-8004 兼容）

```solidity
// 仅 Marketplace 合约能 mint / appendTask / updateReputation；transferFrom 全部 revert
function mint(address to, uint256 agentId) external returns (uint256 tokenId);    // onlyMarketplace
function appendTask(uint256 tokenId, bytes32 taskId) external;                    // onlyMarketplace
function updateReputation(uint256 tokenId, uint16 newReputation) external;        // onlyMarketplace

function tokenIdOf(uint256 agentId) external view returns (uint256);
function reputation(uint256 tokenId) external view returns (uint16);
function taskHistory(uint256 tokenId) external view returns (bytes32[] memory);
function tokenURI(uint256 tokenId) external view returns (string memory); // 链上 SVG + metadata

// ERC-8004 兼容接口（Trustless Agents）—— 让其他 marketplace 能跨平台读 reputation
function agentScore(uint256 tokenId) external view returns (uint256);     // 标准命名
function agentMetadata(uint256 tokenId) external view returns (bytes memory);
function supportsInterface(bytes4 interfaceId) external view returns (bool); // ERC-165 含 ERC-8004 ID
```

**为什么 Soulbound**：reputation 是 agent 自己挣来的，不应可转售。也避免 wash trading 攻击。

**为什么 ERC-8004 兼容**：Monad 官方推 ERC-8004 (Trustless Agents) 标准；实现 `agentScore` + `agentMetadata` + ERC-165 让其他 marketplace 能不用知道 AgentPay 的事情就直接读到 reputation——满足 PRD §6.3 "reputation 成为 agent 跨场景的身份资产"。

**部署后绑定**：Marketplace 构造函数接收 Passport 地址；Passport 用 `setMarketplace(addr)`（仅 deployer 一次性可调）授权 Marketplace 为唯一 writer。

### 5.3 部署顺序

```
1. forge create Passport.sol
2. forge create Marketplace.sol --constructor-args <passport_addr>
3. Passport.setMarketplace(<marketplace_addr>)    # 只有 Marketplace 能 mint / 改 reputation
```

---

## 6. 后端 (apps/api)

### 6.1 服务边界

| 角色 | 入口 | 职责 |
|---|---|---|
| **HTTP** | `routes/*.ts` | 认证、读 agent/tool/task 状态、入队任务、为前端组装 calldata |
| **Worker** | `worker/runTask.ts` | 从 BullMQ 拉任务，跑 plan→pay→call→integrate，发 SSE |
| **Chain Watcher** | `chain/watcher.ts` | block cursor backfill + viem `watchContractEvent` live tail + reorg 处理（详见下方）|
| **SSE Hub** | `sse/hub.ts` | Redis pub/sub broker，前端订阅 `task:<id>` channel；事件按单调 seq 持久化（§6.3）|

**Chain Watcher 流程**（任何一条都不能省）：

1. **Cursor 持久化**：`db.chain_cursor` 表存最后处理过的 `blockNumber`；启动时从 cursor 开始 backfill。
2. **Backfill**：`eth_getLogs` 拉 cursor → `head - finalityDepth` 的所有事件，按 `(blockNumber, logIndex)` 顺序写 cache，事务化 + idempotent upsert（PK = `txHash, logIndex`）。
3. **Live tail**：viem `watchContractEvent` 订阅新事件；每条事件检查 `blockNumber > head - finalityDepth` 才暴露给前端（未达 finality 不推 SSE）。
4. **Reorg 处理**：每 10 个块检查 cursor 附近 head 是否变了（block hash mismatch）；若发生 reorg，删除受影响块的 cache + 重新 backfill。
5. **Finality depth**：Monad testnet 默认值待测，初始用 5 个块。

### 6.2 LLMProvider 抽象

```typescript
interface LLMProvider {
  generatePlan(input: {
    taskPrompt: string;
    availableTools: ToolDescription[];
    budget: bigint;
    maxPerCall: bigint;
  }): Promise<Plan>;

  integrate(input: {
    taskPrompt: string;
    stepOutputs: StepOutput[];
  }): Promise<FinalDeliverable>;
}
```

**实现**：`DeepSeekProvider` (默认, OpenAI 兼容 SDK) → 后续可加 `AnthropicProvider` / `OpenAIProvider`。

DeepSeek 用 function calling 而非自由文本输出来生成 plan——schema 严格，校验便宜。

### 6.3 数据库 schema（核心表）

Schema 设计原则：链上是 source of truth；DB 是 cache + 链下大数据 + Worker 状态机持久化。**Worker 任何 on-chain 写操作之前都必须先持久化目标状态到 DB**，这样 BullMQ retry 可以读 DB 调和链上实际状态而不会盲目重发。

```
users          address PK, created_at

agents         id PK = on-chain agent_id, owner_address, operator_address,
               name, goal, current_reputation, ... 其余字段为链上 cache

tools          id PK = on-chain tool_id, provider_address, version, price_per_call,
               schema_hash, schema_json, endpoint, enabled, ...

tasks          id PK uuid, agent_id FK, on_chain_task_id bytes32 NULL,
               parent_task_id FK NULL,              -- "调整" 建立父子链；Worker 拉父链的 prompt+result 拼 LLM context
               status ENUM(pending, planning, executing, integrating, completed, failed),
               prompt TEXT,
               result_text TEXT,
               result_hash bytes32,
               plan_json JSONB,                     -- 单一 plan（open-loop），不存版本
               error TEXT,
               started_at, completed_at TIMESTAMP

tool_calls     id PK uuid, task_id FK, step_idx INT,
               tool_id, tool_version, amount,
               status ENUM(planned, paying, paid, invoking, ok, failed),
               tx_hash, receipt_id, attempt INT,
               input_json, input_hash, output_json, output_hash,
               http_status, provider_latency_ms, error,
               started_at, completed_at

task_events    id PK BIGSERIAL, task_id FK, seq INT NOT NULL,
               type, payload_json, created_at
               UNIQUE(task_id, seq)
               -- seq 用于 SSE Last-Event-ID 重连

ratings        agent_id, task_id, stars, created_at

chain_cursor   contract_address PK, last_processed_block, head_block, updated_at
               -- Watcher backfill/reorg 用

operator_keys  agent_id PK, encrypted_privkey BYTEA, key_version INT,
               kdf_params JSONB, rotated_at
               -- 每 agent 一把 burner key；用 KMS 主密钥加密 at rest
```

**为何 tasks 不直接用链上 taskId 当 PK**：用户提交时还没上链，需要先有本地 row 再生成 promptHash 调 `startTask()`。`on_chain_task_id` 是后写入的字段。

**parent_task_id 工作流**：用户在 Task #N 的 result 页点"调整" → 创建 Task #N+1 with `parent_task_id = N`。Worker 跑 #N+1 时拉 `(N.prompt, N.result_text)` 拼到 LLM system context："上一轮你做了 X，产物是 Y，这次用户要：…"——这就是多轮上下文，每个 task 仍 open-loop。`parent_task_id` 可成链：#N+2 → #N+1 → #N，Worker 默认回溯 3 层（防 context 爆掉）。

---

## 7. 前端页面清单（与当前代码命名对齐）

仓库布局: 当前是 flat Next.js（`app/` 顶层）。下表的"现状"列对应 `app/` 下已存在文件。

**P0 — Hackathon Demo 必须打磨**

| # | 路径 | 现状 | 用途 |
|---|---|---|---|
| 1 | `/` (`app/page.tsx`) | ✅ exists | 落地页（一句价值主张 + 两个 CTA） |
| 2 | `/agents/new` | ❌ 待建 | Agent 创建向导（一笔 `createAndFundAgent` tx）|
| 3 | `/agents/[agentId]` (`app/agents/[agentId]/page.tsx`) | ✅ exists | **Demo 核心**：三栏 Timeline 执行视图（agent state / Timeline / marketplace 卡片 / Deliverable）；agent 永远展示当前/最近一个 task。完成后内嵌"调整 / 复制 / ⭐ 评分"按钮 |
| 4 | `/tasks/[taskId]` (`app/tasks/[taskId]/page.tsx`) | ✅ exists | 公开 audit 视图：PaymentReceipt 事件表、链上 tx 链接、给评委 / 第三方还原 task 用 |
| 5 | `/marketplace` | ❌ 待建 | Tool 全列表（无搜索/筛选） |
| 6 | `/provider/tools/new` | ❌ 待建 | Provider 注册表单（独立向导）|
| 7 | Connect Wallet Modal | ❌ 待建 | SIWE 流程 |

**P1 — Alpha 阶段补齐**

| # | 路径 | 用途 |
|---|---|---|
| 8 | `/agents` (`app/agents/page.tsx` ✅) | Agent 列表 + 创建入口 |
| 9 | `/agents/[id]/new-task?parent=<taskId>?` | 新任务提交页（支持 parent 链）|
| 10 | `/provider` (`app/provider/page.tsx` ✅) / `/provider/tools/[id]` / `/provider/earnings` | Provider 控制台 |
| 11 | `/tools/[id]` | Tool 公开详情页 |

**关键 UX 性质**：
- `/agents/[agentId]` 是"agent 当前在干嘛"的实时仪表盘（**fire-and-forget**，提交后用户不再介入）
- 三栏布局：左 Policy wallet / 中 Task Timeline / 右 marketplace + Deliverable
- SSE 推每个事件；断网用 `Last-Event-ID` 重连，丢的事件用 `GET /api/tasks/:id/events?after=<seq>` 补发
- 完成后右下展开最终交付物 + 三个按钮：
  - **调整**：跳转 `/agents/[id]/new-task?parent=<taskId>`，输入框预填"基于上一轮…"，提交后新 task 携带 `parent_task_id` 进队
  - **复制**：复制产物到剪贴板
  - **⭐ 评分**：链上 `rateTask`，更新 reputation
- `/tasks/[taskId]` 是任务完成**后**给第三方/评委看的链上证据视图，不是执行视图

---

## 8. 前后端 API

### 8.1 REST（所有写操作返回 calldata，前端用 wagmi 签）

**Auth (SIWE)**

```
POST /api/auth/nonce              → { nonce }
POST /api/auth/verify             body: { message, signature } → set-cookie JWT
```

**Agent**

```
GET   /api/agents
POST  /api/agents/prepare-create        body: { name, goal, totalBudget, maxPerCall }
                                        → { calldata, value }
POST  /api/agents/:id/prepare-fund      body: { amount } → { calldata, value }
POST  /api/agents/:id/prepare-withdraw  → { calldata }
GET   /api/agents/:id
```

**Task**

```
POST  /api/agents/:id/tasks             body: { prompt, parentTaskId? } → { taskId }   # 入队，立即返回
GET   /api/tasks/:id                    → 当前快照（含 plan + parent chain summary）
GET   /api/tasks/:id/stream             # SSE，可选 ?after=<seq> 跳过已收事件
GET   /api/tasks/:id/events?after=<seq> # 重连补发：返回 seq > after 的所有 task_events
POST  /api/tasks/:id/prepare-rate       body: { stars } → { calldata }
```

**Provider**

```
GET   /api/provider/tools
POST  /api/provider/tools/prepare-register   body: { name, endpoint, schema, price, description, payout }
                                             → { calldata }
PATCH /api/provider/tools/:id/prepare-update body: { price?, enabled? } → { calldata }
GET   /api/provider/tools/:id/stats
POST  /api/provider/earnings/prepare-withdraw → { calldata }
```

**Public**

```
GET /api/marketplace/tools
GET /api/tools/:id
```

### 8.2 SSE 事件 schema

每条事件 envelope 都带 `{ seq: number, taskId: string, type, ...payload }`；`seq` 单调递增，前端 EventSource 用 `Last-Event-ID` header 重连，后端按 seq 续推。

```typescript
type TaskEvent =
  | { type: 'plan.generated';      steps: PlanStep[] }
  | { type: 'tool.discovered';     tools: ToolSummary[] }
  | { type: 'tool.call.started';   stepIdx: number; toolId: string; amount: string }
  | { type: 'payment.confirmed';   stepIdx: number; txHash: string; receiptId: string }
  | { type: 'tool.call.completed'; stepIdx: number; outputSummary: string }
  | { type: 'tool.call.failed';    stepIdx: number; reason: string }
  | { type: 'integration.started' }
  | { type: 'task.completed';      resultHash: string; deliverable: object }
  | { type: 'task.failed';         reason: string };
```

---

## 9. ⭐ Buyer Agent ↔ Provider Tool 调用协议

**请求**（Worker → Provider）：

```http
POST {tool.endpoint}
Content-Type: application/json
X-AgentPay-Receipt:    0x{receiptId}        # Marketplace.pay() 返回的 receiptId
X-AgentPay-Agent-Id:   {agentId}            # uint，与合约一致；不是地址
X-AgentPay-Tool-Id:    {toolId}             # uint
X-AgentPay-Step:       {stepIdx}            # task 内顺序，方便 Provider 排错
X-AgentPay-Input-Hash: 0x{keccak256(body)}  # Provider 校验 body 未被中间篡改

{ "input": { ...JSON-Schema-validated input... } }
```

**Provider 服务**（用 `@agentpay/provider-middleware`）：

1. 读 5 个 header；本地 `keccak256(rawBody)` 与 `X-AgentPay-Input-Hash` 比对
2. 通过 viem 调 **原子** `Marketplace.verifyAndConsumeReceipt(receiptId, expectedInputHash)` → bool
   - 同一笔 tx 内 verify + consume，关闭 TOCTOU；onlyProvider modifier 防 griefing
3. 通过：业务逻辑 → `200 { "output": {...} }`
4. 不通过：`402 Payment Required` + `WWW-Authenticate: AgentPay tool={toolId} price={price}`

### 9.1 Tool Descriptor 格式（MCP 兼容字段清单）

Provider 注册时把以下 JSON 上传 IPFS，把 hash 写入 `Tool.schemaHash`。Worker 调用前 fetch + 校验。

```json
{
  "name": "copywriter-pro",
  "version": "1.2.0",
  "description": "Generate marketing copy in <140 chars.",
  "inputSchema":  { "$schema": "https://json-schema.org/draft/2020-12/schema",
                    "type": "object", "properties": {...}, "required": [...] },
  "outputSchema": { "type": "object", "properties": {...}, "required": [...] },
  "annotations": { "tags": ["copywriting", "marketing"],
                   "languages": ["en", "zh"] }
}
```

字段定义与 MCP 的 ToolDescriptor 子集对齐——这是"MCP 兼容"的具体所指。Worker 用 `inputSchema` 在调用前校验、`outputSchema` 在接收后校验。

### 9.2 "已付款 + Provider 故障"是协议正常状态

预扣模型的代价：Worker 一旦调用 `pay()`，钱已经从 agent.balance 扣除并记到 `providerBalances[payout]`。若 Provider 之后 5xx / 超时 / 返回 schema 非法 output，**这次调用已付款但失败**——这是协议设计的取舍，**符合 PRD §10"无退款"约束**，不是 bug。Worker 把该 step 标 `failed`、决定是否整体 task.failed、或跳过该 step 继续后续 plan。

### 9.3 为何预扣不是 x402

x402 是"先打、被 402 后付"的反应式握手；我们是"先付拿 receipt 再打"的预扣式。预扣模型为 agent commerce 优化——agent 在 plan 阶段已决定要调用，预扣省一次 round trip 且让链上事件天然按调用顺序排列。x402 风格的 `402 + WWW-Authenticate` 作为未付款时的兼容回退保留。

---

## 10. Agent Worker 流水线

### 10.1 任务状态机

```
pending → planning → executing → integrating → completed
                ↘             ↘             ↘
                  failed        failed        failed
```

每次状态转换都写 `tasks.status` + 写 `task_events`（带 monotonic seq）。

### 10.2 Step 子状态机

每个 tool call 在 `tool_calls` 表里独立持久化：

```
planned → paying ─tx broadcast→ paid ─verifyAndConsume on Provider→ invoking → ok
                       ↘ (revert)                                            ↘
                         failed                                                failed
```

**每个状态转换前先写 DB**——`tx_hash` 在 broadcast 前就持久化（用临时 hash 占位、broadcast 后回填）；`receiptId` 在等待确认前就先写。这样 Worker 崩溃重启后能读 DB 调和链上状态决定下一步，**不会盲发第二次 pay()**。

### 10.3 主循环

```
[BullMQ 拉到 taskId]
   ↓
[reconcile：扫该 task 的 tool_calls，若有 status=paying 行，按 tx_hash 查链上确认状态]
   ↓
[读 task.prompt + parent_task 链 (≤3 层) → 拼 LLM context]
   ↓
[读 agent policy + 当前 marketplace tools（含 version 锚定）]
   ↓
[LLMProvider.generatePlan(...) → Plan {steps:[{toolId, toolVersion, input, expectedPrice}]}]
   ↓
[本地校验: ∀ price ≤ maxPerCall AND sum(price) ≤ balance AND sum(price) ≤ dailySpendCap 剩余]
   ↓ 失败 → tasks.status=failed; emit task.failed("plan exceeds budget"|"plan invalid")
[链上: Marketplace.startTask(agentId, promptHash, salt) → taskId]
[for step in plan:]
   ├─ tool_calls.status = planned → 写 row
   ├─ emit tool.call.started
   ├─ inputHash = keccak256(canonical(input))
   ├─ tool_calls.status = paying → 写 (写在 broadcast 之前！)
   ├─ tx = Marketplace.pay(taskId, toolId, toolVersion, expectedPrice, inputHash)
   ├─ tool_calls.tx_hash = tx; await tx receipt
   ├─ if revert → tool_calls.status = failed; tasks.status=failed; emit task.failed; break
   ├─ tool_calls.status = paid, receipt_id = txReturn.receiptId
   ├─ emit payment.confirmed
   ├─ tool_calls.status = invoking
   ├─ HTTP POST tool.endpoint with 5 headers (§9)
   ├─ on 200 + valid output → tool_calls.status = ok, output_json/hash 写入
   ├─ on 5xx / 4xx / timeout / schema invalid → tool_calls.status = failed
   │      → MVP: tasks.status=failed; emit task.failed; break
   │      → P2: 跳过该 step 继续 OR Worker 让 LLM 在剩余 plan 里替换 tool（仍 open-loop，因为这是错误恢复不是 replan）
   └─ emit tool.call.completed
[LLMProvider.integrate(stepOutputs) → finalDeliverable]
   ↓
[resultHash = keccak256(canonical(deliverable))]
[链上: Marketplace.completeTask(taskId, resultHash)]
   ↓
[tasks.status = completed; emit task.completed]
```

### 10.4 容错矩阵

| 故障 | 处理 |
|---|---|
| Worker 进程崩溃 | BullMQ 重新分发；新进程先 reconcile 已有 tool_calls 行——`paying` 行查 tx 状态再决定续跑/标失败，**不重发 pay()** |
| `pay()` 链上 revert（价格漂移/版本不匹配/dailyCap）| `tool_calls.failed`；task 整体 failed；剩余预算保留 |
| RPC 超时（pay broadcast 后不知是否上链）| Worker 用 tx_hash 轮询；超 N 秒未确认 → 进入 `paying` 长等状态，超 M 秒标 failed（人工介入查链）|
| Tool HTTP 失败 | 已付款（§9.2 协议正常状态）；MVP 直接 task.failed |
| Provider 返回非 schema 合规 output | 同 HTTP 失败 |
| LLM plan 超预算/单次上限 | 本地校验 catch，task.failed("plan exceeds budget") |
| 用户点"调整"创建子 task | 与本 task 无关；子 task 是独立任务，并发执行（如果用户愿意）|

### 10.5 Worker 用谁的钱包签 `pay()` tx

合约里 `Agent.operator` 字段与 `owner` 分离——`pay()` 仅 operator 可调，资金/取款/打分仅 owner 可调。再叠加 §5.1 的 `dailySpendCap` 限制 operator-key 泄露的 drain 速率。

**MVP 直接走 per-agent burner（不做共享 global key）**：
- `createAndFundAgent` 前，**后端为该 agent 生成一把 burner key**，私钥用 KMS 主密钥（hackathon 阶段用 env var 派生）AES-GCM 加密后写入 `operator_keys` 表。
- 公钥地址作为 `operator` 传入合约。
- Worker 跑该 agent 的任务时，从 DB 拉密文 + 内存中解密 + 签 tx，签完即丢；私钥不留内存。
- 一把 key 被攻陷只能 drain 一个 agent，且受 `dailySpendCap` 二次限制。

**Alpha 升级路径**：把 KMS 主密钥从 env var 切到 AWS KMS / Hashicorp Vault，加密层不动；或前端生成 burner 私钥后用 owner 钱包签名加密上传（自管模式）。合约不需改。

---

## 11. 数据：链上 vs 链下

| 数据 | 位置 | 理由 |
|---|---|---|
| 资金、agent policy、tool 注册、receipt、reputation | 链上 | 协议中立性、第三方可验证 |
| Task prompt、tool I/O 原文、Timeline 文本、整合后产物 | Postgres | 写链贵、隐私敏感 |
| Task 完成的 `resultHash` | 链上事件 | 满足"产物未被篡改"可验证 |
| Tool I/O schema | 链上 IPFS hash + 链下 cache | schema 不大但需要版本管控 |

---

## 12. 部署

| 组件 | 平台 | 备注 |
|---|---|---|
| Web | Vercel | Next.js 原生支持 |
| API + Worker | Fly.io | 单 app，shared volume 不需要 |
| Postgres | Neon | Free tier 1GB |
| Redis (BullMQ + SSE pub/sub) | Upstash | Free tier 10k cmd/day |
| 合约 | Monad testnet | Foundry script 部署 |
| IPFS (tool schema) | Pinata 或 web3.storage | Free tier |

---

## 13. 实施排序

**Phase 0：脚手架（半天）**

- `git init`, monorepo 配置, Biome, turbo, Vitest, Foundry
- DB schema 草稿、合约接口草稿
- 钱包连接 + SIWE 跑通

**Phase 1：合约 + Provider 单链路（2 天）**

- Marketplace + Passport 合约 + Foundry 测试（含 pull payment / receipt 绑定 / dailySpendCap / 状态机访问控制）
- 部署到 Monad testnet
- **`@agentpay/provider-middleware` 骨架版**（Fastify 一个 adapter，含 verifyAndConsume）——Worker 第一次端到端测试就要用
- 1 个 echo provider 服务（用 middleware）
- `provider/tools/new` 页 + register tool API
- Marketplace 页能列出 tool

**Phase 2：End User 端 + Worker（2-3 天）**

- `agents/new` 创建+充值（含后端生成 burner key 写 `operator_keys`）
- Worker plan/pay/call/integrate 完整流水线（含 §10 状态机 + reconcile + tx_hash 持久化）
- SSE Timeline UI（含 seq + Last-Event-ID 重连）
- 交付物展示页 + 打分
- "调整"按钮 + `parent_task_id` 父子链 context 拼接（多轮上下文）

**Phase 3：真 Provider 接入 + 多 tool 演出（1 天）**

- Express adapter 补齐 provider-middleware
- 2-3 个真实 Provider（Copywriter 用 DeepSeek、Image Gen 用某 API、Translator 用某 API）
- Worker 跑真任务，调通 plan→pay→call→integrate

**Phase 4：抛光 + Demo 视频（1 天）**

- Passport NFT 链上 SVG 美化
- Reputation 显示动画
- 录 demo + 部署 prod URL

**累计 6.5-7.5 天**；与"Hackathon Demo + 1-2 周到 alpha"节奏一致。

---

## 14. 已知开放问题

1. **DeepSeek 的 plan 质量**：需要在 Phase 2 早期跑几个真实任务验证。如不够好，切 Claude / GPT。
2. **Monad testnet 出块速度与 finality**：影响 SSE 推 `payment.confirmed` 的延迟体感。需测。
3. **Worker burner key 管理**（Phase 2 末）：MVP 用 API 共享 hot wallet；Alpha 必须每 agent 独立。
4. **Tool schema 校验**：MCP-style JSON Schema 在 plan 输入和 Provider 输出两侧都要做。用 Ajv 还是 zod？
5. **SSE 在 Fly.io 长连接稳定性**：备选 Long-polling fallback。

---

## 15. OUT OF SCOPE（与 PRD §10 对齐）

不实施任何形式的：争议仲裁 / 退款机制、内容审核 / 黑名单、KYC / AML、跨链桥、复杂 marketplace 搜索（关键词 / tag / 排序）、closed-loop adaptive replanning、用户真实身份。

任何提案如果涉及上述能力，必须先在 OpenSpec proposal 里说明为何破例。
