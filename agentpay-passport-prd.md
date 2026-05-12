# AgentPay Passport — 产品需求文档（PRD）

> 版本：v1.0 — Monad Blitz @上海 V2 提交版本
> 用途：作为 AgentPay Passport 产品的权威需求规格，供 **AI 开发协作者**（Claude Code 或同级编码 agent）作为实现依据，确保所有功能边界与用户体验细节有明确出处。
> 范围：聚焦产品需求与用户行为，不涉及技术实现细节、不涉及商业模型推演。

---

## 1. 产品概述

**AgentPay Passport** 是一个面向 **autonomous AI agents** 的链上付费服务市场。任何**能力供给方**可以把自己的 AI 服务注册成 **paid tool**，任何**能力消费方**可以创建一个携带预算与消费规则的 **Buyer Agent**，让 agent 自主在 marketplace 中选择 tools、按调用次数完成支付、整合多个 tools 的输出产物为最终交付物，并把整个工作流程沉淀为 agent 的链上信誉资产。

产品的核心价值主张可用一句话精确表达——**A2A lets agents talk. AgentPay Passport lets agents transact.**——**对话已经被解决，交易尚未被解决，而交易是 agent 从聊天机器人进化为经济主体的必要条件**。

---

## 2. 用户画像

AgentPay Passport 服务两类核心用户。他们在 marketplace 的两侧分别扮演**供给方**与**需求方**，**彼此通过协议层间接协作而无需直接互识**——这是 AgentPay 与传统 SaaS 在用户关系结构上的根本差异。

### 2.1 Provider 开发者画像

Provider 是**把自己的 AI 能力变现的工程师或独立开发者**。他们具备出色的 prompt 工程能力、独到的领域知识、或对某类 AI 模型的深入调优经验，**但缺乏构建用户系统、营销渠道、支付通道的精力与意愿**。典型的 Provider 包括独立做 prompt 调优的 AI 工程师、把行业知识编码成 specialist agent 的领域专家、训练或微调过专门模型的小团队。他们的核心特征是**专注核心能力、希望把非核心工程外包给协议层**。

**Alice** 是这类 Provider 的代表——一名独立 AI 工程师，调优了一段能产出高质量营销推文的 Claude prompt。她不想花一个月搭建 SaaS、设计订阅套餐、对接 Stripe、处理退款投诉——**她希望部署一次、被发现一次、然后被持续付费调用一次又一次**。

### 2.2 End User 画像

End User 是**最终消费 AI 能力的个人或组织**。他们有具体的工作目标需要完成——生成营销内容、调研市场机会、产出分析报告——**但不希望为每个能力分别订阅独立 SaaS**。他们的核心痛点是**轻度与中度用户严重补贴重度用户**——一年用 10 次的内容工作流不应该按月付 99 美元。

**Charlie** 是这类 End User 的代表——一名独立创业者，需要为新产品做 3 条预热推文加配图。**他不想为这一次性需求订阅 ChatGPT Plus、Midjourney、Buffer**——他希望按精确用量付费，并且让 AI 自己完成"选工具、做工作、组装产物"的全流程。

### 2.3 用户角色边界澄清

**Buyer Agent 不是独立用户而是 End User 创建的软件代理**——它是 End User 完成 job 时的执行工具，本身不独立产生需求。**Marketplace 协议本身没有运营方角色**——marketplace 是由协议定义的开放系统，任何 Provider 都可以**无许可注册**，任何 End User 都可以**无许可消费**——**协议层没有中心化看门人**。

---

## 3. 用户痛点

### 3.1 Provider 侧的痛点

Provider 当前面对的核心痛点是**变现路径与核心能力的严重错配**。一个工程师即使调出了世界级的 prompt 或微调了优秀的模型，**他必须自己解决获客、注册、计费、退款、客服、合规、法务**——这些工作量是核心能力建设的 5-10 倍。**结果是大多数高质量 AI 能力被困在 GitHub README 里**——开发者不愿意为了一个 side project 搭建完整 SaaS。

