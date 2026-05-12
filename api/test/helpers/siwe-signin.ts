// Test helper: completes a full SIWE roundtrip against the test app and
// returns the session cookie value. Used by agents.test.ts / tasks.test.ts.

import type { FastifyInstance } from "fastify";
import { privateKeyToAccount } from "viem/accounts";
import { expect } from "vitest";
import { COOKIE_NAME } from "../../src/lib/env.js";

export const TEST_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

export const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY);
export const TEST_ADDRESS = TEST_ACCOUNT.address;

const TEST_URI = "http://localhost:3000";

export async function siweSignin(
  app: FastifyInstance,
  privateKey: `0x${string}` = TEST_PRIVATE_KEY,
): Promise<{ cookie: string; address: `0x${string}` }> {
  const account = privateKeyToAccount(privateKey);
  const nonceRes = await app.inject({
    method: "POST",
    url: "/api/auth/nonce",
    payload: { address: account.address, uri: TEST_URI },
  });
  expect(nonceRes.statusCode).toBe(200);
  const { message } = nonceRes.json() as { nonce: string; message: string };
  const signature = await account.signMessage({ message });
  const verifyRes = await app.inject({
    method: "POST",
    url: "/api/auth/verify",
    payload: { message, signature },
  });
  expect(verifyRes.statusCode).toBe(200);

  const raw = verifyRes.headers["set-cookie"];
  const arr = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  let cookieValue: string | null = null;
  for (const line of arr) {
    if (line.startsWith(`${COOKIE_NAME}=`)) {
      const eqIdx = line.indexOf("=");
      const semiIdx = line.indexOf(";");
      cookieValue = line.slice(eqIdx + 1, semiIdx === -1 ? undefined : semiIdx);
      break;
    }
  }
  if (!cookieValue) throw new Error("no session cookie in verify response");
  return { cookie: cookieValue, address: account.address };
}
