// One-off migration runner used in lieu of `drizzle-kit generate/migrate` CLI,
// which is currently incompatible with this project's tsconfig target (ES2023
// is unsupported by the esbuild version bundled with drizzle-kit 0.30.x).
//
// What this script does (idempotent):
//   1. Loads our Drizzle schema (src/db/schema.ts) via tsx.
//   2. If `api/drizzle/` is empty, calls drizzle-kit's `generateMigration` API
//      to diff the schema vs an empty snapshot and writes a single
//      `0000_init.sql` plus a minimal `meta/_journal.json` + snapshot.
//   3. Calls drizzle-orm's `migrate()` against the live Neon DB to apply any
//      pending migration files.
//
// Run with: `npx tsx scripts/migrate.ts`

import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "../src/db/schema.js";

// drizzle-kit's ESM build (api.mjs) is broken (uses dynamic require). Pull in
// the CJS build via createRequire so it actually runs under tsx.
const require = createRequire(import.meta.url);
// Direct require of the CJS file (drizzle-kit's `./api` export points ESM
// consumers at api.mjs, which is broken — bypass the export map).
const drizzleKitApi = require(
  resolve(
    process.cwd(),
    "node_modules",
    "drizzle-kit",
    "api.js",
  ),
) as {
  generateDrizzleJson: (
    imports: Record<string, unknown>,
    prevId?: string,
    schemaFilters?: string[],
  ) => Record<string, unknown>;
  generateMigration: (
    prev: Record<string, unknown>,
    cur: Record<string, unknown>,
  ) => Promise<string[]>;
};
const { generateDrizzleJson, generateMigration } = drizzleKitApi;

const MIGRATIONS_DIR = resolve(process.cwd(), "drizzle");
const META_DIR = resolve(MIGRATIONS_DIR, "meta");

function existingTags(): string[] {
  try {
    return readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.replace(/\.sql$/, ""))
      .sort();
  } catch {
    return [];
  }
}

async function ensureInitialMigration(): Promise<void> {
  if (existingTags().length > 0) {
    console.log(`[migrate] existing migration files present; skipping generation`);
    return;
  }
  console.log(`[migrate] no migrations found — generating initial migration`);
  mkdirSync(META_DIR, { recursive: true });

  // Empty PG snapshot to diff against.
  const empty = {
    version: "7",
    dialect: "postgresql",
    id: randomUUID(),
    prevId: "00000000-0000-0000-0000-000000000000",
    tables: {},
    enums: {},
    schemas: {},
    sequences: {},
    views: {},
    _meta: { columns: {}, schemas: {}, tables: {} },
  };
  const current = generateDrizzleJson(schema as Record<string, unknown>);
  const statements = await generateMigration(empty as never, current as never);
  if (statements.length === 0) {
    console.log("[migrate] no diff against empty snapshot (unexpected)");
    return;
  }
  const tag = "0000_init";
  const sql = statements.join("\n--> statement-breakpoint\n");
  writeFileSync(resolve(MIGRATIONS_DIR, `${tag}.sql`), sql);

  // Snapshot of current schema for the journal. drizzle-kit normally writes
  // 0000_snapshot.json here; we only need it to satisfy `migrate()` if it
  // peeks (it doesn't), so we keep it as documentation.
  writeFileSync(
    resolve(META_DIR, `${tag}_snapshot.json`),
    JSON.stringify(current, null, 2),
  );

  const journal = {
    version: "7",
    dialect: "postgresql",
    entries: [
      {
        idx: 0,
        version: "7",
        when: Date.now(),
        tag,
        breakpoints: true,
      },
    ],
  };
  writeFileSync(resolve(META_DIR, "_journal.json"), JSON.stringify(journal, null, 2));
  console.log(`[migrate] wrote drizzle/${tag}.sql (${statements.length} statements)`);
}

async function applyMigrations(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[migrate] DATABASE_URL not set — aborting");
    process.exit(1);
  }
  // Hide the URL — only log the host so we know which DB we hit.
  let host = "unknown";
  try {
    host = new URL(url).host;
  } catch {
    // ignore
  }
  console.log(`[migrate] applying migrations to host=${host}`);
  const client = postgres(url, { max: 1, prepare: false });
  const db = drizzle(client);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    console.log("[migrate] done");
  } finally {
    await client.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  await ensureInitialMigration();
  await applyMigrations();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Silence unused-import warnings for the hash util — kept for future migration
// integrity checks if we move off drizzle-orm's bundled `readMigrationFiles`.
void createHash;
