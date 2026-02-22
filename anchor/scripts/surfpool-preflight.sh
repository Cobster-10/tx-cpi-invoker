#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ANCHOR_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
ANCHOR_TOML="${ANCHOR_DIR}/Anchor.toml"
RPC_URL="${ANCHOR_PROVIDER_URL:-http://127.0.0.1:8899}"
RUN_TESTS="${RUN_STORK_TESTS:-0}"

if [[ ! -f "${ANCHOR_TOML}" ]]; then
  echo "ERROR: Anchor.toml not found at ${ANCHOR_TOML}" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: curl is required" >&2
  exit 1
fi

if ! command -v solana >/dev/null 2>&1; then
  echo "ERROR: solana CLI is required" >&2
  exit 1
fi

PROGRAM_ID="$(
  awk '
    $0 ~ /^\[programs\.localnet\]/ { in_localnet=1; next }
    in_localnet && $0 ~ /^\[/ { in_localnet=0 }
    in_localnet && $0 ~ /order_executor[[:space:]]*=/ {
      match($0, /"[^"]+"/)
      if (RSTART > 0) {
        print substr($0, RSTART + 1, RLENGTH - 2)
        exit
      }
    }
  ' "${ANCHOR_TOML}"
)"

if [[ -z "${PROGRAM_ID}" ]]; then
  echo "ERROR: Could not resolve [programs.localnet].order_executor from ${ANCHOR_TOML}" >&2
  exit 1
fi

echo "Surfpool preflight"
echo "  Anchor dir : ${ANCHOR_DIR}"
echo "  RPC URL    : ${RPC_URL}"
echo "  Program ID : ${PROGRAM_ID}"

SURFPOOL_METHOD=""
for method in surfnet_getSurfnetInfo surfnet_getSurfnetInfos; do
  response="$(
    curl -s "${RPC_URL}" \
      -H 'Content-Type: application/json' \
      -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"${method}\",\"params\":[]}" || true
  )"
  if [[ "${response}" == *"\"result\""* ]]; then
    SURFPOOL_METHOD="${method}"
    break
  fi
done

if [[ -z "${SURFPOOL_METHOD}" ]]; then
  echo "ERROR: Surfpool cheatcode info RPC method not detected at ${RPC_URL}" >&2
  echo "Tried: surfnet_getSurfnetInfo, surfnet_getSurfnetInfos" >&2
  exit 1
fi

echo "  Surfpool RPC check: OK (${SURFPOOL_METHOD})"

if ! solana program show "${PROGRAM_ID}" --url "${RPC_URL}" >/dev/null; then
  echo "ERROR: Program ${PROGRAM_ID} not found/executable on ${RPC_URL}" >&2
  echo "Start Surfpool from ${ANCHOR_DIR} and verify auto-deploy logs." >&2
  exit 1
fi

echo "  Program deployment check: OK"

if [[ "${RUN_TESTS}" == "1" ]]; then
  echo "Running Stork Surfpool tests..."
  (
    cd "${ANCHOR_DIR}"
    ANCHOR_PROVIDER_URL="${RPC_URL}" \
    ANCHOR_WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}" \
    npm run test:surfpool:stork
  )
fi

echo "Preflight complete."