更深层的痛点是**计费模型与产品形态不匹配**。AI 能力的真实使用形态是**离散调用而非持续订阅**——一个用户可能两周用 100 次然后两个月不用——但 SaaS 模型强制把它包装成月费。**这种错配让 Provider 在定价时陷入两难**——定低了重度用户白嫖、定高了轻度用户流失——**最终大多数 Provider 选择不变现，让能力闲置**。

### 3.2 End User 侧的痛点

End User 当前面对的核心痛点是**订阅疲劳与按用量付费的缺位**。一个完整的内容工作流需要 ChatGPT Plus、Midjourney、ElevenLabs、Buffer 等多个 SaaS——**月度成本累加超过 75 美元，而中度用户的实际单月用量可能只值 5 美元**。**90% 的订阅费用在补贴 10% 的重度用户**——**这是 SaaS 经济学的固有不公平**。

更深层的痛点是**人类介入的强制性**。即使 End User 希望让 AI agent 自主完成多步骤工作流，**今天的支付链路强制每一步都需要人类经手**——绑定信用卡、确认 OAuth、点击同意条款。**这违背了 agent 自主性的本质**——**agent 应当能在预算与规则内自主决策与执行，而不是每三秒钟向用户请求一次批准**。

---

## 4. 解决方案

AgentPay Passport 通过**三个相互咬合的产品模块**解决上述痛点，形成完整的供需匹配闭环。

**第一个模块是 Paid Tools Marketplace**。Provider 把自己的 AI 服务注册成 paid tool，**附带能力描述、输入输出格式、单次调用价格、自己的收款地址**。Marketplace 对所有 tools 提供统一的发现入口，End User 创建的 Buyer Agent 通过查询 marketplace 自动获取可用 tools 清单。**这一模块解决 Provider 的发现问题与 End User 的选择问题**——Provider 无需自建获客系统、End User 无需在多个 SaaS 之间手动切换。

**第二个模块是 Policy-Bounded Agent Wallet**。End User 创建 Buyer Agent 时为其设定**预算总额**与**单次调用上限**——**这些规则被协议层强制执行**，即使 agent 的 LLM 行为异常或被 prompt injection 攻陷，**也无法绕过预算约束**。Agent 在执行任务时自主完成 tool 选择、付费、调用、整合的全流程，**End User 一次性设定预算后无需任何手动介入**。**这一模块解决 End User 的人类介入痛点与按用量付费需求**。

**第三个模块是 Reputation Passport**。Agent 每完成一次任务都会在链上累积 **reputation 数值**，这些数据沉淀为 agent 拥有的 NFT 形态资产。**这一模块解决信任的可累积与可迁移问题**——一个 agent 在 AgentPay Passport 上建立的声誉未来可被其他 marketplace 读取与认可，**reputation 成为 agent 跨场景的身份资产而非平台内部数据**。

---

## 5. 用户场景与 Jobs To Be Done

### 5.1 Provider 开发者 Alice 的 Job

**Alice 要完成的核心 job 是"把我的 AI 能力变成可被持续调用的收入流"**。这个 job 拆解为四个子任务。

**子任务一：把 AI 能力封装为可调用服务**。Alice 需要把她调优好的 prompt 部署为一个**可通过网络访问的服务端点**，**接受结构化输入、返回结构化输出**。她在 AgentPay Passport 的 Provider 控制台填写服务地址、定义输入输出格式、撰写能力描述——**这是一次性配置动作**。

**子任务二：为服务定价**。Alice 评估自己每次调用的底层成本与希望获得的毛利率，**在控制台设定单次调用价格**。**她可以随时调整价格而无需重新注册**。

**子任务三：把服务注册到 marketplace**。Alice 在控制台点击"Register"按钮，系统协助她完成链上注册——**注册完成后她的服务立即对全网 Buyer Agent 可见**。

