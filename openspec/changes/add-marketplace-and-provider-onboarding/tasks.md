# Tasks · add-marketplace-and-provider-onboarding

## Phase 0 — 仓库脚手架 (0.5 day)

- [ ] `git init` 并接入 GitButler；`.gitignore` 含 `node_modules/`, `.env*`, `out/`, `dist/`, `.next/`, `lib/`, `cache/`, `broadcast/`
- [ ] 初始化 monorepo：`apps/web`、`apps/api`、`packages/contracts`、`packages/shared`、`packages/provider-sdk`
- [ ] pnpm workspaces 配置（`pnpm-workspace.yaml`）
- [ ] Turbo 配置（`turbo.json`：build / test / lint / dev pipelines）
- [ ] Biome 配置取代 eslint + prettier（`biome.json`）
- [ ] 根目录 Vitest 配置 + 各 package 共享 preset
- [ ] Foundry 初始化在 `packages/contracts`（`forge init --no-commit`）
- [ ] 根 CLAUDE.md 补 monorepo 导航说明 + 每个 package 的角色 1 行

## Phase 1.1 — Solidity 合约 (1.5 day)

### Marketplace.sol 存储与基础

- [ ] 定义 `Tool` struct（含 `version` `uint64`）+ `tools` mapping + `nextToolId`
- [ ] 定义 `Agent` struct（含 `operator` `dailySpendCap` `dailySpent` `dailyResetAt`）+ `agents` mapping
- [ ] 定义 `TaskStatus` enum + `Task` struct + `tasks` mapping
- [ ] 定义 `Receipt` struct + `receipts` mapping + `agentStepCounter` mapping
- [ ] 定义 `providerBalances` mapping

### Marketplace.sol 函数

- [ ] `registerTool` — provider 注册新 tool，version=1
- [ ] `updateTool(toolId, newPrice, enabled, newSchemaHash)` — onlyProvider, version++
- [ ] `withdrawProvider(amount)` — CEI + nonReentrant + balance check
- [ ] `createAndFundAgent(maxPerCall, dailySpendCap, operator, name, goal)` — payable, mint Passport NFT
- [ ] `fundAgent(agentId)` — payable, onlyOwner
- [ ] `withdrawAgentBalance(agentId, amount)` — onlyOwner, CEI
- [ ] `setAgentOperator(agentId, newOperator)` — onlyOwner
- [ ] `setAgentDailySpendCap(agentId, newCap)` — onlyOwner
- [ ] `startTask(agentId, promptHash, salt)` — onlyOperator, 写 Task struct
- [ ] `pay(taskId, toolId, toolVersion, expectedPrice, inputHash)` — 含 §5.1 全部 invariants（operator / status / version / price / maxPerCall / balance / dailyCap 滚动重置）
- [ ] `completeTask(taskId, resultHash)` — onlyOperator, status Open→Completed
- [ ] `cancelTask(taskId)` — operator 或 owner, status Open→Cancelled
- [ ] `verifyAndConsumeReceipt(receiptId, expectedInputHash)` — onlyProvider, atomic verify + consume
- [ ] `rateTask(taskId, stars)` — onlyOwner, status==Completed, !rated, 1≤stars≤5, 调 Passport.updateReputation

### Marketplace.sol 事件
- [ ] 完整 §5.1 末尾事件清单 emit 在对应函数

### Passport.sol
- [ ] ERC-721 + Soulbound（override _update 让 transfer revert）
- [ ] `onlyMarketplace` modifier；`setMarketplace(addr)` 仅 deployer 一次性可调
- [ ] `mint(to, agentId)` `appendTask(tokenId, taskId)` `updateReputation(tokenId, newRep)`
- [ ] `tokenIdOf` `reputation` `taskHistory` view 函数
- [ ] `tokenURI` 链上 SVG（简版：显示 agent name + reputation 数字即可）

### Foundry 测试 (test/)
- [ ] `Marketplace_RegisterTool.t.sol`：注册成功、version 自增、非 provider revert
- [ ] `Marketplace_PullPayment.t.sol`：pay 累加 providerBalances；withdrawProvider 安全；超额 revert；reentrancy 攻击合约失败
- [ ] `Marketplace_Receipt.t.sol`：receipt id 包含所有字段；重放 consumed revert；非 provider consume revert；inputHash 不匹配 revert
- [ ] `Marketplace_DailyCap.t.sol`：超 dailyCap revert；warp 24h 后 dailySpent 重置；maxPerCall 与 dailyCap 联动
- [ ] `Marketplace_ToolVersion.t.sol`：update 后 version++；pay 传旧 version revert
- [ ] `Marketplace_AccessControl.t.sol`：非 owner 调 owner-only / 非 operator 调 operator-only / 非 provider 调 provider-only 全部 revert
- [ ] `Passport_Soulbound.t.sol`：transferFrom revert；非 marketplace 调 mint / updateReputation revert

### 部署
- [ ] `script/Deploy.s.sol`：先 deploy Passport → deploy Marketplace(passportAddr) → Passport.setMarketplace(marketplaceAddr)
- [ ] 部署到 Monad testnet（RPC URL + chain id 写 .env.example）
- [ ] ABI 输出到 `packages/shared/abi/` 并提交

