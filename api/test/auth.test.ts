import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { COOKIE_NAME } from "../src/lib/env.js";
import { buildTestApp } from "./helpers/build-app.js";

// Deterministic test key (NEVER reuse anywhere outside tests). This corresponds
// to a well-known address recoverable from any ECDSA verifier.
const TEST_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const account = privateKeyToAccount(TEST_PRIVATE_KEY);
const TEST_ADDRESS = account.address; // EIP-55 checksum
const TEST_URI = "http://localhost:3000";

type NonceResponse = { nonce: string; message: string | null };
type VerifyOkResponse = { address: string };
type ErrorResponse = { error: string; reason?: string };

async function getNonceAndMessage(
  app: FastifyInstance,
): Promise<{ nonce: string; message: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/nonce",
    payload: { address: TEST_ADDRESS, uri: TEST_URI },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as NonceResponse;
  expect(typeof body.nonce).toBe("string");
  expect(body.nonce.length).toBeGreaterThanOrEqual(8);
  expect(body.message).not.toBeNull();
  return { nonce: body.nonce, message: body.message as string };
}

function parseSessionCookie(headers: Record<string, unknown>): string | null {
  const raw = headers["set-cookie"];
  const arr = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  for (const line of arr) {
    if (line.startsWith(`${COOKIE_NAME}=`)) {
      // Return the cookie value (drop attributes after the first `;`)
      const eqIdx = line.indexOf("=");
      const semiIdx = line.indexOf(";");
      return line.slice(eqIdx + 1, semiIdx === -1 ? undefined : semiIdx);
    }
  }
  return null;
}

describe("Auth — SIWE flow", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  test("POST /api/auth/nonce returns nonce + ready-to-sign message", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/nonce",
      payload: { address: TEST_ADDRESS, uri: TEST_URI },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as NonceResponse;
    expect(typeof body.nonce).toBe("string");
    expect(body.message).toContain(body.nonce);
    expect(body.message).toContain(TEST_ADDRESS);
  });

  test("POST /api/auth/nonce without address returns message=null", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/nonce",
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as NonceResponse;
    expect(typeof body.nonce).toBe("string");
    expect(body.message).toBeNull();
  });

  test("full roundtrip: sign → verify sets cookie and returns address", async () => {
    const { message } = await getNonceAndMessage(app);
    const signature = await account.signMessage({ message });
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/verify",
      payload: { message, signature },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as VerifyOkResponse;
    expect(body.address).toBe(TEST_ADDRESS);

    const cookieValue = parseSessionCookie(res.headers);
    expect(cookieValue).not.toBeNull();
    expect((cookieValue as string).length).toBeGreaterThan(0);
  });

  test("nonce mismatch in message body is rejected with 401", async () => {
    const { message } = await getNonceAndMessage(app);
    // Tamper: rewrite the Nonce: line with a bogus nonce of correct length.
    const tampered = message.replace(
      /Nonce: [A-Za-z0-9]+/,
      "Nonce: tamperedNonce12345",
    );
    // Sign the tampered message so the signature itself is valid, only the
    // nonce inside the message is unknown to the server.
    const signature = await account.signMessage({ message: tampered });
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/verify",
      payload: { message: tampered, signature },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as ErrorResponse;
    expect(body.error).toBe("nonce_unknown_or_expired");
  });

  test("bad signature is rejected with 401", async () => {
    const { message } = await getNonceAndMessage(app);
    const goodSig = await account.signMessage({ message });
    // Flip a hex digit near the end (preserves length + 0x prefix).
    const lastHex = goodSig.slice(-1);
    const flipped = lastHex === "a" ? "b" : "a";
    const badSig = (goodSig.slice(0, -1) + flipped) as `0x${string}`;
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/verify",
      payload: { message, signature: badSig },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as ErrorResponse;
    expect(body.error).toBe("signature_verification_failed");
  });

  test("replay: same nonce cannot be verified twice", async () => {
    const { message } = await getNonceAndMessage(app);
    const signature = await account.signMessage({ message });
    const first = await app.inject({
      method: "POST",
      url: "/api/auth/verify",
      payload: { message, signature },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: "/api/auth/verify",
      payload: { message, signature },
    });
    expect(second.statusCode).toBe(401);
    const body = second.json() as ErrorResponse;
    expect(body.error).toBe("nonce_unknown_or_expired");
  });

  test("invalid body shape (missing signature) → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/verify",
      payload: { message: "anything" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as ErrorResponse;
    expect(body.error).toBe("invalid_body");
  });

  test("non-SIWE message string → 400 invalid_siwe_message", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/verify",
      payload: { message: "not a siwe message", signature: "0xdeadbeef" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as ErrorResponse;
    expect(body.error).toBe("invalid_siwe_message");
  });

  test("GET /api/auth/me with valid cookie returns the address", async () => {
    const { message } = await getNonceAndMessage(app);
    const signature = await account.signMessage({ message });
    const verifyRes = await app.inject({
      method: "POST",
      url: "/api/auth/verify",
      payload: { message, signature },
    });
    expect(verifyRes.statusCode).toBe(200);
    const cookie = parseSessionCookie(verifyRes.headers);
    expect(cookie).not.toBeNull();

    const meRes = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { [COOKIE_NAME]: cookie as string },
    });
    expect(meRes.statusCode).toBe(200);
    const meBody = meRes.json() as VerifyOkResponse;
    expect(meBody.address).toBe(TEST_ADDRESS);
  });

  test("GET /api/auth/me without cookie returns 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/auth/me" });
    expect(res.statusCode).toBe(401);
    const body = res.json() as ErrorResponse;
    expect(body.error).toBe("unauthenticated");
  });

  test("GET /api/auth/me with malformed cookie returns 401 invalid_session", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { [COOKIE_NAME]: "not-a-real-jwt" },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as ErrorResponse;
    expect(body.error).toBe("invalid_session");
  });

  test("POST /api/auth/logout clears cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
    });
    expect(res.statusCode).toBe(200);
    const setCookieRaw = res.headers["set-cookie"];
    const arr = Array.isArray(setCookieRaw)
      ? setCookieRaw
      : setCookieRaw
        ? [String(setCookieRaw)]
        : [];
    const cleared = arr.find((line) => line.startsWith(`${COOKIE_NAME}=`));
    expect(cleared).toBeDefined();
    // Fastify's clearCookie emits an empty value + Expires in the past.
    expect(cleared).toMatch(/=;|Expires=|Max-Age=0/);
  });

  test("expired nonce: advance system time past 5min TTL → 401", async () => {
    // Acquire the nonce + sign while the real clock is in effect so that
    // viem's async signing isn't disturbed by faked timers.
    const { message } = await getNonceAndMessage(app);
    const signature = await account.signMessage({ message });

    // Now freeze the clock just past the 5-minute TTL and replay verify.
    // Only fake `Date` — leaving setTimeout/setImmediate/etc. real so that
    // Fastify's internal scheduling and viem's async work continue normally.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(Date.now() + 5 * 60 * 1000 + 1000));
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/verify",
        payload: { message, signature },
      });
      expect(res.statusCode).toBe(401);
      const body = res.json() as ErrorResponse;
      expect(body.error).toBe("nonce_unknown_or_expired");
    } finally {
      vi.useRealTimers();
    }
  });
});
