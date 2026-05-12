// Force test-mode env values BEFORE any source modules load.
// `src/lib/env.ts` reads `process.env` at module-evaluation time, so this file
// must run via vitest's `globalSetup`/import order before any test file imports
// from `../src/...`.
//
// Pre-load dotenv so any `.env` values land NOW (under our control) instead of
// later via `src/lib/env.ts`. After this we can selectively delete keys that
// would contaminate the default test mode.
import "dotenv/config";

process.env.NODE_ENV = "test";
process.env.PORT = process.env.PORT ?? "4001";
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:3000";
process.env.JWT_SECRET =
  process.env.JWT_SECRET ??
  "test-only-jwt-secret-very-long-and-not-used-anywhere-real";
process.env.SIWE_DOMAIN = process.env.SIWE_DOMAIN ?? "localhost:3000";
process.env.MONAD_TESTNET_RPC_URL =
  process.env.MONAD_TESTNET_RPC_URL ?? "https://rpc.testnet.monad.xyz";
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "silent";

// Force mock-mode by default so tests are isolated from a developer's local
// `api/.env` (loaded by dotenv via `src/lib/env.ts`). The chain-aware test
// suite sets MARKETPLACE_ADDRESS in its own beforeAll.
delete process.env.MARKETPLACE_ADDRESS;
