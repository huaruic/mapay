#!/usr/bin/env bash
# Local Anvil deploy for AgentPay Passport.
#
# - Starts a fresh `anvil` on 127.0.0.1:8545 if one isn't already listening
# - Runs forge script DeployLocal.s.sol with Anvil's default key 0
# - Parses Foundry's broadcast JSON for the deployed Passport + Marketplace
#   addresses and writes them to lib/abi/addresses.local.json (and refreshes
#   lib/abi/addresses.example.json placeholders)
#
# This script must be invoked from the repo's contracts/ directory; the npm
# script `deploy:local` in contracts/package.json does so.
set -euo pipefail

# Repo paths — resolved relative to this script so it works from any cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$CONTRACTS_DIR/.." && pwd)"
ABI_DIR="$REPO_ROOT/lib/abi"
mkdir -p "$ABI_DIR"

# Ensure foundry binaries are on PATH (matches root-level convention).
export PATH="$HOME/.foundry/bin:$PATH"

RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
ANVIL_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
ANVIL_PID=""

# Cleanup on exit — only kill the anvil we started.
cleanup() {
  if [[ -n "$ANVIL_PID" ]] && kill -0 "$ANVIL_PID" 2>/dev/null; then
    echo "[deploy-local] stopping anvil (pid=$ANVIL_PID)"
    kill "$ANVIL_PID" 2>/dev/null || true
    wait "$ANVIL_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Helper: probe RPC port for a real Ethereum JSON-RPC response.
# Bypasses HTTP_PROXY/HTTPS_PROXY and intercepting proxies (Surge etc.) so we
# don't get false positives from a proxy's "unreachable" HTML page.
probe_rpc() {
  curl -s --max-time 1 --noproxy '*' \
    -X POST "$RPC_URL" \
    -H "content-type: application/json" \
    --data '{"jsonrpc":"2.0","method":"eth_chainId","id":1}' 2>/dev/null \
    | grep -q '"result"'
}

# Start anvil only if nothing is already listening on the RPC port.
if probe_rpc; then
  echo "[deploy-local] anvil already running at $RPC_URL — reusing"
else
  echo "[deploy-local] starting anvil at $RPC_URL"
  anvil --silent --host 127.0.0.1 --port 8545 &
  ANVIL_PID=$!

  # Poll until anvil answers eth_chainId, max ~10s.
  for _ in $(seq 1 50); do
    if probe_rpc; then
      break
    fi
    sleep 0.2
  done
  if ! probe_rpc; then
    echo "[deploy-local] ERROR: anvil never became reachable at $RPC_URL" >&2
    exit 1
  fi
fi

cd "$CONTRACTS_DIR"

echo "[deploy-local] running forge script DeployLocal.s.sol"
forge script script/DeployLocal.s.sol \
  --rpc-url "$RPC_URL" \
  --broadcast \
  --private-key "$ANVIL_KEY"

# Anvil chain id = 31337. Broadcast JSON for run-latest lives here:
BROADCAST_JSON="$CONTRACTS_DIR/broadcast/DeployLocal.s.sol/31337/run-latest.json"
if [[ ! -f "$BROADCAST_JSON" ]]; then
  echo "[deploy-local] ERROR: broadcast JSON not found at $BROADCAST_JSON" >&2
  exit 1
fi

# Parse Passport + Marketplace addresses from the broadcast transactions.
# `transactions[*]` is in deploy order: Passport first, Marketplace second.
PASSPORT_ADDR=$(node -e "
const j = require('$BROADCAST_JSON');
const t = j.transactions.find(x => x.contractName === 'Passport');
if (!t) { console.error('no Passport tx'); process.exit(1); }
process.stdout.write(t.contractAddress);
")
MARKETPLACE_ADDR=$(node -e "
const j = require('$BROADCAST_JSON');
const t = j.transactions.find(x => x.contractName === 'Marketplace');
if (!t) { console.error('no Marketplace tx'); process.exit(1); }
process.stdout.write(t.contractAddress);
")

cat > "$ABI_DIR/addresses.local.json" <<JSON
{
  "chainId": 31337,
  "network": "anvil-local",
  "passport": "$PASSPORT_ADDR",
  "marketplace": "$MARKETPLACE_ADDR"
}
JSON

# Refresh the placeholder example file so it always documents the expected shape.
cat > "$ABI_DIR/addresses.example.json" <<'JSON'
{
  "chainId": 10143,
  "network": "monad-testnet",
  "passport": "0x0000000000000000000000000000000000000000",
  "marketplace": "0x0000000000000000000000000000000000000000"
}
JSON

echo "[deploy-local] Passport:    $PASSPORT_ADDR"
echo "[deploy-local] Marketplace: $MARKETPLACE_ADDR"
echo "[deploy-local] wrote $ABI_DIR/addresses.local.json"
