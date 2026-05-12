# Change: 建立 Marketplace 合约 + Provider 上链注册

## Why

来自 PRD §3.1 和 §5：Provider 当前面临 **变现路径与核心能力的严重错配**——一个工程师即使调出了世界级 prompt 也必须自己搭 SaaS、获客、计费、客服。AgentPay Passport 的差异化在于 **"deploy once, be discovered, get paid per call"**——这一切的前提是链上有一个无许可的 marketplace 让 Provider 一次性注册，且支付握手协议从开始就闭合。

本变更是项目的**第一个落地切片**：交付 Provider 侧端到端最小闭环，让后续的 End User 侧 / Worker / 多轮上下文都能站在已闭合的协议层之上推进。

## What

### 合约层（Solidity 0.8.x + Foundry，部署到 Monad testnet）

1. `Marketplace.sol`：Tool 注册 + Agent 注册 + AgentWallet + PaymentEscrow 四合一；包含
   - Pull-payment 账本 `providerBalances` + `withdrawProvider`（CEI + nonReentrant）
   - Tool `version` 字段每次 update 自增；`pay()` 校验 `toolVersion` 与 `expectedPrice` 防 plan→execute 漂移
   - Receipt id 绑定 `(taskId, agentId, toolId, toolVersion, stepIdx, amount, inputHash, chainId, contract)` 防重放与跨合约重放
   - `verifyAndConsumeReceipt` 原子函数（`onlyProvider`）关闭 TOCTOU
   - `startTask` / `completeTask` / `cancelTask` 状态机
   - 滚动 24h `dailySpendCap` 抗 operator key 泄露 drain
   - 每个 external function 有明确 invariants + access control
2. `Passport.sol`：Soulbound ERC-721；`onlyMarketplace` 限制 mint / appendTask / updateReputation；`transferFrom` 全部 revert
3. Foundry 测试：pull payment 安全、receipt 防重放、dailySpendCap 24h 重置、tool.version mismatch revert、access control 完整覆盖
4. 部署脚本：Passport → Marketplace（带 Passport 地址）→ Passport.setMarketplace 一次性绑定

### 后端（apps/api：Node 22 + TS + Fastify）

5. DB schema 初版：`users`、`agents`（含 operator_address）、`tools`、`chain_cursor`、`operator_keys`；Drizzle ORM + migrations
6. Chain watcher：cursor 持久化 + backfill + viem `watchContractEvent` live tail + reorg 检测（每 10 块）+ finality depth 5；订阅 `ToolRegistered` / `ToolUpdated` 写 tools cache
7. `/api/auth/{nonce, verify}` SIWE 登录 → JWT cookie
8. `/api/provider/tools/prepare-register` POST → 返回 calldata（前端用 wagmi 签）
9. `/api/marketplace/tools` GET → 从 cache 出全列表
10. `/api/tools/:id` GET → 单 tool 详情（含 schema_json）

### Provider SDK 骨架（packages/provider-sdk）

11. `@agentpay/provider-middleware` Fastify plugin v0：
    - 读 5 个 `X-AgentPay-*` header
    - 本地 `keccak256(rawBody)` 与 `X-AgentPay-Input-Hash` 比对
    - 调 viem `Marketplace.verifyAndConsumeReceipt(receiptId, expectedInputHash)`
    - 通过 → 透传到下游 handler；不通过 → `402 Payment Required` + `WWW-Authenticate: AgentPay ...`
12. 单测覆盖：happy path、receipt 重放、inputHash 不匹配、非 provider 调用

### 前端（apps/web：Next.js 15 + Tailwind v4 + shadcn/ui + wagmi/RainbowKit）

13. `/` 落地页：一句价值主张 + Become Provider / Try as End User 双 CTA
14. `/provider/tools/new` 注册表单：name / description / endpoint URL / JSON Schema editor / price (MON) / payout 地址；schema 先上传 Pinata 拿 hash，再钱包签 registerTool tx
15. `/marketplace` Tool 列表：分页卡片墙，name / price / provider / version / description；无搜索/筛选/排序（PRD §10 一致）

### 集成 + 部署

16. Echo Provider 服务：用 `@agentpay/provider-middleware` 包，部署 Fly.io，注册到 marketplace 作为冒烟样本
17. 部署文档：Vercel (web) + Fly.io (api + echo) + Neon (db) + 合约 deploy script

## Impact

- **可演示**：`Alice 用钱包登录 → 填表注册 echo tool → 链上 ToolRegistered → marketplace 页 5 秒内看到` 端到端闭环
- **协议层闭合**：未来 Worker 端到端调 Provider 时所有合约函数 + middleware + receipt 校验都已就位，下一个变更只关注 End User + Worker
- **Codex review 修复全部落地**：design doc §5 的 pull payment / receipt 绑定 / dailySpendCap / 状态机 / access control 全部入库

## Non-Goals

- 不做 End User 创建 agent / 提任务 / Buyer Agent 执行流（下一个 change `add-buyer-agent-runtime`）
- 不做 Reputation 累积逻辑测试（依赖 task 完成；下一个 change）
- 不做 Express adapter（仅 Fastify；真 Provider 接入阶段再补）
- 不做"调整"按钮 / `parent_task_id` 父子链（依赖 task 存在；下一个 change）
- 不做 closed-loop replan / 任务搜索 / KYC / 跨链（PRD §10 OUT OF SCOPE）

## Why 破例 PRD？

**不破**。本变更全部在 PRD §6.1 Provider 必备功能范围内；多轮上下文通过下一个变更的 `parent_task_id` 父子链实现，每个 task 内部仍 open-loop，PRD §10 不动。
