# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current State (2026-05-12)

| 块 | 状态 |
|---|---|
| 产品 PRD | ✅ `agentpay-passport-prd.md` — 权威需求 |
| 技术架构 doc | ✅ `docs/superpowers/specs/2026-05-12-agentpay-architecture-design.md` — 经 Codex review + 多轮迭代后的事实 |
| OpenSpec 第一个变更 | ✅ `openspec/changes/add-marketplace-and-provider-onboarding/`（validated）|
| 前端 UI scaffold | ✅ Next.js 16 + Tailwind v4，5 个页面 mock 完成（`app/`, `components/`, `lib/mock-data.ts`）；**未接 web3、未接 API** |
| 合约 | ❌ 未开始 |
| 后端 API + Worker | ❌ 未开始 |
| Provider SDK | ❌ 未开始 |
| Git | ✅ 已 init |

**任何写代码之前先读 PRD + design doc + `openspec/config.yaml`。这三份是 source-of-truth。**

`agentpay-passport-tech-stack.md` 是 codex 早期生成的视角，部分决策已被 hybrid review 覆盖——**以 `openspec/config.yaml` 的 "已敲定的技术栈与架构决策" 段为准**。

## Product One-Liner (Pitch 用)

> "给 AI agent 一笔链上预算，它自己跑去全网 AI 服务市场买工具、做活、交付——你只发指令和验收，越用越懂你。"
>
> "AgentPay Passport is MPP-aligned. MPP standardized how an agent pays. We added what the agent decides, where it discovers, and how it remembers."

## Tech Stack (locked)

| 层 | 选型 |
|---|---|
| 链 | Monad testnet (chain id 10143, MON) |
| 合约 | Solidity 0.8.20 + Foundry + OpenZeppelin v5.x + via_ir + Cancun EVM |
| Passport NFT | **ERC-8004 兼容 + Soulbound ERC-721**（跨平台 reputation 可读）|
| 后端 | Node 22 + TS + Fastify + viem v2 + BullMQ + Upstash Redis（API 与 Worker 同进程）|
| DB | Postgres (Neon) + Drizzle ORM |
| LLM | DeepSeek（OpenAI 兼容 API）；预留 LLMProvider 抽象切 Claude/GPT |
| 前端 | Next.js 16 + React 19 + Tailwind v4 + lucide-react + (将装) wagmi v2 + viem + RainbowKit + TanStack Query + Zustand + react-hook-form + zod |
| 仓库布局 | **当前 flat**：`app/` `components/` `lib/` `contracts/`（待建）`api/`（待建）`provider-sdk/`（待建）。不引入 pnpm workspaces / Turbo |
| 部署 | Vercel (web) + Fly.io (api+worker) + Neon (db) + Upstash (redis) + Pinata (IPFS schema) |

## Non-Negotiable Product Constraints

- **No human-in-the-loop during agent execution.** 提交任务后 agent 自主跑完；只有创建/充值、提现、打分需要签名。
- **Budget enforcement is protocol-level.** 合约 `pay()` 内 `require()`，LLM 无法绕过。
- **Provider ↔ End User pseudonymity.** 双方只通过协议交互。地址级别可见，不要暴露任何 PII。
- **Open-loop planning only.** 每个 task plan 一次性生成；多轮通过 `parent_task_id` 父子链解决，每个 task 内部仍 open-loop。
- **MCP-compatible tool schemas + 预扣式 payment gate（MPP/x402 兼容）.**
- **Marketplace 全列表无搜索/筛选/排序.**
- **Single chain (Monad).**
- **No dispute, refund, KYC, moderation.**

## MVP Acceptance Targets (PRD §9)

- Provider：首次访问 → 上架 ≤ 10 min；可看 calls/revenue；可 withdraw
- End User：首次访问 → 看到交付物 ≤ 5 min；提交到看结果之间无任何输入
- 第三方可从 block explorer 还原一次 task 的全部支付+调用历史
- Passport 是独立链上资产，其他 marketplace 可读

## 关键路由约定（与代码一致，不要再改）

| 概念 | 路径 |
|---|---|
| 落地页 | `/` |
| 我的 agent 列表 | `/agents` |
| Agent 执行视图（Timeline 三栏）| `/agents/[agentId]` ← Demo 核心 |
| 公开任务 audit 视图 | `/tasks/[taskId]` ← 给评委 / 第三方还原链上证据 |
| Marketplace 公开列表 | `/marketplace`（待建）|
| Provider 控制台 | `/provider` |
| Provider 注册新 tool | `/provider/tools/new`（待建）|

## 当前可用命令

```bash
npm run dev    # Next.js dev server (port 3000)
npm run build  # Next.js production build
npm run start  # Next.js production server
npm run lint   # tsc --noEmit （目前的 lint = type check）
```

## 工作流

- Hackathon 项目：偏向 shippable end-to-end vertical slices，不追求横向完整
- 每个新功能走 OpenSpec change proposal（即使是小变更也建一个）
- 修改 design doc 时同步更新 CLAUDE.md 关键路由约定
- 合约改动必须先过 Foundry 测试；API 改动必须先确定 TS 接口 schema
- 提交前 `npm run lint` 必须 clean

## 文件导航

- `agentpay-passport-prd.md` — 产品需求（不改）
- `docs/superpowers/specs/2026-05-12-agentpay-architecture-design.md` — 技术架构（演进时同步）
- `openspec/config.yaml` — 已敲定的决策清单
- `openspec/changes/*/` — 每个变更的 proposal + tasks + spec
- `agentpay-passport-tech-stack.md` — codex 早期视角，**不再维护**
- `AGENTS.md` — codex 用的项目导航（与本文件并行存在，内容应保持一致）
