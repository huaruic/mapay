/**
 * api/src/chain/abi.ts
 *
 * Loads the Marketplace + Passport ABIs from the compiled Foundry artifacts
 * at `contracts/out/<Name>.sol/<Name>.json` and re-exports them as viem `Abi`.
 *
 * Why read JSON directly instead of importing `lib/abi/<Name>.ts`?
 *   - `lib/abi/*.ts` lives outside the API's `tsconfig.json#compilerOptions.rootDir`
 *     ("src"), so TS would refuse the cross-root import. Adding a path-mapping
 *     works but pulls the entire `lib/` graph into the API build surface, which
 *     would also force `next.config.ts` types into scope. Reading the JSON is
 *     hermetic and exercises the same artifacts the typed `lib/abi/*.ts` exports
 *     are generated from.
 *   - The same artifact powers `scripts/sync-abi.ts`, so frontend (typed `as const`)
 *     and backend (runtime-loaded JSON) stay in lock-step.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Abi } from "viem";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// api/src/chain/abi.ts -> repo root is three levels up:
//   abi.ts -> chain/ -> src/ -> api/ -> repo-root/
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const OUT_DIR = join(REPO_ROOT, "contracts", "out");

function loadArtifactAbi(file: string, contract: string): Abi {
  const path = join(OUT_DIR, file, `${contract}.json`);
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as { abi?: unknown };
  if (!Array.isArray(parsed.abi)) {
    throw new Error(`Artifact ${path} is missing an "abi" array`);
  }
  return parsed.abi as Abi;
}

export const MarketplaceAbi: Abi = loadArtifactAbi(
  "Marketplace.sol",
  "Marketplace",
);

export const PassportAbi: Abi = loadArtifactAbi("Passport.sol", "Passport");
