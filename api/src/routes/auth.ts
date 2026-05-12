import type { FastifyPluginAsync } from "fastify";
import { SiweMessage, generateNonce } from "siwe";
import { z } from "zod";
import { COOKIE_NAME, env } from "../lib/env.js";

// In-memory nonce store. 5-min TTL. Pre-MVP scope; Redis-backed in production.
type NonceRecord = { nonce: string; expiresAt: number };
const nonceStore = new Map<string, NonceRecord>();
const NONCE_TTL_MS = 5 * 60 * 1000;

function sweepExpired() {
  const now = Date.now();
  for (const [k, v] of nonceStore) {
    if (v.expiresAt <= now) nonceStore.delete(k);
  }
}

const verifySchema = z.object({
  message: z.string().min(1),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

// Monad testnet chain id (per design doc §3 / openspec config)
const MONAD_TESTNET_CHAIN_ID = 10143;

export const authRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/auth/nonce — returns nonce + SIWE-formatted message string
  app.post("/api/auth/nonce", async (request) => {
    sweepExpired();
    const body = (request.body ?? {}) as { address?: string; uri?: string };
    const nonce = generateNonce();
    nonceStore.set(nonce, { nonce, expiresAt: Date.now() + NONCE_TTL_MS });

    // Frontend may pass address + uri; we return a ready-to-sign message
    // if they do. Otherwise return only the nonce and let the frontend
    // construct the SiweMessage itself (wagmi/viem helpers do this).
    let message: string | null = null;
    if (body.address && body.uri) {
      const siwe = new SiweMessage({
        domain: env.SIWE_DOMAIN,
        address: body.address,
        statement: "Sign in to AgentPay Passport.",
        uri: body.uri,
        version: "1",
        chainId: MONAD_TESTNET_CHAIN_ID,
        nonce,
        issuedAt: new Date().toISOString(),
      });
      message = siwe.prepareMessage();
    }

    return { nonce, message };
  });

  // POST /api/auth/verify — validates real signature, issues JWT cookie
  app.post("/api/auth/verify", async (request, reply) => {
    const parsed = verifySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body" });
    }
    const { message, signature } = parsed.data;

    let siwe: SiweMessage;
    try {
      siwe = new SiweMessage(message);
    } catch {
      return reply.code(400).send({ error: "invalid_siwe_message" });
    }

    const record = nonceStore.get(siwe.nonce);
    if (!record || record.expiresAt <= Date.now()) {
      return reply.code(401).send({ error: "nonce_unknown_or_expired" });
    }

    const result = await siwe.verify(
      {
        signature,
        nonce: siwe.nonce,
        domain: env.SIWE_DOMAIN,
        time: new Date().toISOString(),
      },
      { suppressExceptions: true },
    );

    if (!result.success) {
      return reply.code(401).send({
        error: "signature_verification_failed",
        reason: result.error?.type ?? "unknown",
      });
    }

    // One-time use: burn the nonce on successful verification
    nonceStore.delete(siwe.nonce);

    const address = result.data.address;
    const token = await reply.jwtSign({ address });
    reply.setCookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return { address };
  });

  // POST /api/auth/logout
  app.post("/api/auth/logout", async (_request, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return { ok: true };
  });

  // GET /api/auth/me
  app.get("/api/auth/me", async (request, reply) => {
    const token = request.cookies[COOKIE_NAME];
    if (!token) return reply.code(401).send({ error: "unauthenticated" });
    try {
      const decoded = (await request.jwtVerify({ onlyCookie: true })) as {
        address: string;
      };
      return { address: decoded.address };
    } catch {
      return reply.code(401).send({ error: "invalid_session" });
    }
  });
};