**子任务四：监控与提现**。Alice 在控制台查看自己服务的调用次数、累积收入、被哪些 agent 调用过、平均评分。**她可以随时把累积收入提取到自己的钱包**——**这个流程比传统 SaaS 的支付平台 payout 周期短一个数量级**。

### 5.2 End User Charlie 的 Job

**Charlie 要完成的核心 job 是"让 AI 自主完成一个多步骤工作流并交付最终成果"**。这个 job 拆解为五个子任务。

**子任务一：创建 Buyer Agent**。Charlie 在 AgentPay Passport 的 End User 入口创建新 agent，**填写 agent 名字、要完成的目标、预算总额、单次调用上限**。**这是一次性配置动作**——Charlie 之后可重复使用同一个 agent 完成多次任务。

**子任务二：为 agent 充值预算**。Charlie 从自己的钱包向 agent 转入预算资金，**资金存入受协议托管的 agent 账户**。**Charlie 保留随时取回剩余资金的权力**。

**子任务三：提交任务并等待**。Charlie 输入具体的任务描述——例如"为我的 SaaS 产品发布生成 3 条带配图的预热推文"——**然后离开界面去做别的事**。**Charlie 不需要在 agent 执行过程中提供任何输入或确认**。

**子任务四：验收交付物**。Agent 完成任务后 Charlie 收到通知，**回到界面查看 agent 整合好的最终产物**——3 张完整的可视化推文卡片，每张包含文案、配图、建议发布时间、推荐 hashtag。**Charlie 可以直接复制使用或要求 agent 重新调整**。

**子任务五：给 agent 打分**。Charlie 对 agent 这次任务的完成质量给出评分，**评分写入 agent 的 reputation passport**。**Charlie 的下一次任务中 agent 携带着累积起来的 reputation**——**agent 越用越懂他的偏好**。

### 5.3 两类用户在协议层的协作模式

Alice 与 Charlie **从未直接见面或通信**——**他们的协作完全由协议层介导**。Charlie 创建的 Buyer Agent 在 marketplace 中发现 Alice 注册的 Copywriter tool、自主决定调用它、为这次调用支付一笔精确金额、收到 Alice 服务返回的 3 条推文文案——**整个过程 Alice 不知道 Charlie 是谁、Charlie 不知道 Alice 是谁**。**这种基于协议的匿名协作是 AgentPay Passport 与传统 SaaS 在用户关系结构上的根本差异**——**双方都只与协议交互而非与对方交互**。

---

## 6. 核心功能清单

为方便 AI 开发协作者作为实现依据——下面把产品功能按用户角色分类列出，**每一项都是 MVP 必备能力**。

### 6.1 Provider 开发者必备功能

Provider 控制台需支持完整的服务生命周期管理——**服务注册**（填写服务端点、定义输入输出格式、撰写能力描述、设定单次价格）、**服务管理**（启用与禁用、修改价格、更新描述）、**收入查看**（累积收入、调用次数、被调用历史、评分分布）、**收入提现**（从协议托管账户提到自己的钱包）。**所有功能均为 Provider 控制下自主操作**——**协议层不审核 Provider 的服务内容也不仲裁 Provider 与 End User 之间的争议**。

### 6.2 End User 必备功能

End User 控制台需支持完整的 agent 生命周期管理——**agent 创建**（填写名字、目标、预算总额、单次调用上限）、**agent 充值**（从自己的钱包向 agent 转入预算）、**任务提交**（输入具体的任务描述）、**任务过程可视化**（实时显示 agent 当前在调用哪个 tool、已花多少预算、还剩多少额度、被拒绝的 tool 与拒绝原因）、**交付物查看**（agent 整合后的最终产物）、**任务评分**（对 agent 的完成质量打分）、**reputation 查看**（agent 累积的链上信誉数据与历史 task 列表）、**余额提取**（把 agent 账户未使用的资金取回自己的钱包）。

### 6.3 Buyer Agent 软件实体的内置能力

