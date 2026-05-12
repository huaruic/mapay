// Lightweight per-request auth guard for protected routes.
// Mirrors GET /api/auth/me logic (cookie → JWT → address) so each route can
// require auth without re-implementing the cookie sniff.
//
// Returns null and writes a 401 response when auth fails. Caller should `return`
// immediately on null so we don't try to send a body afterwards.

import type { FastifyReply, FastifyRequest } from "fastify";
import { COOKIE_NAME } from "./env.js";

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<`0x${string}` | null> {
  const token = request.cookies[COOKIE_NAME];
  if (!token) {
    reply.code(401).send({ error: "unauthenticated" });
    return null;
  }
  try {
    const decoded = (await request.jwtVerify({ onlyCookie: true })) as {
      address: string;
    };
    return decoded.address as `0x${string}`;
  } catch {
    reply.code(401).send({ error: "invalid_session" });
    return null;
  }
}
