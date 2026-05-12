# AgentPay Passport — 技术栈与架构决策文档

> 用途：作为 **AI 编码协作者**（Claude Code 或同级编码 agent）实施本项目的工程依据，包含全部技术选型、外部资源链接、关键架构决策、标准协议对齐。配合 `agentpay-passport-prd.md` 使用。
> 范围：Monad Blitz @上海 V2 黑客松 MVP 实现，单人 6.5 小时编码窗口。

---

## 1. 重大定位调整：与 MPP 标准对齐

**Monad 官方文档已将 Machine Payments Protocol（MPP）列为一级章节**，**Stripe 与 Tempo Labs 在 2026 年 3 月联合发布 MPP 作为 IETF 标准**，**Visa 提供卡支付 SDK**，**Cloudflare Agents 文档已收录 MPP 集成指南**。**MPP 对 x402 完全向后兼容**——**前者是后者的多支付方式泛化**。

**AgentPay Passport 必须明确定位为 MPP-aligned 实现**——**协议层兼容 MPP 的 charge intent**，**在 MPP 之上加上 onchain marketplace discovery、policy-bounded wallet、ERC-8004 reputation passport**。**Pitch 中精确表达**：**"AgentPay Passport builds the agent layer on top of MPP. MPP standardizes payment. We add discovery, policy, and reputation."**

**ERC-8004（Trustless Agents）**——Monad 有官方实现指南——**Passport NFT 实现 ERC-8004 兼容接口**，**保证 reputation 资产的跨平台可读性**。

---

## 2. Monad 网络关键参数

**Monad Testnet 配置**——**Chain ID 10143**、**Currency Symbol MON**、**主 RPC `https://rpc.testnet.monad.xyz`**、**dRPC 镜像 `https://monad-testnet.drpc.org`**、**Tatum 镜像 `monad-testnet.gateway.tatum.io`**、**Block Explorer `https://testnet.monadexplorer.com`**、**Contract Verification 通过 Sourcify**（`https://sourcify-api-monad.blockvision.org`）。**约 1 秒块时间、亚秒终结、目标 10,000 TPS**。**Faucet** 通过 https://docs.monad.xyz 入口获取测试 MON。

---

## 3. 推荐技术栈

### 3.1 核心脚手架——直接使用 Monad 官方模板

**首选 `scaffold-monad-foundry`**——`https://github.com/monad-developers/scaffold-monad-foundry`——**集成 Next.js + RainbowKit + Foundry + Wagmi + Viem + TypeScript**，**预配置 Monad Testnet**，**支持 contract hot reload 与 burner wallet**。**单命令启动**：

```bash
git clone https://github.com/monad-developers/scaffold-monad-foundry.git
cd scaffold-monad-foundry && yarn install
yarn deploy --network monadTestnet
yarn start
```

**备选 `scaffold-monad-hardhat`**——`https://github.com/monad-developers/scaffold-monad-hardhat`——同样集成完整全栈，**只是合约工具链用 Hardhat 而非 Foundry**。**对单人黑客松而言 Foundry 编译与测试速度优势显著**，**优先选 Foundry 版本**。

**纯合约模板 `foundry-monad`**——`https://github.com/monad-developers/foundry-monad`——**只包含 Foundry 配置无前端**，**适合只需后端的场景**。**本项目不用**。

### 3.2 智能合约层

**Solidity 版本 ^0.8.20**——**OpenZeppelin Contracts v5.x 标准库**，**复用 `Ownable`、`ReentrancyGuard`、`ERC721`、`ERC721URIStorage`** 等基础合约。**ERC-8004 兼容接口实现参考 Monad 官方教程**：`https://docs.monad.xyz/guides/erc-8004`。

**Foundry 配置**——`foundry.toml` 启用 **via_ir** 与 **Cancun EVM** 设定以匹配 Monad 执行环境（参考 `monad-foundry-starter`：`https://github.com/obinnafranklinduru/monad-foundry-starter`）。**这两个设置对 Monad 上的 gas 效率与字节码兼容性都是必要的**。

**Multicall3 已预部署在 Monad Testnet**——地址 `0xcA11bde05977b3631167028862bE2a173976CA11`——**前端用此地址做 view 调用聚合**，**减少 RPC 往返**。

### 3.3 前端层

