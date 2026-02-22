# Anchor Test Directory Guide

This directory contains TypeScript integration tests for the Anchor `order_executor` program.

## Directory Purpose

These tests validate:
- order creation / execution / cancellation behavior
- keeper-style execution paths
- Surfpool integration behavior
- Stork-triggered execution (with synthetic Stork feeds on Surfpool)

## Test Files and What They Are For

### `basic_tests.ts`
Primary integration suite for the `order_executor` program.

What it covers:
- user counter initialization
- order creation
- order execution (keeper-style path)
- order cancellation
- order state transitions and SOL movement checks

Important components inside:
- `createOrderWithTransferSetup(...)`
  - reusable helper that initializes a user/order and creates a transfer action
- `createOrderOnly(...)`
  - helper for creating subsequent orders without reinitializing the counter
- `resolveOrderExecutorProgramId(...)`
  - resolves the correct program ID from `Anchor.toml` based on the RPC endpoint (localhost => localnet)

Why the resolver matters:
- Anchor's `Program` constructor defaults to the IDL address (devnet in this repo).
- Local Surfpool tests need the `Anchor.toml` localnet program ID.
- Without this, tests may target the wrong program and fail with execution errors.

### `stork_tests.ts`
Surfpool-only integration suite for Stork-triggered orders.

What it covers:
- `PriceBelowStork` success/failure
- `PriceAboveStork` success/failure
- `StorkOutcomeEquals` success/failure
- stale Stork feed rejection (`StaleOraclePrice`)
- wrong Stork feed account rejection (`InvalidOracleAccount`)

Important components inside:
- `hasSurfpoolCheatcodes(...)`
  - checks Surfpool RPC cheatcode availability (via shared helper module)
  - supports both `surfnet_getSurfnetInfo` and `surfnet_getSurfnetInfos`
- PDA helpers:
  - `deriveOrderCounterPda(...)`
  - `deriveOrderPda(...)`
  - `deriveVaultPda(...)`
  - `deriveStorkFeedPda(...)`
- `createStorkOrder(...)`
  - creates an order with a Stork trigger variant (`below`, `above`, `outcome`)
- `executeStorkOrder(...)`
  - sends `execute_order_if_ready_stork`
- `seedStorkFeed(...)`
  - seeds a synthetic Stork feed account on Surfpool using `surfnet_setAccount`
  - uses documented payload shape first, with legacy payload fallback for compatibility
- feed encoding helpers:
  - `encodeTemporalNumericValueFeedAccount(...)`
  - `accountDiscriminator(...)`
  - integer LE encoders (`encodeU64Le`, `encodeI128Le`)
- `expectRpcFailure(...)`
  - asserts expected custom error paths in integration tests
- `resolveOrderExecutorProgramId(...)`
  - same program ID resolution fix as `basic_tests.ts`

Time handling in this suite:
- uses Surfpool clock cheatcodes (`surfnet_getClock`, `surfnet_advanceClock`) via the shared helper
- avoids host `Date.now()` for stale/fresh oracle timing checks

### `helpers/surfpool.ts`
Shared Surfpool cheatcode helper module for tests.

What it provides:
- Surfpool RPC method detection (`Info` vs `Infos`)
- generic cheatcode RPC wrapper with normalized error handling
- Surfpool clock helpers (`getSurfnetClock`, `advanceSurfnetClockSeconds`, timestamp in ns)
- `surfnet_setAccount` wrapper using documented payload shape first, plus legacy fallback

### `README.md` (this file)
Operational guide for running and understanding the test suites.

## What Changed (Reproducibility Notes)

These are the key fixes made so the Stork Surfpool tests pass reliably.

### On-chain Stork path fixes
- `feed_id` is committed at `create_order` inside the stored trigger.
- `execute_order_if_ready_stork` no longer accepts a tx-supplied `feed_id`.
- Execution derives expected `feed_id` from stored order trigger.
- Execution validates the passed `stork_feed` PDA against the committed `feed_id`.
- Added `PriceAboveStork` trigger support.

Reference:
- `/Users/nitishmalluru/Developer/tx-cpi-invoker/anchor/programs/order_executor/src/lib.rs`

### Keeper/client compatibility fixes
- Added `price_above_stork` trigger kind to keeper types.
- Updated Stork execute instruction encoding to send only the discriminator.
- Updated trigger decoding for `price_above_stork`.

References:
- `/Users/nitishmalluru/Developer/tx-cpi-invoker/services/keeper/src/orders/types.ts`
- `/Users/nitishmalluru/Developer/tx-cpi-invoker/services/keeper/src/solana/orderExecutorClient.ts`

### Test harness fixes
- Added Surfpool synthetic Stork suite (`stork_tests.ts`).
- Added shared Surfpool cheatcode helper module (`tests/helpers/surfpool.ts`).
- Added Surfpool RPC method compatibility (`Info` vs `Infos`).
- Added clear skip message when Surfpool cheatcodes are missing.
- Resolved program ID from `Anchor.toml` instead of blindly using IDL address.
- Converted Stork timestamp freshness tests to Surfpool clock control.
- Switched mocha TS registration to `ts-node/register/transpile-only`.

