import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Schema-only configuration. Actual migrations are deferred until Neon is
// provisioned and DATABASE_URL is set. `drizzle-kit generate` will emit SQL
// without needing a live connection.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://placeholder/placeholder",
  },
  strict: true,
  verbose: true,
});