**Next.js 14+（App Router）**作为全栈框架——**与 scaffold-monad-foundry 默认集成一致**。**RainbowKit** 作为钱包连接 UI、**Wagmi v2** 作为 React Hook 封装、**Viem v2** 作为底层 EVM 客户端——**这三件套是当代 Web3 前端的事实标准**。**TailwindCSS** 作为样式系统、**shadcn/ui** 作为组件库——**视觉一致性高且开发速度极快**。

### 3.4 Provider Wrappers 层

**Vercel Serverless Functions**（或 Next.js API Routes）——**单文件 Edge Function**承载每个 wrapper——**部署零摩擦**。**TypeScript 实现**，**使用 Viem 验证 Monad 链上 receipt**（`publicClient.readContract` 查询 `usedCallIds[callId]`）。**两个真实 wrapper**——`/api/copywriter`（调用 Anthropic Claude Haiku）与 `/api/image`（调用 Replicate FLUX schnell）——**部署在同一 Vercel 项目内共享受体验证模块**。

### 3.5 LLM 与 AI API

**Claude Haiku 4.5**（model id `claude-haiku-4-5`）作为 **Buyer Agent 的 Select 与 Synthesize 阶段、Provider Copywriter wrapper 的底层模型**——**低延迟、低成本、强 structured output 能力、原生支持 vision input**。**Anthropic SDK**（`@anthropic-ai/sdk`）官方 TypeScript 客户端。

**Replicate FLUX schnell**（`black-forest-labs/flux-schnell`）作为 **Image Generator wrapper 的底层模型**——**4 步推理极快**、**单次约 0.003 美元**、**输出图像 URL 直接可用**。**Replicate Node.js client**（`replicate`）官方客户端。

### 3.6 二进制资产存储

**Vercel Blob** 作为图像 CDN——**API 极简**、**与 Vercel 部署原生集成**、**生成的图像 URL 长期有效**。**Image wrapper 在调用 Replicate 后立即把图像下载并 re-upload 到 Vercel Blob**，**返回稳定的自家 URL 而非 Replicate 的 1 小时临时 URL**——**这是 demo 后链接不失效的必要工程动作**。

### 3.7 Manifest 存储

**HTTPS 静态资源 + 链上 hash commitment**——**manifest JSON 文件直接放在 `public/manifests/` 目录**部署到 Vercel CDN——**延迟 50-150ms**。**合约的 `services` mapping 同时存 `manifestURI` 与 `manifestHash`**，**客户端拉取 manifest 后用 keccak256 本地校验 hash 一致性**——**Web3 严谨性与 HTTPS 性能兼得**。

---

## 4. 关键架构决策汇总

下面把过往讨论中确立的所有架构决策汇总——**每一条都是经过权衡的工程取舍**，**AI 编码协作者实现时不应擅自更改这些决策**，**有疑问应回到本文档对应章节确认**。

### 4.1 协议层决策

**Pay-Then-Call 串行依赖不可消除**——**provider wrapper 必须先验证 `usedCallIds[callId] == true` 才能执行真实 AI 调用**——**这是协议安全的核心机制**，**不允许跳过此验证**。

**Multicall 批量交易优化**——**`AgentPayPassport.sol` 必须实现 `multicall(bytes[] calldata data)` 函数**——**单次 plan 的多个 `purchaseService` 调用打包为一笔上链动作**，**节省 gas 与用户签名次数**。

**Open-Loop Planning 模式**——**Select 阶段一次性生成完整 plan**、**严格执行不重新规划**——**不实现 closed-loop adaptive replanning**。**Pitch 中可提及 closed-loop 作为路线图**。

**乐观执行可选**——**前端在提交支付交易的同时可并发发起 provider HTTP 调用**——**provider wrapper 内部轮询 receipt 状态**——**让支付确认与网络传输重叠**。**实现复杂度可控**，**建议作为优化项**。

**Voucher Batch Settlement 不在 MVP 范围**——**当前协议每次 tool 调用都对应独立 onchain transaction**——**这是 Pitch 视觉证据的来源**——**不要为追求性能放弃这一视觉优势**。

### 4.2 数据流决策

**所有 tool 响应统一为 JSON 格式**——**文本类产物 inline 在 JSON**、**二进制类产物通过 URL 引用**——**永远不传 base64**。

