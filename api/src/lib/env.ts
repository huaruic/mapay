import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

export const env = {
  PORT: Number(process.env.PORT ?? 4000),
  CORS_ORIGIN: required("CORS_ORIGIN", "http://localhost:3000"),
  JWT_SECRET: required("JWT_SECRET", "dev-only-insecure-secret-change-me"),
  DATABASE_URL: optional("DATABASE_URL"),
  MONAD_TESTNET_RPC_URL: required(
    "MONAD_TESTNET_RPC_URL",
    "https://rpc.testnet.monad.xyz",
  ),
  SIWE_DOMAIN: required("SIWE_DOMAIN", "localhost:3000"),
} as const;

export const COOKIE_NAME = "agentpay_session";
