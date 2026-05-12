# Marketplace Spec Delta

## ADDED Requirements

### Requirement: Provider 注册 Tool 到链上 Marketplace

系统 MUST 允许任何持有 Monad 钱包的地址通过 web 表单或直接调用合约把一个 AI 服务注册成 paid tool。注册时 MUST 设定 endpoint URL、JSON Schema 的 IPFS hash、单次调用价格、payout 地址。系统 MUST 在链上为每个 tool 保留 `version` 字段，每次 update 时自增。

#### Scenario: Provider 通过 web 表单成功注册 tool

- **GIVEN** Provider 已用钱包登录 `/provider/tools/new`
- **WHEN** Provider 填写完整表单（name, endpoint, schema, price, payout）并提交
- **AND** Provider 在钱包中确认 `registerTool` 交易
- **THEN** 系统 MUST 在 Monad testnet 写入 Tool struct 并自增 `nextToolId`
- **AND** 系统 MUST emit `ToolRegistered(toolId, provider, price, version=1)` 事件
- **AND** chain watcher MUST 在 finality depth 之后把 tool upsert 到 `tools` 表
- **AND** Provider MUST 在 10 秒内被跳转到 tool 详情页

#### Scenario: Provider 修改 tool 价格

- **GIVEN** Provider 是 `tool.provider`
- **WHEN** Provider 调 `updateTool(toolId, newPrice, enabled=true, newSchemaHash)`
- **THEN** `tool.pricePerCall` MUST 等于 newPrice
- **AND** `tool.version` MUST 自增 1
- **AND** 系统 MUST emit `ToolUpdated(toolId, newPrice, newVersion, true, newSchemaHash)`

#### Scenario: 非 provider 尝试更新

- **WHEN** 非 `tool.provider` 地址调 `updateTool`
- **THEN** 交易 MUST revert with "not provider"

### Requirement: Marketplace 列表对所有用户可见且无许可

系统 MUST 提供一个无许可的全局 marketplace 视图，展示所有 `enabled = true` 的 tool。MVP 阶段系统 MUST 不提供搜索、tag 筛选、按价格或评分排序等高级查询能力（PRD §10 一致）。

#### Scenario: 任何访客查看 marketplace 列表

- **WHEN** 任何用户（含未登录）访问 `/marketplace`
- **THEN** 页面 MUST 展示所有 `enabled = true` 的 tool 卡片
- **AND** 每个 tool 卡片 MUST 显示 name, price (MON), provider 地址, version, description
- **AND** 系统 MUST 支持游标分页（每页 20 条），不支持任何形式的搜索或筛选

#### Scenario: 公开 tool 详情

- **WHEN** 任何用户访问 `/tools/{id}`
- **THEN** 页面 MUST 显示 tool 的全部公开字段
- **AND** 页面 MUST 从 IPFS fetch 并展示 `schema_json`
- **AND** 页面 MUST 不暴露 Provider 与历史调用者之间的关联（PRD 匿名性）

### Requirement: 链上 Receipt 设计防重放与跨合约重放

系统 MUST 让 receipt id 由以下字段全部参与的 keccak256 生成：`(taskId, agentId, toolId, toolVersion, stepIdx, amount, inputHash, chainId, contractAddress)`。Provider 通过 `verifyAndConsumeReceipt` 校验时 MUST 是同一笔交易内的原子操作（关闭 TOCTOU）。

#### Scenario: 重放已消费的 receipt

- **GIVEN** 一个 `consumed = true` 的 receipt
- **WHEN** 任何地址调 `verifyAndConsumeReceipt(receiptId, expectedInputHash)`
- **THEN** 交易 MUST revert with "receipt already consumed"

#### Scenario: 非 provider 尝试 consume receipt

- **GIVEN** receipt 对应的 tool 由 Provider X 注册
- **WHEN** 非 Provider X 的地址调 `verifyAndConsumeReceipt(receiptId, ...)`
- **THEN** 交易 MUST revert with "not provider"

#### Scenario: HTTP body 与 receipt.inputHash 不匹配

- **GIVEN** Provider 收到的 HTTP 请求 body
- **WHEN** 本地 `keccak256(body) != receipt.inputHash` 但 Provider 仍调 `verifyAndConsumeReceipt(receiptId, keccak256(body))`
- **THEN** 交易 MUST revert with "input hash mismatch"