**Synthesize 阶段 LLM 处理 URL 作为不透明字符串**——**默认不需要 vision 理解**——**仅做 routing 与 formatting**。**未来如需 multimodal reasoning 可使用 Claude Haiku 4.5 的 vision input**。

**Marketplace 发现采用 Eager Loading + Hash 校验**——**前端启动时一次性发现全部 marketplace**——**对每个 manifest 用 keccak256 校验链上 commitment**。

### 4.3 安全决策

**Policy enforcement 由合约强制**——**`maxPerCall` 与 `balance` 的检查在合约 `purchaseService` 函数中执行**——**LLM 即使被 prompt injection 攻陷也无法绕过预算约束**。**这是 Pitch 中最强的"agent 安全性"论点**。

**用户钱包不直接持有 agent 资金**——**资金存入合约托管账户**——**agent 通过 policy-bounded 合约调用支付**——**用户保留 `withdraw` 权力**。

**Reputation 累积不可作弊**——**每次 `purchaseService` 与 `completeTask` 都是付费操作**——**Sybil 攻击者必须支付真实 MON 才能虚假累积分数**——**经济不可行性即安全性**。

### 4.4 demo 流畅性决策

**Image 缓存策略**——**Image wrapper 内部检测 prompt 关键词命中预设白名单时返回缓存图像 URL**——**赛前在 Vercel Blob 预生成 5-10 张候选图像**——**缓存命中响应时间从 5-9 秒降至 < 500ms**。**这是 demo 现场最重要的单点优化**。

**Synthesize 流式输出**——**Claude API 支持 SSE streaming**——**前端从第一个 token 出现开始就有视觉反馈**——**主观体感时间显著压缩**。

**Marketplace 发现与 Select 并行启动**——**前端在用户键入 goal 的瞬间就触发 `discoverMarketplace()`**——**用户提交时数据已就绪**。

### 4.5 范围决策

**MVP 只实现 2 个真实 wrapper providers**——**Copywriter 与 Image Generator**——**第 3 个 `premium-copywriter-pro` 是装饰性 provider 用于演示预算保护机制**，**不需要真实后端**。

**Provider 注册表单只做 UI 不做实际后端**——**点击提交后弹出 "Submitted for review"**——**实际 services 由部署脚本预先注册**。**这一 UI 元素的作用是 pitch 时展示扩展性 affordance**。

**前端 UI 文案语言为中文**——**与 PRD 文档保持一致**——**面向上海现场观众更亲切**——**关键技术术语保留英文**（`Buyer Agent`、`Marketplace`、`Tool`、`Receipt`、`Reputation`、`MPP`）。

---

## 5. 合约接口规格

下面是 AI 编码协作者需要实现的合约公开接口——**严格遵守此规格**——**任何变动需要在本文档中标注**。

`AgentPayPassport.sol` 主合约**继承 ERC-721**实现 Passport NFT，**继承 ReentrancyGuard** 防重入，**对外暴露以下函数**——`createAgent(name, maxPerCall) returns (uint256 agentId)`、`deposit(agentId) payable`、`withdrawAgent(agentId, amount)`、`registerService(serviceId, pricePerCall, manifestURI, manifestHash)`、`updateService(serviceId, pricePerCall, active)`、`withdrawProvider(amount)`、`purchaseService(agentId, serviceId, callId, inputHash)`、`completeTask(agentId, taskId, rating)`、`multicall(bytes[] calldata data)`、**以及只读 view 函数** `getAllServices() returns (Service[])`、`getAgent(agentId)`、`usedCallIds(callId) returns (bool)`、`balanceOf(addr) returns (uint256)`。

**事件定义**——`AgentRegistered(uint256 agentId, string name, address owner)`、`Deposited(uint256 agentId, uint256 amount)`、`ServiceRegistered(bytes32 serviceId, address provider, uint256 price, string manifestURI, bytes32 manifestHash)`、`PaymentReceipt(uint256 receiptId, uint256 agentId, bytes32 serviceId, address provider, uint256 amount, bytes32 callId, bytes32 inputHash)`、`TaskCompleted(uint256 agentId, string taskId, uint256 newReputation)`、`Withdrawn(address user, uint256 amount)`。

**MON 作为 native gas token**——**支付直接用 MON**——**不引入 ERC-20 USDC mock**——**简化合约且更符合 Monad-native 叙事**。**金额单位用 wei（1 MON = 10^18 wei）**。

---

## 6. Wrapper 接口规格