References:
- `/Users/nitishmalluru/Developer/tx-cpi-invoker/anchor/tests/stork_tests.ts`
- `/Users/nitishmalluru/Developer/tx-cpi-invoker/anchor/tests/basic_tests.ts`
- `/Users/nitishmalluru/Developer/tx-cpi-invoker/anchor/package.json`

### Config fix that unblocked Surfpool execution
- Aligned `anchor/Anchor.toml` localnet `order_executor` with the program's declared ID (`2f2ph1...`).

Reference:
- `/Users/nitishmalluru/Developer/tx-cpi-invoker/anchor/Anchor.toml`

### Surfpool workflow best-practice additions
- Added versioned Surfpool manifest (`anchor/Surfpool.toml`)
- Added preflight script to verify Surfpool RPC + program deployment before test runs

References:
- `/Users/nitishmalluru/Developer/tx-cpi-invoker/anchor/Surfpool.toml`
- `/Users/nitishmalluru/Developer/tx-cpi-invoker/anchor/scripts/surfpool-preflight.sh`

## Lessons Learned While Making This Work

1. Surfpool RPC method names vary by version (`surfnet_getSurfnetInfo` vs `surfnet_getSurfnetInfos`).
2. `This program may not be used for executing instructions` is usually a deployment/program-ID mismatch, not a business-logic bug.
3. Always verify the program on the actual RPC under test with `solana program show`.
4. Anchor tests can silently target the wrong program if the IDL address differs from your localnet `Anchor.toml` value.
5. Deterministic synthetic oracle tests are the fastest way to validate on-chain trigger logic before testing live integrations.

## Commands to Execute (End-to-End)

### Prerequisites
Install dependencies (repo root and `anchor/` if needed):

```bash
cd /Users/nitishmalluru/Developer/tx-cpi-invoker
npm install
cd /Users/nitishmalluru/Developer/tx-cpi-invoker/anchor
npm install
```

### 1) Build the Anchor program

From repo root:

```bash
cd /Users/nitishmalluru/Developer/tx-cpi-invoker
npm run anchor-build
```

Or directly from `anchor/`:

```bash
cd /Users/nitishmalluru/Developer/tx-cpi-invoker/anchor
anchor build
```

### 2) Run Rust unit tests (program-level)

```bash
cd /Users/nitishmalluru/Developer/tx-cpi-invoker/anchor
cargo test -p order_executor -- --nocapture
```

### 3) Start Surfpool (Terminal 1)

Local mode:

```bash
cd /Users/nitishmalluru/Developer/tx-cpi-invoker/anchor
surfpool start -m ./Surfpool.toml --no-tui --debug
```

Mainnet-fork mode (optional):

```bash
cd /Users/nitishmalluru/Developer/tx-cpi-invoker/anchor
surfpool start -m ./Surfpool.toml -u https://api.mainnet-beta.solana.com --no-tui --debug
```

If your local Surfpool version requires it for Anchor auto-deploy, add `--legacy-anchor-compatibility`.

### 4) Verify Surfpool RPC (Terminal 2)

```bash
curl -s http://127.0.0.1:8899 -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"surfnet_getSurfnetInfo","params":[]}'
```

If that returns `Method not found`, try:

```bash
curl -s http://127.0.0.1:8899 -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"surfnet_getSurfnetInfos","params":[]}'
```

### 5) Verify the program is deployed and executable on Surfpool

```bash
solana program show 2f2ph1Sgi14dAfKwYXNb5XPuAhuokWCW5WNLyfiQXKc2 --url http://127.0.0.1:8899
```

### 6) Run preflight (recommended)

```bash
cd /Users/nitishmalluru/Developer/tx-cpi-invoker/anchor
npm run surfpool:preflight
```

### 7) Run the Stork Surfpool suite

```bash
cd /Users/nitishmalluru/Developer/tx-cpi-invoker/anchor
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 \
ANCHOR_WALLET=$HOME/.config/solana/id.json \
npm run test:surfpool:stork
```

Expected:
- `7 passing`

### 8) Run all Anchor TypeScript tests (optional)

```bash
cd /Users/nitishmalluru/Developer/tx-cpi-invoker/anchor
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 \
ANCHOR_WALLET=$HOME/.config/solana/id.json \
npm run test
```

## Verification Steps (What to Confirm)

### Verify the on-chain Stork trigger behavior
The Surfpool Stork suite passing confirms:
- `PriceBelowStork` pass/fail behavior
- `PriceAboveStork` pass/fail behavior
- `StorkOutcomeEquals` numeric equality behavior
- stale-feed rejection
- wrong-feed-PDA rejection
- feed identity derived from stored trigger (not tx arg)

### Verify local-vs-mainnet-like behavior
If you run the same suite against Surfpool `--network mainnet` and it still passes, you have validated:
- local execution correctness
- compatibility with a mainnet-fork Surfpool environment

### Verify configuration consistency (one-time check)
Confirm program IDs align:
- `declare_id!` in program source
- `Anchor.toml` `[programs.localnet]`
- deployed program shown by `solana program show` on the Surfpool RPC

## See Also

- Surfpool runbook and troubleshooting: `/Users/nitishmalluru/Developer/tx-cpi-invoker/anchor/SURFPOOL_DOCS.md`
- On-chain Stork architecture notes: `/Users/nitishmalluru/Developer/tx-cpi-invoker/anchor/programs/order_executor/ARCHITECTURE.md`