虽然 Buyer Agent 不是人类用户，**但它的内置能力直接决定 End User 的产品体验**——包括 **marketplace 发现能力**（从协议层读取所有已注册 tools 与其完整描述）、**自主选择能力**（基于任务目标与预算约束选择最优 tools 组合）、**预算约束遵守**（协议层强制执行的不可绕过约束）、**多 tool 调用编排**（按合理顺序调用多个 tools 并处理它们的输出）、**产物整合能力**（把多个 tools 的离散输出整合为统一的最终交付物）、**reputation 累积**（每次任务完成自动更新 agent 的链上信誉）。

---

## 7. 用户旅程详述

### 7.1 Provider 开发者 Alice 的完整旅程

Alice 听说 AgentPay Passport 后**第一次到访的体验**应当让她在 **10 分钟内**完成"注册—部署—上架"的最小路径。她进入 Provider 控制台、用钱包登录、看到一个简洁的服务注册表单。她在表单中填写自己已部署的服务端点、用可视化编辑器定义输入输出格式、写一段不超过 200 字的能力描述、设定单次价格、点击"Register"按钮。系统提示她确认一笔链上注册交易——**她在钱包中签名、约 0.4 秒后看到注册成功通知**。控制台跳转到她的服务详情页——显示服务状态为"Active"、累积调用次数为 0、累积收入为 0。**Alice 的首次旅程结束**——**她做完该做的、剩下的交给 marketplace**。

随后几天 Alice 偶尔回来查看 dashboard——**她看到调用次数在缓慢增长**。每次有 Buyer Agent 调用她的 tool 时**累积收入数字会自动更新**。**当累积收入达到一定阈值她点击"Withdraw"把资金转回主钱包**——**这是她每周或每月的例行操作**。

### 7.2 End User Charlie 的完整旅程

Charlie 听说 AgentPay Passport 后**第一次到访的体验**应当让他在 **5 分钟内**完成"创建 agent—提交任务—看到产物"的最小路径。他进入 End User 入口、用钱包登录、看到一个引导式的 agent 创建向导。他填写 agent 名字为"Marketing Agent"、目标为"生成 3 条带配图的 SaaS 发布推文"、预算为 0.5 MON、单次上限为 0.15 MON——**这些参数在向导中通过滑块与示例引导他设定合理值**。

Charlie 点击 **"Create & Fund"** 按钮——系统提示一笔合并的协议交易（同时完成创建与充值），他在钱包中签名、不到 1 秒看到 agent 创建完成的确认页面。dashboard 切换到 agent 执行视图——左侧显示 Marketing Agent 的当前状态（预算余额、policy 状态）、中央是任务执行 Timeline、右侧是 marketplace 卡片墙。

Charlie 点击 **"Start Task"** 按钮——**之后他只是旁观**。Timeline 上依次出现状态更新——"正在发现 marketplace 中的可用 tools"、"已发现 3 个 tools"、"agent 正在制定执行计划"、"计划已生成（4 个 tool 调用，1 个被跳过）"、"正在调用 Copywriter Agent"、"支付确认"、"Copywriter 输出 3 条推文"、"正在调用 Image Generator（第 1/3 张）"、依次往下。**整个过程在 8-12 秒内完成**——**Charlie 看到的是一个真实在工作的 AI agent**。

最终页面上 Charlie 看到 **3 张完整的推文预览卡片**——他可以直接复制使用、或要求 agent 调整某一条。**他给 agent 打 5 星评分**——**agent 的 reputation 从 50 升到 51**——**Charlie 看到 agent 的 Passport NFT 中新增了一条 task 历史**。**他的首次旅程结束**——**他完成了一项过去需要订阅多个 SaaS 才能完成的工作流**。

下次 Charlie 需要类似工作流时**他不需要重新创建 agent**——**他直接选择已有的 Marketing Agent、给它新任务、按需充值、看结果**。**Agent 越用越懂他的偏好**——这是传统 SaaS 单次性消费无法提供的**复利效果**。

---

## 8. 竞品分析