每个 wrapper endpoint 遵守统一契约——**HTTP POST**、**`Content-Type: application/json`**、**请求 header 携带 `x-agentpay-call-id`**、**响应永远是 JSON**。

**Copywriter wrapper（`/api/copywriter`）**——请求体 `{topic: string, tone: "exciting"|"professional"|"casual", count: number}`——响应体 `{success: true, callId: string, data: {tweets: string[]}, metadata: {tokensUsed, modelId, latencyMs}}`。

**Image wrapper（`/api/image`）**——请求体 `{prompt: string, aspect_ratio: "square"|"landscape"}`——响应体 `{success: true, callId: string, data: {imageUrl: string, width, height, format}, metadata: {modelId, promptUsed, latencyMs}}`。

**统一错误响应**——支付未确认时返回 HTTP 402 加 JSON body `{error: "Payment not confirmed", callId, contract, chain: "monad-testnet"}`——**这是 MPP 兼容的 402 challenge 格式**。

---

## 7. 外部依赖与凭证清单

**赛前必须准备好的环境变量**——`ANTHROPIC_API_KEY`（Anthropic Console 充值 10 美元）、`REPLICATE_API_TOKEN`（Replicate 充值 10 美元）、`BLOB_READ_WRITE_TOKEN`（Vercel Blob 免费 tier 足够）、`MONAD_RPC_URL`（用 dRPC 或官方 RPC）、`DEPLOYER_PRIVATE_KEY`（Foundry keystore 管理）、`AGENTPAY_CONTRACT_ADDRESS`（部署后填入）。

**赛前必须完成的链下准备**——**在 Vercel Blob 预生成 5-10 张候选图像作为缓存素材**、**在合约预先注册 3 个 services（Copywriter、Image Generator、Premium Copywriter Pro）**、**录制一段 90 秒 fallback demo 视频以备网络翻车**。

---

## 8. 关键外部资源链接

下面是 AI 编码协作者实施时需要查阅的所有官方资源——**遇到任何技术决策疑问优先查这些链接**而非自行推断。

**Monad 官方**——主文档 `https://docs.monad.xyz`、网络信息 `https://docs.monad.xyz/developer-essentials/network-information`、最佳实践 `https://docs.monad.xyz/developer-essentials/best-practices`、与以太坊差异 `https://docs.monad.xyz/developer-essentials/differences-between-monad-and-ethereum`、Machine Payments Protocol 专章 `https://docs.monad.xyz/...machine-payments-protocol`、**ERC-8004 实现指南 `https://docs.monad.xyz/guides/erc-8004`**、Scaffold-ETH 教程 `https://docs.monad.xyz/guides/scaffold-eth`、Block Explorer `https://testnet.monadexplorer.com`。

**Monad 脚手架**——Foundry 全栈版 `https://github.com/monad-developers/scaffold-monad-foundry`、Hardhat 全栈版 `https://github.com/monad-developers/scaffold-monad-hardhat`、纯 Foundry 模板 `https://github.com/monad-developers/foundry-monad`、纯 Hardhat 模板 `https://github.com/monad-developers/hardhat-monad`、生产级 Foundry 起点 `https://github.com/obinnafranklinduru/monad-foundry-starter`。

**MPP 与标准协议**——MPP 总览 `https://mpp.dev/overview`、IETF 规范与 SDK `https://github.com/tempoxyz/mpp-specs`、Cloudflare MPP 文档 `https://developers.cloudflare.com/agents/agentic-payments/mpp/`、Stripe 公告 `https://stripe.com/blog/machine-payments-protocol`。

**Anthropic 与 Replicate**——Anthropic API 文档 `https://docs.claude.com`、TypeScript SDK `https://github.com/anthropics/anthropic-sdk-typescript`、Claude Haiku 4.5 model card `claude-haiku-4-5`、Replicate FLUX schnell 模型页 `https://replicate.com/black-forest-labs/flux-schnell`、Replicate Node client `https://github.com/replicate/replicate-javascript`。

**OpenZeppelin 与 Foundry**——Contracts v5 `https://github.com/OpenZeppelin/openzeppelin-contracts`、Foundry Book `https://book.getfoundry.sh`、ERC-721 实现参考 `https://docs.openzeppelin.com/contracts/5.x/erc721`。

