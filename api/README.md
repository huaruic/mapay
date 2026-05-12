# AgentPay Passport — API

Fastify backend for AgentPay Passport. Companion to the Next.js frontend at the repo root.

## Run

```bash
cd api
cp .env.example .env       # then edit JWT_SECRET, SIWE_DOMAIN, etc.
npm install
npm run dev                # tsx watch on PORT (default 4000)
```

Type-check (current "lint"):

```bash
npm run lint               # tsc --noEmit
```

Production build:

```bash
npm run build && npm start
```

## Endpoints

### Health

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/healthz` | none | `{ ok, ts }` |

### Auth (SIWE — real signature verification)

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/auth/nonce` | Returns `{ nonce, message }`. Pass optional `{ address, uri }` in body to receive a fully formatted EIP-4361 message; otherwise frontend assembles it. Nonce stored in-memory with 5-minute TTL. |
| POST | `/api/auth/verify` | Body `{ message, signature }`. Parses message with `siwe`, verifies signature recovers the claimed address, checks nonce and domain. On success sets HTTP-only `agentpay_session` JWT cookie with `{ address }` claim. |
| POST | `/api/auth/logout` | Clears the session cookie. |
| GET | `/api/auth/me` | Reads JWT from cookie, returns `{ address }` or 401. |

### Marketplace (public, no auth)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/marketplace/tools?cursor=&limit=20` | Paginated tool list. **Mock data** until Marketplace.sol ships and the chain watcher populates `tools`. |
| GET | `/api/tools/:id` | Single tool. **Mock data**. |

## What's real vs mocked

| Concern | Status |
| --- | --- |
| SIWE nonce + signature verification | **Real** — `siwe@3` parses the message and recovers signer; rejects mismatched nonce / domain / signature. |
| JWT session cookie | **Real** — `@fastify/jwt` HS256, HTTP-only cookie, 7-day expiry. |
| Marketplace tools | **Mock** — 3 hard-coded tools in `src/lib/mock-tools.ts`. |
| Tool detail | **Mock**. |
| Postgres schema | **Defined** in `src/db/schema.ts` per design doc §6.3 — no migrations run, no live connection required to boot. |
| Chain watcher / contract events | **Not implemented** — depends on `contracts/` shipping first. |
| Worker (BullMQ, plan→pay→call→integrate) | **Not implemented** — Phase 2. |
| Operator burner key management | **Not implemented** — Phase 2. |
| Provider-facing routes (`/api/provider/...`) | **Not implemented** — Phase 1 contract work first. |

## Environment

See `.env.example`. Required:

- `JWT_SECRET` — generate with `openssl rand -base64 48`. Do not reuse the placeholder.
- `CORS_ORIGIN` — Next.js dev origin (default `http://localhost:3000`).
- `SIWE_DOMAIN` — must match the host the frontend uses; verification will reject mismatches.
- `DATABASE_URL` — Neon Postgres URL. Optional for the current scope (mock-only routes work without it); a warning prints at boot if unset.
- `MONAD_TESTNET_RPC_URL` — used by future chain watcher; not exercised yet.

## File tree

```
api/
├── README.md
├── .env.example
├── drizzle.config.ts
├── package.json
├── tsconfig.json
└── src/
    ├── server.ts
    ├── lib/
    │   ├── env.ts
    │   └── mock-tools.ts
    ├── routes/
    │   ├── auth.ts
    │   ├── health.ts
    │   └── marketplace.ts
    └── db/
        ├── client.ts
        └── schema.ts
```

## Deferred to later turns

- Contract event watcher (viem `watchContractEvent` + reorg handling) — blocked on contracts existing.
- Worker pipeline (plan → pay → call → integrate) — blocked on contracts + Provider SDK.
- Per-agent burner key creation and KMS-backed encryption — Phase 2.
- Provider routes (`prepare-register`, `prepare-update`, stats, earnings) — Phase 1.
- Agent routes (`prepare-create`, `prepare-fund`, tasks list) — Phase 2.
- SSE hub (Redis pub/sub + Last-Event-ID replay) — Phase 2.
- Real migrations (`drizzle-kit generate` + `drizzle-kit migrate`) — once Neon is provisioned.