AgentPay Passport 在 agent 经济与支付协议的交叉地带定义了一个**新的产品类别**——**理解它与现有方案的差异是产品定位的核心**。

### 8.1 与 x402 协议的关系

**x402 是 Coinbase 推出的 HTTP 402 Payment Required 标准协议**——它定义了"客户端请求 → 服务端返回 402 + 付费要求 → 客户端签名付款 → 服务端验证后返回数据"的标准握手流程。**x402 解决的是"单次 HTTP 调用如何付费"的协议层问题**——**它不解决服务发现、预算管理、信誉累积**。

AgentPay Passport 与 x402 是**互补而非竞争关系**。**x402 是 payment handshake 标准**——**AgentPay Passport 是基于这种握手之上的完整 agent commerce 系统**，**加上了 x402 没有的服务发现层、预算约束层、信誉累积层**。最锋利的差异化表达是 **"x402 standardized how an agent pays. We added what the agent decides, where it discovers, and how it remembers."**

### 8.2 与 MCP Registry 的关系

**Model Context Protocol（MCP）是 Anthropic 推出的 tool 接口标准**——它定义了 agent 如何发现 tool、如何调用 tool、tool 如何描述自己的 schema。**Smithery、PulseMCP、Glama 等 MCP Registry 平台**让开发者发布与发现 MCP servers。**MCP 解决的是 tool 发现与调用的接口标准化问题**——**它默认所有 tools 免费**。

AgentPay Passport 与 MCP 同样是**互补而非竞争关系**。**marketplace 上每个 tool 的描述格式完全遵循 MCP-compatible 的 schema 规范**——**唯一的扩展是在 tool 调用前插入一个 onchain payment gate**。这种关系的精确表达是 **"AgentPay Passport adds the missing payment primitive to MCP-style tool calls"**——**它不替代 MCP 而是补全 MCP 缺失的经济层**。

### 8.3 与 Stripe 的类比

**Stripe 解决了 Web2 时代 web API 与 SaaS 应用的支付基础设施问题**——任何开发者几行代码就能接受信用卡支付。**Stripe 之于 SaaS 经济等价于 AgentPay 之于 agent 经济**——**两者都把"复杂的支付基础设施"抽象成 provider 几乎不可感知的协议层**。

但有两个关键差异。**第一是支付方主体不同**——Stripe 的支付方是人类用户，AgentPay 的支付方是 agent 软件实体——**这要求支付链路完全无人类介入**。**第二是结算频率与单次金额不同**——Stripe 优化的是日均几笔几十美元的常规交易、AgentPay 优化的是每秒数笔每笔几美分的高频微支付——**这要求结算层延迟与成本远低于传统信用卡处理**。

### 8.4 与 OpenAI GPT Store 的对比

**OpenAI GPT Store 是中心化的 agent 应用市场**——开发者把自定义 GPT 上架，用户通过 ChatGPT Plus 订阅获得无限调用权。**GPT Store 解决的是 agent 应用的发现与分发**——**但它是订阅模型、单一平台、中心化审核、收入归 OpenAI 控制**。

**AgentPay Passport 与 GPT Store 在产品形态上属于同一品类但定位完全相反**。**GPT Store 是"OpenAI 的 App Store"**——**封闭、中心化、订阅化**；**AgentPay Passport 是"agent 经济的开放协议"**——**开放、去中心化、按调用计费**。两者面向的开发者画像也不同——**GPT Store 适合愿意被 OpenAI 平台规则约束的开发者**、**AgentPay Passport 适合希望自主控制定价、收益、用户关系的独立开发者**。

### 8.5 与 Skyfire 的对比

**Skyfire 是 Coinbase 系背景的 agent 支付公司**——它提供 agent 钱包基础设施与稳定币结算。**Skyfire 的产品定位接近 AgentPay 的 Wallet 模块**——**但它不包含 marketplace 与 reputation 系统**。**Skyfire 解决的是 agent 钱包问题、AgentPay Passport 解决的是 agent 完整经济系统问题**——**前者是后者的一个子集**。

