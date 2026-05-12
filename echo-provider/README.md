# @agentpay/echo-provider

Reference AgentPay provider tool service. Wraps a trivial echo handler with
`@agentpay/provider-middleware` so every request must carry a valid receipt or
get a 402.

## What it does

`POST /invoke` with the five AgentPay headers (§9 of the architecture doc) and
a JSON body `{ "input": ... }`. The middleware:

1. Reads the headers and re-hashes the body.
2. Sends `Marketplace.verifyAndConsumeReceipt(receiptId, inputHash)` from the
   provider's wallet — atomic verify + consume.
3. On success, the handler returns `{ "output": { "echo": <input> } }`.
4. On any failure, replies `402 Payment Required` with
   `WWW-Authenticate: AgentPay tool=<id> price=<wei>`.

## Run locally against Monad testnet

```bash
cd echo-provider
npm install
cp .env.example .env       # fill in addresses + PROVIDER_PRIVATE_KEY + RPC_URL
npm run build
npm start                  # listens on $PORT (default 4100)
```

`.env.example` lists every variable the boot path reads. The required set:
`CHAIN_RPC_URL`, `MARKETPLACE_ADDRESS`, `PROVIDER_ADDRESS`, `PROVIDER_PRIVATE_KEY`,
`TOOL_ID`, `PRICE_WEI`, `PORT`.

## Deploy to Fly.io

```bash
cp fly.toml.example fly.toml
fly launch --copy-config --no-deploy
fly secrets set PROVIDER_PRIVATE_KEY=0x... \
                CHAIN_RPC_URL=https://rpc.testnet.monad.xyz \
                MARKETPLACE_ADDRESS=0x... \
                PROVIDER_ADDRESS=0x... \
                TOOL_ID=1 \
                PRICE_WEI=30000000000000000
fly deploy
```

## Register the tool with Marketplace

From a foundry script / cast call, the provider wallet does:

```solidity
marketplace.registerTool(
  "http://your-host:4100/invoke",          // endpoint
  bytes32(0x...),                          // schemaHash (IPFS CID hashed)
  uint128(30000000000000000),              // price per call (wei)
  "echo-provider",
  "Echoes any JSON input back as { echo: <input> }.",
  PROVIDER_ADDRESS                         // payout
);
```

The returned `toolId` is what you pass into `TOOL_ID` above.

## Calling it (Worker side)

The Worker pipeline (`api/src/worker/runTask.ts`) sends:

```
POST http://your-host:4100/invoke
Content-Type: application/json
X-AgentPay-Receipt: 0x...
X-AgentPay-Agent-Id: <agentId>
X-AgentPay-Tool-Id: <toolId>
X-AgentPay-Step: <stepIdx>
X-AgentPay-Input-Hash: 0xkeccak256(rawBody)

{ "input": { ... } }
```

If everything checks out you get `200 { "output": { "echo": ... } }`. Otherwise
`402` with a `WWW-Authenticate` advertising the price.