## Phase 1.2 — 后端 API (1 day)

### DB
- [ ] Drizzle ORM 配置；连 Neon
- [ ] Migration 0001: `users`, `agents`, `tools`, `chain_cursor`, `operator_keys`
- [ ] Drizzle schema 文件 + 类型生成

### Chain layer
- [ ] viem PublicClient (Monad testnet) + WalletClient（仅 server-side 用于 ops）
- [ ] ABI import 从 `packages/shared/abi/`
- [ ] `chain/watcher.ts`：cursor 持久化 + backfill (`eth_getLogs` 分批) + live tail (`watchContractEvent`) + reorg 检测 + finality depth 5
- [ ] Watcher 订阅 `ToolRegistered` `ToolUpdated` → upsert tools cache（PK: txHash + logIndex idempotent）

### 路由
- [ ] Fastify 启动 + plugin 体系（cors / cookie / jwt / siwe）
- [ ] `POST /api/auth/nonce` → 生成 + 存 Redis 5min TTL
- [ ] `POST /api/auth/verify` → SIWE 验签 + set JWT cookie
- [ ] `POST /api/provider/tools/prepare-register` → 验 JWT + 构造 calldata（用 viem encodeFunctionData）+ 返回 `{ to, data, value: 0 }`
- [ ] `GET /api/marketplace/tools?cursor=&limit=` → 从 tools 表分页
- [ ] `GET /api/tools/:id` → 单 tool 详情，包含 IPFS schema_json fetch + cache

### 测试
- [ ] Vitest 集成测试：起内存 SQLite + mocked viem，测 register tool 端到端写 DB

## Phase 1.3 — Provider SDK 骨架 (0.5 day)

- [ ] `packages/provider-sdk/src/fastify.ts`：导出 `agentPay({ marketplaceAddr, rpcUrl, toolId, providerAddress })` Fastify plugin
- [ ] Plugin 在 onRequest hook 中读 5 个 header
- [ ] 本地算 `keccak256(rawBody)` 与 `X-AgentPay-Input-Hash` 比对
- [ ] viem 调 `verifyAndConsumeReceipt` 并捕获 revert reason
- [ ] 通过 → `req.agentPay = { receiptId, agentId, stepIdx }` 注入；不通过 → reply.code(402).header('WWW-Authenticate', `AgentPay tool=${toolId} price=${price}`).send()
- [ ] Vitest：mock viem client，覆盖 happy / 重放 revert / inputHash mismatch / 非 provider / RPC 超时

## Phase 1.4 — 前端 (1.5 day)

- [ ] Next.js 15 App Router + Tailwind v4 + shadcn/ui 初始化
- [ ] wagmi v2 + RainbowKit 配置；Monad testnet `Chain` 定义到 `packages/shared/chains.ts`
- [ ] `lib/api.ts`：fetch wrapper 带 JWT cookie
- [ ] `lib/sse.ts`：EventSource wrapper + Last-Event-ID 重连
- [ ] `app/page.tsx`：落地页（hero + 一句价值 + Become Provider / Try as End User CTA）
- [ ] `app/(auth)/connect-wallet`：弹 RainbowKit modal → SIWE flow → 跳目标页
- [ ] `app/provider/tools/new/page.tsx`：表单（react-hook-form + zod schema）
  - 字段：name, description, endpoint URL, JSON Schema (Monaco editor), price (MON, 用 viem parseEther), payout address (default = connected wallet)
  - 提交流程：(1) POST schema JSON to Pinata 拿 hash → (2) POST `/api/provider/tools/prepare-register` 拿 calldata → (3) wagmi `sendTransaction` 钱包签 → (4) wait tx → (5) 轮询 marketplace 直到看到新 tool → 跳详情页
- [ ] `app/marketplace/page.tsx`：tool 卡片墙，shadcn Card；分页 20/页
- [ ] `app/tools/[id]/page.tsx`：单 tool 详情，展示 schema + 调用价格 + Provider 地址

## Phase 1.5 — 集成 + 部署 + 冒烟

- [ ] Echo Provider 服务（`apps/echo-provider/`，单独 Fly.io app）：用 `@agentpay/provider-middleware`，echo input 回去
- [ ] 手动跑一次：连钱包 → 注册 echo tool → 链上 ToolRegistered → marketplace 列表显示
- [ ] Vercel 部署 `apps/web` → 接通 RainbowKit + Monad testnet
- [ ] Fly.io 部署 `apps/api` → 接 Neon + Upstash
- [ ] Fly.io 部署 `apps/echo-provider`
- [ ] 端到端冒烟在生产环境跑一遍

## 验收

- [ ] `forge test` 全绿（≥ 7 个测试合约全过）
- [ ] `vitest run` 全绿
- [ ] `pnpm biome check` 全绿
- [ ] 生产 URL 上完整跑通 Provider 注册→列表显示
- [ ] `openspec-chinese validate add-marketplace-and-provider-onboarding --strict` 通过
- [ ] 同步 design doc：把任何实施过程中发现的合约/接口偏差回写 §5 / §6 / §9 章节