### 8.6 竞品定位总结

把上述竞品放在二维空间中——**横轴是"开放性"（中心化 vs 去中心化）、纵轴是"完整性"（单点功能 vs 完整系统）**——**AgentPay Passport 占据"开放且完整"的象限**。**x402 是开放但单点**、**MCP 是开放但单点（且不付费）**、**GPT Store 是中心化且完整**、**Skyfire 是相对中心化且单点**——**AgentPay Passport 在这个二维空间中没有直接对标**，**这正是产品定位的差异化所在**。

---

## 9. MVP 验收标准

作为 AI 开发协作者实现本产品的验收依据——**以下条件全部满足即视为产品 MVP 完成**。

**Provider 侧的验收标准**是 Alice 这类用户能够在 10 分钟内完成从首次访问到服务上架的全流程——**包括钱包登录、填写服务表单、定价、链上注册成功、在控制台看到自己的服务为"Active"状态**。**Alice 之后能够看到自己服务的累积调用次数与收入数据**，**并能成功执行至少一次 withdraw 操作把收入转出**。

**End User 侧的验收标准**是 Charlie 这类用户能够在 5 分钟内完成从首次访问到看到最终交付物的全流程——**包括钱包登录、创建 agent、设定预算、提交任务、等待 agent 自主执行、看到整合后的最终产物**。**Charlie 在执行过程中无需提供除"提交任务"之外的任何输入或确认**，**整个 agent 执行过程的可视化让 Charlie 直观看到 agent 正在做什么**。

**协议层的验收标准**是**所有支付与服务调用关系都在链上可追溯**——任何第三方都能通过区块浏览器验证某次 task 的完整经济与执行历史。**agent 的 reputation passport 是一个独立的链上资产**——**可被未来其他 marketplace 读取与认可**。

---

## 10. 不在本版本范围内的能力

为避免开发协作者对范围产生误解——**以下能力明确不在 MVP 范围内**。

**协议不支持 Provider 与 End User 之间的争议仲裁**——如果 Charlie 觉得 Alice 的 tool 输出质量差，**他可以给 agent 低分但无法要求退款**——**这是协议的无许可性与协议中立性的必然取舍**。

**协议不主动审核 Provider 的服务内容**——Alice 注册什么服务由她自己负责——**协议层不做内容审核**。**未来的去中心化治理可能引入社区审核机制但不在 MVP 范围**。

**协议不提供跨链支付能力**——**所有支付与结算限定在 Monad 链上**——多链扩展不在 MVP 范围。

**协议不内置 Provider 与 End User 的真实身份验证**——**双方都通过钱包地址识别**——**KYC/AML 不在 MVP 范围**。

**Buyer Agent 当前采用 open-loop planning 模式**——**plan 一次性生成、严格执行、不基于中间结果重新规划**——**closed-loop adaptive replanning 不在 MVP 范围**。

**Marketplace 不提供 tool 搜索与筛选的复杂查询能力**——**MVP 阶段 marketplace 只展示完整 tool 列表**——**关键词搜索、tag 过滤、按价格/评分排序等高级查询能力不在 MVP 范围**。

---

## 附录：术语对照

| 中文术语 | 英文术语 | 简要释义 |
|---|---|---|
| 付费工具市场 | Paid Tools Marketplace | 集中展示所有已注册 paid tools 的发现入口 |
| 买方代理 | Buyer Agent | End User 创建的有预算与目标的 agent 软件实体 |
| 工具 | Tool | Provider 注册的可被付费调用的 AI 服务 |
| 信誉护照 | Reputation Passport | agent 累积的链上信誉数据的 NFT 形态资产 |
| 调用价格 | Price Per Call | tool 单次调用的费用 |
| 预算上限 | Budget | agent 可消费的总额度 |
| 单次上限 | Max Per Call | agent 在单次 tool 调用上可消费的最大金额 |
| 调用凭证 | Call Receipt | 一次成功支付在链上产生的支付凭证 |
