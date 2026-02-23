# Anchor Workspace (order_executor)

This directory contains the Anchor program, integration tests, and the local Surfpool test workflow.

## What Is Here

- `programs/order_executor/` — on-chain program source
- `programs/order_executor/ARCHITECTURE.md` — on-chain design and execution model (kept separate on purpose)
- `tests/basic_tests.ts` — basic create/execute/cancel integration tests
- `tests/stork_tests.ts` — Surfpool-only Stork trigger tests (synthetic Stork feeds)
- `tests/helpers/surfpool.ts` — Surfpool cheatcode compatibility helpers
- `Surfpool.toml` — Surfpool manifest
- `txtx.yml` + `runbooks/` — Surfpool/txtx deployment workspace (generated/used by Surfpool)
- `scripts/surfpool-preflight.sh` — verifies Surfpool RPC and local program deployment before tests

## Requirements

- Solana CLI
- Anchor CLI
- Rust toolchain
- Node/npm
- `surfpool` CLI (for Surfpool workflow)
- wallet at `~/.config/solana/id.json` (or set `ANCHOR_WALLET`)

Install Surfpool (if needed):

```bash
curl -sL https://run.surfpool.run/ | bash
```

## Program ID Sync (Important)

Before local deploy/testing, keep these in sync:

- `Anchor.toml`
- `programs/order_executor/src/lib.rs` (`declare_id!`)
- `target/idl/order_executor.json`
- `target/deploy/order_executor-keypair.json`

Recommended local sync flow:

```bash
cd ./anchor
anchor keys sync
anchor build
```

Use this again if you see a deploy error about program keypair/IDL mismatch.

## Build

```bash
cd ./anchor
anchor build
```

## Rust Tests (program-level)

```bash
cd ./anchor
cargo test -p order_executor -- --nocapture
```

## TypeScript Tests (RPC-backed)

Requires an RPC on `127.0.0.1:8899` (Surfpool or validator).

### Run all TS tests

```bash
cd ./anchor
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=$HOME/.config/solana/id.json npm run test
```

### What `tests/basic_tests.ts` verifies

- user counter initialization
- order creation stores expected fields and funds vault
- keeper execution path (`execute_order_if_ready`) succeeds
- cancel path refunds and marks order canceled

### What `tests/stork_tests.ts` verifies

- `PriceBelowStork` success/failure
- `PriceAboveStork` success/failure
- `StorkOutcomeEquals` success/failure
- stale Stork feed rejection (`StaleOraclePrice`)
- wrong Stork feed account rejection (`InvalidOracleAccount`)

Notes:
- tests resolve the program ID from `Anchor.toml` based on RPC endpoint (localhost => `[programs.localnet]`)
- `tests/stork_tests.ts` uses Surfpool cheatcodes for synthetic Stork feed seeding
- `tests/helpers/surfpool.ts` includes compatibility fallbacks for Surfpool version differences (`Info` vs `Infos`, clock/time-travel variations)

## Surfpool Workflow (Recommended)

Run Surfpool from `anchor/` (not repo root) to avoid duplicate local workspace files.

### 1) Start Surfpool (Terminal 1)

```bash
cd ./anchor
surfpool start -m ./Surfpool.toml --no-tui --debug
```

If your Surfpool build needs it for Anchor auto-deploy:

```bash
cd ./anchor
surfpool start -m ./Surfpool.toml --legacy-anchor-compatibility --no-tui --debug
```

First run may prompt for a txtx workspace name and generate `txtx.yml` + `runbooks/`.

### 2) Preflight check (Terminal 2)

```bash
cd ./anchor
npm run surfpool:preflight
```

Preflight verifies:
- Surfpool RPC is reachable
- Surfpool cheatcode info method exists (`surfnet_getSurfnetInfo` or `surfnet_getSurfnetInfos`)
- local program is deployed/executable on `127.0.0.1:8899`

### 3) Run Stork Surfpool tests (Terminal 2)

```bash
cd ./anchor
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=$HOME/.config/solana/id.json npm run test:surfpool:stork
```

Expected:
- `7 passing`

### 4) One command (preflight + Stork tests)

```bash
cd ./anchor
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=$HOME/.config/solana/id.json npm run test:surfpool:stork:preflight
```

## Mainnet-Fork Variant (Optional)

Execution is still local; Surfpool uses mainnet as source RPC.

```bash
cd ./anchor
surfpool start -m ./Surfpool.toml -u https://api.mainnet-beta.solana.com --no-tui --debug
```

Then run the same preflight + test commands.

## Manual Verification Commands

### Check Surfpool RPC (try both method names)

```bash
curl -s http://127.0.0.1:8899 -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"surfnet_getSurfnetInfo","params":[]}'
```

```bash
curl -s http://127.0.0.1:8899 -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"surfnet_getSurfnetInfos","params":[]}'
```

### Check local program deployment on Surfpool

```bash
cd ./anchor
LOCALNET_PROGRAM_ID=$(awk '/^\[programs\.localnet\]/{f=1;next} /^\[/{f=0} f && /order_executor/{gsub(/.*"/,""); gsub(/".*/,""); print; exit}' Anchor.toml)
solana program show "$LOCALNET_PROGRAM_ID" --url http://127.0.0.1:8899
```

## Troubleshooting (Short)

### `This program may not be used for executing instructions`
Program is missing/not executable on the Surfpool RPC.

Do:
1. `cd ./anchor && anchor build`
2. restart Surfpool from `./anchor`
3. `cd ./anchor && npm run surfpool:preflight`

### `surfpool run deployment` keypair/IDL mismatch
`target/deploy/order_executor-keypair.json` pubkey does not match `declare_id!` / IDL.

Do:
```bash
cd ./anchor
anchor keys sync
anchor build
```

### Stork tests fail on clock cheatcodes (`getClock`, `advanceClock`)
Your Surfpool build may not support all clock cheatcodes or may use different `timeTravel` params/units.
`tests/helpers/surfpool.ts` already includes compatibility fallbacks.

### `MODULE_TYPELESS_PACKAGE_JSON` warning
Harmless Node warning from mocha/ts-node test execution.

## Related Docs

- `programs/order_executor/ARCHITECTURE.md` (on-chain architecture)
- `runbooks/README.md` (generated Surfpool/txtx runbook docs)
