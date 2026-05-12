import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

// Vitest 4 multi-project config:
// - "node" runs pure-logic / config unit tests (no DOM).
// - "jsdom" runs anything that touches React / app pages.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": rootDir,
    },
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
      exclude: [
        "lib/providers.tsx",
        "lib/wagmi.ts",
        "app/layout.tsx",
        "app/**/loading.tsx",
        "app/**/error.tsx",
        "**/*.d.ts",
      ],
    },
    projects: [
      {
        plugins: [react()],
        resolve: {
          alias: { "@": rootDir },
        },
        test: {
          name: "node",
          environment: "node",
          include: ["test/unit/**/*.test.{ts,tsx}"],
        },
      },
      {
        plugins: [react()],
        resolve: {
          alias: { "@": rootDir },
        },
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["test/components/**/*.test.{ts,tsx}", "test/pages/**/*.test.{ts,tsx}"],
          setupFiles: ["./test/setup.ts"],
        },
      },
    ],
  },
});
