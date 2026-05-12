# AgentPay Passport — Deployment Plan

> 范围：把当前可在本地跑通的 4 个组件搬到公网，让评委能从一个 URL 进入完整 demo。
> 时间盒：~2 小时一次性走完；后续 redeploy 是单命令。

---

## 1. 部署目标拓扑

```
┌────────────────────────────────────────────────────────────┐
│                  评委浏览器                                  │
│ https://agentpay-passport.vercel.app  ←── 主入口            │
└──────────────┬─────────────────────────────────────────────┘
               │
        ┌──────┴──────┐
        │             │
        ▼             ▼
┌──────────────┐  ┌────────────────────────┐
│ Vercel       │  │ Fly.io (东京/最近 region) │
│ Next.js Web  │  │ - agentpay-api          │
│              │──│   (Fastify + SSE + Worker│
│              │  │    + chain watcher)      │
└──────────────┘  │ - agentpay-echo          │
                  │   (Echo Provider, 用 SDK)│
                  └─────────┬────────────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
              ▼             ▼             ▼
       ┌──────────┐  ┌──────────┐  ┌──────────────┐
       │ Neon     │  │ Monad    │  │ DeepSeek API │
       │ Postgres │  │ Testnet  │  │              │
       │          │  │ MON      │  │              │
       └──────────┘  └──────────┘  └──────────────┘
```

不上 Upstash Redis（in-memory queue 满足 demo；高并发再说）。
不上 Pinata（tool schema 可以先 base64 内联或本地 IPFS gateway）。

---

## 2. Prereqs（开始前需要的账号 + 凭证）

| 项 | 在哪拿 | 用途 | 工时 |
|---|---|---|---|
| **Vercel 账号** | https://vercel.com 用 GitHub 登 | 部署 Next.js 前端 | 2 min |
| **Fly.io 账号 + 信用卡** | https://fly.io；信用卡只验证不扣（free tier ≤ 3 small VM）| 部署 API + Echo Provider | 5 min |
| **Neon 账号** | https://neon.tech 用 GitHub 登 | Postgres 持久化 | 2 min |
| **WalletConnect Project ID** | https://cloud.reown.com 注册项目 | RainbowKit 连接协议 | 2 min |
| **DeepSeek API Key** | https://platform.deepseek.com 注册 + 充 ≥¥10 | Buyer Agent plan/integrate LLM 调用 | 5 min |
| **Deployer 钱包私钥** | `cast wallet new` 生成 | 部署合约到 Monad testnet 用 | 30 秒 |
| **Monad Testnet MON** | https://docs.monad.xyz 找 faucet 入口 → 给 deployer 地址领 ≥ 1 MON | gas + demo 充值 | 2 min |
| **Operator 钱包私钥**（与 deployer 可同一个，也可分开）| `cast wallet new` | Worker 替每个 agent 调 `pay()` | 30 秒 |
| **Provider 钱包私钥** | `cast wallet new` | Echo Provider 调 `verifyAndConsumeReceipt` | 30 秒 |

> 三把 key 也都需要在 Monad faucet 领点 MON（每把 ~0.2 MON 即可，gas 极便宜）。

---

## 3. 部署顺序（按依赖关系，不可乱）

### Step 1 — 合约部署到 Monad Testnet（15 min）

```bash
export DEPLOYER_PK=0x<deployer 私钥>
export MONAD_TESTNET_RPC_URL=https://rpc.testnet.monad.xyz

cd contracts
PATH="$HOME/.foundry/bin:$PATH" forge script script/Deploy.s.sol \
  --rpc-url $MONAD_TESTNET_RPC_URL \
  --private-key $DEPLOYER_PK \
  --broadcast \
  --verify --verifier sourcify \
  --verifier-url https://sourcify-api-monad.blockvision.org \
  -vvvv
```

记下输出里的两个地址（写进下面所有服务的 env）：
- `MARKETPLACE_ADDRESS=0x...`
- `PASSPORT_ADDRESS=0x...`

在 `https://testnet.monadexplorer.com/address/<MARKETPLACE_ADDRESS>` 验证 verified ✓。

### Step 2 — Neon Postgres 建库 + 跑迁移（15 min）

1. https://neon.tech → New Project → 选最近 region（AWS us-west-2 / ap-southeast-1）
2. 复制 Connection String，形如 `postgres://user:pass@ep-xxx.aws.neon.tech/agentpay?sslmode=require`
3. 本地跑迁移：

```bash
cd api
DATABASE_URL='<neon-url>' npx drizzle-kit push
```

确认 `\dt` 在 Neon SQL Editor 里能看到 `agents / tools / tasks / tool_calls / task_events / ratings / chain_cursor / operator_keys`。

### Step 3 — 后端 API 上 Fly.io（25 min）

```bash
cd api
brew install flyctl || curl -L https://fly.io/install.sh | sh
fly auth login
fly launch --no-deploy --name agentpay-api --region nrt --no-postgres --no-redis
```

编辑生成的 `fly.toml`：

```toml
app = "agentpay-api"

[build]
  builder = "paketobuildpacks/builder:base"

[env]
  PORT = "4000"

[[services]]
  internal_port = 4000
  protocol = "tcp"
  [[services.ports]]
    handlers = ["http"]
    port = 80
  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443
```

填入 secrets（仅写一次，不留命令历史里建议交互式）：

