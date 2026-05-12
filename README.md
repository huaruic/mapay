# mapay · AgentPay Passport

> A2A lets agents talk. **AgentPay Passport lets agents transact.**
>
> 给 AI agent 一笔链上预算，它自己跑去全网 AI 服务市场买工具、做活、交付——你只发指令和验收，越用越懂你。

AgentPay Passport 是一个面向 autonomous AI agents 的 **Monad-native paid AI service marketplace**：

- Provider 把 AI 能力上架为 **MCP-compatible paid tool**，定价、发现、支付凭证、收入结算全部走协议层
- End User 创建一个携带预算与 max-per-call 的 **Buyer Agent**，提交目标后无需任何人工签名，agent 自主发现、支付、调用、整合产物
- 预算约束在合约 `pay()` 内 `require()`，**LLM 无法绕过**
- Passport NFT 是 **ERC-8004-compatible + Soulbound ERC-721**，跨平台 reputation 资产

> Monad Blitz @ 上海 V2 参赛项目。

---

## 当前状态（2026-05-12）

| 模块 | 状态 |
|---|---|
| 产品 PRD | ✅ `agentpay-passport-prd.md` |
| 技术架构 | ✅ `docs/superpowers/specs/2026-05-12-agentpay-architecture-design.md` |
| OpenSpec 第一个变更 | ✅ `openspec/changes/add-marketplace-and-provider-onboarding/` |
| 前端 UI scaffold | ✅ Next.js 16 + Tailwind v4，7 个页面 mock（未接 web3、未接 API） |
| Solidity 合约 | 🚧 `contracts/src/Marketplace.sol` · `Passport.sol` · Foundry tests |
| 后端 API | 🚧 `api/` Fastify scaffold |
| Provider SDK | 🚧 `provider-sdk/` |
| 部署到 testnet | ❌ 未上链 |

---

## 技术栈

| 层 | 选型 |
|---|---|
| 链 | Monad testnet (chain id 10143, MON) |
| 合约 | Solidity 0.8.20 + Foundry + OpenZeppelin v5 + via_ir + Cancun EVM |
| Passport NFT | ERC-8004 + Soulbound ERC-721 |
| 后端 | Node 22 + TS + Fastify + viem v2 + BullMQ + Upstash Redis |
| DB | Postgres (Neon) + Drizzle ORM |
| LLM | DeepSeek（OpenAI 兼容 API）；预留 LLMProvider 抽象 |
| 前端 | Next.js 16 + React 19 + Tailwind v4 + wagmi v2 + viem + RainbowKit + TanStack Query + Zustand + react-hook-form + zod |
| 部署 | Vercel (web) + Fly.io (api+worker) + Neon (db) + Upstash (redis) + Pinata (IPFS) |

完整决策清单见 `openspec/config.yaml`。

---

## 仓库布局

仍处于 flat 阶段，不使用 pnpm workspaces：

```
.
├── app/                    Next.js App Router 页面
├── components/             共享 UI 组件 (AppShell, Metric, Field, ...)
├── lib/                    mock-data, wagmi, providers, chains
├── contracts/              Foundry 工程（Marketplace, Passport + tests）
├── api/                    Fastify scaffold（DB + routes + tests）
├── docs/                   架构 spec
├── openspec/               规范驱动变更 proposals
└── test/                   前端 vitest 测试
```

---

## 前端路由

| 路径 | 用途 |
|---|---|
| `/` | 落地页 |
| `/marketplace` | 公开 tool 全列表（无搜索/筛选/排序，PRD §10） |
| `/marketplace/[toolId]` | Tool 详情：manifest、MCP schema、receipt 证据 |
| `/agents` | 我的 Buyer Agent 列表 |
| `/agents/[agentId]` | Agent 执行视图（三栏 Timeline，demo 核心） |
| `/provider` | Provider 控制台：tools / revenue / withdraw |
| `/provider/tools/new` | 上架 paid tool 表单 |
| `/tasks/[taskId]` | 公开 task audit 视图，第三方可还原链上证据 |

---

## 快速开始

需要 Node 22+。

```bash
npm install
npm run dev        # http://localhost:3000
```

其它命令：

```bash
npm run build      # production build
npm run start      # production server
npm run lint       # tsc --noEmit
npx vitest run     # 前端测试
```

Foundry 合约：

```bash
cd contracts
forge build
forge test
```

---

## 不可破坏的产品约束

- **No human-in-the-loop during agent execution.** 提交后 agent 自主跑完。
- **Budget enforcement is protocol-level.** 合约 `pay()` 内 `require()`。
- **Provider ↔ End User pseudonymity.** 只通过协议交互。
- **Open-loop planning only.** 多轮通过 `parent_task_id` 父子链。
- **Marketplace 全列表，不搜索 / 不筛选 / 不排序。**
- **Single chain (Monad).**
- 不做 dispute / refund / KYC / moderation。

---

## 进一步阅读

- [`agentpay-passport-prd.md`](./agentpay-passport-prd.md) — 产品需求（权威）
- [`docs/superpowers/specs/2026-05-12-agentpay-architecture-design.md`](./docs/superpowers/specs/2026-05-12-agentpay-architecture-design.md) — 技术架构
- [`openspec/config.yaml`](./openspec/config.yaml) — 已敲定决策清单
- [`CLAUDE.md`](./CLAUDE.md) — 给 AI 编码协作者的项目导航