**Web3 前端**——RainbowKit `https://www.rainbowkit.com`、Wagmi v2 `https://wagmi.sh`、Viem v2 `https://viem.sh`、shadcn/ui `https://ui.shadcn.com`。

---

## 9. AI 协作者实施顺序建议

下面是单人 6.5 小时编码窗口的推荐实施顺序——**严格按此顺序执行**——**任一阶段超时则下一阶段相应砍内容而非延后**。

**第 0 小时（赛前一晚）**——**克隆 scaffold-monad-foundry、本地跑通 yarn install/deploy/start、确认 Monad Testnet faucet 拿到 MON、在 Anthropic 与 Replicate 充值、在 Vercel 创建项目、预生成 5-10 张缓存图像上传 Blob、本地起一份 manifest 文件骨架**——**这是赛前必须完成的准备**。**否则比赛日的 6.5 小时不够用**。

**第 1 小时**——**实现 `AgentPayPassport.sol` 合约**包括所有公开函数与事件、**部署 Mock USDC 不需要**（直接用 MON）、**写 5 个核心 Foundry 测试**、**部署到 Monad Testnet 并记录地址**、**用 Sourcify 验证合约**。

**第 2 小时上半段**——**实现两个 wrapper endpoints**——`/api/copywriter` 与 `/api/image`——**包含 receipt 验证、Anthropic/Replicate 调用、Vercel Blob 上传**、**部署到 Vercel**、**单独测试每个 endpoint 可用**。

**第 2.5 小时**——**部署 manifest JSON 文件到 Vercel public 目录**、**用部署脚本注册 3 个 services 到合约**、**前端用 viem readContract 验证发现能力**。

**第 3-4 小时**——**前端 dashboard 三栏布局**——**左侧 Wallet 面板**、**中央 Timeline**、**右侧 Marketplace + Final Deliverable**——**集成 Wagmi hooks、shadcn/ui 组件、状态机管理**。

**第 4-5 小时**——**集成 Buyer Agent 协调器逻辑**——**Select prompt、Pay-Execute 循环、Synthesize prompt**——**端到端跑通一次完整流程**。

**第 5-5.5 小时**——**Demo 流畅性优化**——**multicall、image 缓存、Synthesize streaming、并行启动**。

**第 5.5-6 小时**——**Pitch 准备**——**录制 90 秒 fallback demo 视频、写 README、准备 LOGO 与 hero 图**。

**第 6-6.5 小时 buffer**——**修复必然冒出来的 bug、最后一次端到端测试、确认提交所有素材**。

---

## 10. 提交清单

按 Monad Blitz Notion 提交流程要求——**所有以下素材必须在 18:30 前就绪**——**LOGO（512×512 png 或 svg）**、**预览图片（1200×630 png）**、**详细介绍文本（中文，不超过 800 字）**、**可用的预览链接（部署在 Vercel 的公网 URL）**、**GitHub repo 链接（含完整 README）**、**3 分钟 demo 视频（可选但强烈建议）**。**所有合约部署地址、wrapper endpoints、manifest URIs 需要在 README 中清晰列出**——**便于评委独立验证**。

---

## 附录：架构决策快速查表

| 决策项 | 选择 | 替代方案 | 选择理由 |
|---|---|---|---|
| 合约工具链 | Foundry | Hardhat | 编译/测试速度更快、Monad 推荐 |
| 前端框架 | Next.js + Wagmi + Viem | Vite + Web3.js | scaffold-monad 默认且行业标准 |
| LLM | Claude Haiku 4.5 | GPT-4o-mini | structured output 更稳定 |
| 图像模型 | FLUX schnell | SDXL Turbo | 4 步推理最快 |
| Wrapper 部署 | Vercel Serverless | Railway/Render | 零配置、与前端共部署 |
| 图像 CDN | Vercel Blob | Cloudinary/S3 | 与 Vercel 原生集成 |
| Manifest 存储 | HTTPS + hash commitment | IPFS | 延迟极低，hash 保证完整性 |
| 支付通证 | Native MON | Mock USDC | 简化合约、Monad-native |
| Passport | ERC-721 (ERC-8004 兼容) | 自定义结构 | 行业标准、跨平台可读 |
| 规划模式 | Open-loop | Closed-loop | 单人 6.5 小时唯一可控选择 |
| 协议对齐 | MPP / x402 兼容 | 自定义协议 | 评委识别度高、避免重复发明 |