```bash
fly secrets set \
  JWT_SECRET="$(openssl rand -base64 48)" \
  DATABASE_URL='<neon-url>' \
  CHAIN_RPC_URL='https://rpc.testnet.monad.xyz' \
  MARKETPLACE_ADDRESS='0x<step1 出的地址>' \
  PASSPORT_ADDRESS='0x<step1 出的地址>' \
  OPERATOR_PK='0x<operator 钱包私钥>' \
  OPERATOR_MASTER_KEY="$(openssl rand -base64 32)" \
  DEEPSEEK_API_KEY='sk-<deepseek key>' \
  DEEPSEEK_BASE_URL='https://api.deepseek.com/v1' \
  CORS_ORIGIN='https://agentpay-passport.vercel.app' \
  SIWE_DOMAIN='agentpay-passport.vercel.app'

fly deploy
```

验证：`curl https://agentpay-api.fly.dev/healthz` → `{"ok":true,...}`。

### Step 4 — Echo Provider 上 Fly.io（15 min）

```bash
cd echo-provider
fly launch --no-deploy --name agentpay-echo --region nrt
fly secrets set \
  CHAIN_RPC_URL='https://rpc.testnet.monad.xyz' \
  MARKETPLACE_ADDRESS='0x<step1 出的地址>' \
  PROVIDER_PK='0x<provider 钱包私钥>' \
  TOOL_ID='0'                              # 注册后填
fly deploy
```

注册 echo tool（前端 `/provider/tools/new` 用 deployer 钱包跑一次注册流程，或用 cast 直调）。注册成功后从 `ToolRegistered` event 拿到 `toolId`，回填 `fly secrets set TOOL_ID=<n>` 后 `fly deploy`。

### Step 5 — 前端上 Vercel（10 min）

```bash
cd /Users/ernest/mapay
npx vercel link                            # 关联 GitHub repo
```

在 Vercel 面板 → Settings → Environment Variables 设：

```
NEXT_PUBLIC_API_URL=https://agentpay-api.fly.dev
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<reown project id>
NEXT_PUBLIC_MARKETPLACE_ADDRESS=0x<step1 出的地址>
NEXT_PUBLIC_PASSPORT_ADDRESS=0x<step1 出的地址>
NEXT_PUBLIC_CHAIN_ID=10143
```

```bash
npx vercel --prod
```

拿到 `https://agentpay-passport.vercel.app`（或类似域名）。

### Step 6 — 冒烟（10 min）

| 检查 | 怎么验 |
|---|---|
| 前端能加载 | 浏览器开 vercel URL，看见 5 个页面 |
| 钱包连接 | MetaMask 加 Monad Testnet（chain 10143），连上 |
| SIWE 登录 | 任何页面操作，钱包弹签名，签完后端 cookie 落地 |
| 链上读 | `/marketplace` 列表能看到刚注册的 echo tool（chain watcher 工作）|
| 链上写 | `/agents/new` 提交 → 钱包弹 createAndFundAgent → tx 上链 → 跳 `/agents/[id]`|
| Buyer Agent 跑 | 在 agent 工作台提任务 → Timeline 实时刷新 → echo 真返回 → 整合产物显示 |
| 审计页 | 任务完成后 `/tasks/[id]` 能看到链上 receipt + 跳 Monad Explorer 验证 |

---

## 4. 评委分发包

| 渠道 | 内容 |
|---|---|
| 主链接 | `https://agentpay-passport.vercel.app` |
| 链上证据 | `https://testnet.monadexplorer.com/address/<MARKETPLACE>` |
| 代码 | GitHub repo |
| 1 min 解说视频 | Loom / Bilibili 录屏，备网络抖动 |
| 一句话 | "MPP-aligned. MPP standardized how an agent pays. We added what the agent decides, where it discovers, and how it remembers." |

---

## 5. 故障速查

| 症状 | 原因 | 修 |
|---|---|---|
| 钱包连不上 Monad | 网络没加 | RainbowKit 弹添加；或手动加 chain 10143 |
| `/healthz` 通但 marketplace 空 | watcher 没起 / 地址错 | Fly logs 看 `chain watcher started`；核对 `MARKETPLACE_ADDRESS` |
| createAgent revert | gas 不够 / dailySpendCap < maxPerCall | faucet 领 MON；表单数值检查 |
| Worker 不跑 task | 没 ChainClient 实现 | 用 mock SSE 撑场；真链路依赖 Track G 完成 |
| SIWE 验签失败 | `SIWE_DOMAIN` ≠ 浏览器 host | secrets 改对，redeploy |
| CORS 错 | `CORS_ORIGIN` 不含前端 origin | secrets 改对，redeploy |

---

## 6. 重新部署单命令

```bash
# 合约：只在改了 .sol 时
cd contracts && forge script script/Deploy.s.sol --rpc-url $MONAD_TESTNET_RPC_URL --private-key $DEPLOYER_PK --broadcast

# 后端
cd api && fly deploy

# 前端（git push 触发自动 deploy，或手动）
cd /Users/ernest/mapay && npx vercel --prod
```

---

## 7. 不在本次部署范围内（赛后再说）

- 真 DB 备份 / disaster recovery
- 多 region failover
- WAF / DDoS 防护
- Upstash Redis（in-memory queue 足够 demo）
- Pinata IPFS（schema 先内联或本地）
- 监控 / Sentry / 日志聚合（先看 Fly logs）
- 自定义域名（vercel.app + fly.dev 默认域足够）
