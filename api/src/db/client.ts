// Lazy Drizzle client. Skips initialization (returns null) when DATABASE_URL is
// absent — hackathon scaffold ships without a live DB; routes that need DB
// access must check this and fail gracefully.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../lib/env.js";
import * as schema from "./schema.js";

type Client = ReturnType<typeof drizzle<typeof schema>>;

let cached: Client | null = null;
let warned = false;

export function getDb(): Client | null {
  if (cached) return cached;
  if (!env.DATABASE_URL) {
    if (!warned) {
      console.warn(
        "[db] DATABASE_URL not set; running without Postgres. " +
          "DB-backed routes will fail. Set DATABASE_URL in .env to enable.",
      );
      warned = true;
    }
    return null;
  }
  const sql = postgres(env.DATABASE_URL, { prepare: false });
  cached = drizzle(sql, { schema });
  return cached;
}
