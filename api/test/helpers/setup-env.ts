// Force test-mode env values BEFORE any source modules load.
// `src/lib/env.ts` reads `process.env` at module-evaluation time, so this file
// must run via vitest's `globalSetup`/import order before any test file imports
// from `../src/...`.
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
