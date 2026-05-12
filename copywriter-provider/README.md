# @agentpay/copywriter-provider

Paid AgentPay tool: generates marketing tweets via DeepSeek. Auto-detects
language (zh/en) from the topic. Wraps `@agentpay/provider-middleware`, so
every request must carry a valid on-chain receipt — unpaid calls 402 before
DeepSeek is ever hit.

## Run locally

```bash
cd copywriter-provider
npm install
cp .env.example .env  # fill in CHAIN_RPC_URL, MARKETPLACE_ADDRESS, PROVIDER_PK,
                      # PROVIDER_ADDRESS, TOOL_ID, PRICE_WEI, DEEPSEEK_API_KEY
npm run build
npm start             # listens on $PORT (default 4101)
```

## Register on chain (provider wallet)

```solidity
marketplace.registerTool(
  "https://your-host/invoke",
  bytes32(0x...),                 // IPFS hash of MCP descriptor (see /docs §9.1)
  uint128(50000000000000000),     // 0.05 MON per call
  "copywriter-pro",
  "Marketing tweets in zh/en under 140 chars.",
  PROVIDER_ADDRESS                // payout
);
```

Returned `toolId` goes into `TOOL_ID`.

## Sample call (Worker would do this)

```bash
BODY='{"input":{"topic":"AgentPay launch","tone":"hype","count":3}}'
HASH=$(node -e "console.log(require('viem').keccak256(require('viem').toHex('$BODY')))")
curl -X POST http://localhost:4101/invoke \
  -H 'content-type: application/json' \
  -H "x-agentpay-receipt: 0x<receipt-from-pay()>" \
  -H 'x-agentpay-agent-id: 1' \
  -H "x-agentpay-tool-id: $TOOL_ID" \
  -H 'x-agentpay-step: 1' \
  -H "x-agentpay-input-hash: $HASH" \
  -d "$BODY"
# → {"output":{"tweets":["...", "...", "..."], "suggestedHashtags":["..."]}}
```

Failures after receipt is consumed return 502 with a `code` (per §9.2 this is
protocol-normal — receipts are non-refundable).

## Tests

```bash
npm test  # vitest run (unit + integration; no live DeepSeek call)
```