### Requirement: Provider 提取累积收入采用 Pull-Payment 模型

系统 MUST 用 pull-payment 模型——`pay()` 仅累加 `providerBalances[payout]`，不立即调用外部转账。Provider MUST 通过 `withdrawProvider(amount)` 主动提取，函数 MUST 使用 CEI（Checks-Effects-Interactions）模式且 SHALL 加 `nonReentrant` 保护。

#### Scenario: Provider 成功提现

- **GIVEN** `providerBalances[providerAddr] = X MON`
- **WHEN** Provider 调 `withdrawProvider(amount)` 且 `amount ≤ X`
- **THEN** `providerBalances[providerAddr]` MUST 减少 `amount`
- **AND** Provider MUST 收到 `amount` MON
- **AND** 系统 MUST emit `ProviderWithdrawn(provider, amount)`

#### Scenario: 超额提现

- **WHEN** Provider 调 `withdrawProvider(amount)` 且 `amount > providerBalances[provider]`
- **THEN** 交易 MUST revert with "insufficient balance"

#### Scenario: 抵抗重入攻击

- **GIVEN** 一个恶意 payout 合约在 `receive()` 中尝试再次调 `withdrawProvider`
- **WHEN** Provider 触发首次 `withdrawProvider`
- **THEN** 二次调用 MUST revert with `nonReentrant` guard 触发

### Requirement: Passport NFT 为 Soulbound 且仅 Marketplace 可写

系统 MUST 在每次 `createAndFundAgent` 时由 Marketplace 合约 mint 一枚 Passport ERC-721 给 `agent.owner`。NFT MUST 不可转让——`transferFrom` 与 `safeTransferFrom` 全部 revert。只有 Marketplace 合约 MUST 能调用 `mint` / `appendTask` / `updateReputation`。

#### Scenario: NFT 持有者尝试转让

- **GIVEN** 用户持有 Passport NFT tokenId X
- **WHEN** 用户调 `transferFrom(from, to, X)` 或 `safeTransferFrom`
- **THEN** 交易 MUST revert with "soulbound"

#### Scenario: 非 Marketplace 地址尝试改 reputation

- **WHEN** 非 Marketplace 地址调 `Passport.updateReputation(tokenId, newRep)`
- **THEN** 交易 MUST revert with "only marketplace"

#### Scenario: Passport 与 Marketplace 一次性绑定

- **GIVEN** 已部署 Passport 但 marketplace address 尚未设置
- **WHEN** deployer 调 `Passport.setMarketplace(marketplaceAddr)` 一次
- **THEN** Passport 的 marketplace 字段 MUST 等于 marketplaceAddr
- **AND** 再次调 `setMarketplace` MUST revert with "already set"

### Requirement: Provider Middleware 提供 Fastify Adapter

系统 MUST 在 `@agentpay/provider-middleware` 提供 Fastify plugin，使 Provider 一行代码即可在 HTTP 服务前接入支付校验。Plugin MUST 在 onRequest hook 中读 5 个 `X-AgentPay-*` header、本地比对 `keccak256(rawBody)` 与 `X-AgentPay-Input-Hash`、调用 `verifyAndConsumeReceipt`、按结果放行或返回 `402 Payment Required`。

#### Scenario: 合法请求通过 middleware

- **GIVEN** Provider 服务挂载了 `agentPay({...})` Fastify plugin
- **WHEN** Worker 发起带正确 5 个 header 与匹配 inputHash 的 POST 请求
- **AND** 链上 `verifyAndConsumeReceipt` 返回 true
- **THEN** middleware MUST 把 `{ receiptId, agentId, stepIdx }` 注入 `req.agentPay`
- **AND** 下游 handler MUST 被调用

#### Scenario: 未付款请求被 402 拒绝

- **WHEN** 请求缺少 `X-AgentPay-Receipt` header
- **THEN** middleware MUST 返回 `402 Payment Required`
- **AND** 响应头 MUST 包含 `WWW-Authenticate: AgentPay tool={toolId} price={price}`

#### Scenario: inputHash 不匹配请求被 402 拒绝

- **GIVEN** 请求带完整 header 但 body 在中间被篡改
- **WHEN** middleware 算出 `keccak256(rawBody) != X-AgentPay-Input-Hash`
- **THEN** middleware MUST 返回 `402 Payment Required` with reason "input hash mismatch"
