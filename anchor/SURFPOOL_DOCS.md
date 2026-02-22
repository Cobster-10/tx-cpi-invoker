# Surfpool Runbook (Repo-Specific)

This document explains how to run and verify Surfpool-based tests for this repo, what failed during setup, and the exact fixes that made the Stork Surfpool suite pass.

## What Surfpool Is (and What It Is Not)

- Surfpool runs a **local** Solana-compatible validator/RPC.
- It can optionally **fork mainnet/devnet state**.
- Transactions still execute **locally**.
- You do **not** deploy to real mainnet to validate this system.
- You **do** deploy your program to the local Surfpool instance.

This is the right setup for validating the on-chain Stork trigger path safely.

## What We Validated Successfully

Using `anchor/tests/stork_tests.ts` on Surfpool, we validated:

- Stork `feed_id` is committed in the order trigger at `create_order`.
- `execute_order_if_ready_stork` derives `feed_id` from stored order state (not tx args).
- Wrong Stork feed PDA is rejected.
- Stale Stork data is rejected.
- `PriceBelowStork` trigger logic works.
- `PriceAboveStork` trigger logic works.
- `StorkOutcomeEquals` numeric equality logic works.

## Lessons Learned (Important)

### 1) Surfpool method name differs by version
Some versions expose:
- `surfnet_getSurfnetInfos` (plural)

Others expose:
- `surfnet_getSurfnetInfo` (singular)

If one returns `Method not found`, try the other before assuming Surfpool is not running.

### 2) `This program may not be used for executing instructions` was not a Stork bug
That error meant the target program account on the RPC was missing or not executable.

In our case, the real issue was a **program ID mismatch**:
- `declare_id!` in the program was `2f2ph1...`
- `Anchor.toml` localnet was still `3p8Q...`
- Surfpool deployed `2f2ph1...`
- tests/checks were looking for `3p8Q...`

Fix: align `anchor/Anchor.toml` localnet `order_executor` with the program's declared ID.

### 3) Surfpool running is not enough; program deployment must be verified
Even if `surfnet_getSurfnetInfo` returns success, always verify the program exists and is executable:

```bash
solana program show 2f2ph1Sgi14dAfKwYXNb5XPuAhuokWCW5WNLyfiQXKc2 --url http://127.0.0.1:8899
```

### 4) Synthetic Stork feed seeding is the right first integration test
The Surfpool Stork suite seeds synthetic Stork feed accounts via cheatcodes (`surfnet_setAccount`).
This avoids dependency on live Kalshi feed IDs and isolates on-chain correctness.

### 5) Mainnet-fork validation is useful, but local deterministic tests should pass first
Use local Surfpool + synthetic feeds to validate logic deterministically. Then optionally repeat on a mainnet-fork Surfpool for higher realism.

## Prerequisites

- Solana CLI installed
- Anchor CLI installed
- Surfpool installed
- Node/npm installed
- Wallet file (default expected): `~/.config/solana/id.json`

Install Surfpool if needed:

```bash
curl -sL https://run.surfpool.run/ | bash
```

## Commands: Local Surfpool Validation (Recommended First)

### 1) Build program and refresh IDL

```bash
cd /Users/nitishmalluru/Developer/tx-cpi-invoker/anchor
anchor build
```

### 2) Run Rust unit tests (on-chain program logic)

```bash
cd /Users/nitishmalluru/Developer/tx-cpi-invoker/anchor
cargo test -p order_executor -- --nocapture
```

### 3) Start Surfpool (Terminal 1)

```bash
cd /Users/nitishmalluru/Developer/tx-cpi-invoker/anchor
surfpool start -m ./Surfpool.toml --no-tui --debug
```

If your installed Surfpool build still needs it for Anchor auto-deploy, add:

```bash
surfpool start -m ./Surfpool.toml --legacy-anchor-compatibility --no-tui --debug
```

### 4) Verify Surfpool RPC (Terminal 2)
Try singular first (works in this repo's current Surfpool version):

```bash
curl -s http://127.0.0.1:8899 -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"surfnet_getSurfnetInfo","params":[]}'
```

Fallback (other Surfpool versions):

```bash
curl -s http://127.0.0.1:8899 -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"surfnet_getSurfnetInfos","params":[]}'
```

### 5) Verify the program is deployed/executable on Surfpool

```bash
solana program show 2f2ph1Sgi14dAfKwYXNb5XPuAhuokWCW5WNLyfiQXKc2 --url http://127.0.0.1:8899
```

Expected signal:
- `Owner: BPFLoaderUpgradeab1e11111111111111111111111`
- `ProgramData Address: ...`
- `Last Deployed In Slot: ...`

### 6) Run the preflight check (Terminal 2)

```bash
cd /Users/nitishmalluru/Developer/tx-cpi-invoker/anchor
npm run surfpool:preflight
```

### 7) Run the Stork Surfpool suite (Terminal 2)

```bash
cd /Users/nitishmalluru/Developer/tx-cpi-invoker/anchor
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 \
ANCHOR_WALLET=$HOME/.config/solana/id.json \
npm run test:surfpool:stork
```

Expected result:
- `7 passing`

## Commands: Mainnet-Fork Surfpool Validation (Optional)

This gives a more production-like environment while still executing locally.

### 1) Start Surfpool in mainnet-fork mode (Terminal 1)

```bash
cd /Users/nitishmalluru/Developer/tx-cpi-invoker/anchor
surfpool start -m ./Surfpool.toml -u https://api.mainnet-beta.solana.com --no-tui --debug
```

Add `--legacy-anchor-compatibility` if your local Surfpool version needs it.

### 2) Repeat verification and test commands
Use the same commands as local mode:
- verify `surfnet_getSurfnetInfo`
- verify `solana program show 2f2...`
- run `npm run test:surfpool:stork`

The program still runs locally. Surfpool may fetch remote state as needed.

## Verification Checklist (Use This Every Time)

1. Surfpool RPC responds to `surfnet_getSurfnetInfo` or `surfnet_getSurfnetInfos`.
2. Program account exists on `127.0.0.1:8899` at `2f2ph1...`.
3. Program account is executable (`solana program show` succeeds).
4. `anchor build` completed recently (IDL and `.so` are current).
5. Stork Surfpool suite returns `7 passing`.

## Troubleshooting

### Error: `This program may not be used for executing instructions`
This usually means one of:
- wrong program ID in tests/config
- program not deployed to Surfpool
- program account on RPC is not executable

Check:

```bash
solana program show 2f2ph1Sgi14dAfKwYXNb5XPuAhuokWCW5WNLyfiQXKc2 --url http://127.0.0.1:8899
```

If missing, restart Surfpool from `anchor/` and verify auto-deploy logs.

### `Method not found` for `surfnet_getSurfnetInfos`
Try `surfnet_getSurfnetInfo` (singular).

### Tests show all pending
The suite skips when Surfpool cheatcode methods are not detected at `ANCHOR_PROVIDER_URL`.
This often means:
- wrong RPC endpoint
- Surfpool not running
- non-Surfpool validator on port `8899`

### Warning: `MODULE_TYPELESS_PACKAGE_JSON`
Harmless Node warning during mocha+ts-node test runs. It does not affect correctness.

## Reproducibility: Fixes We Had To Make in This Repo

These are the key changes that made the Stork Surfpool tests reliable:

### Program / On-Chain
- Added `PriceAboveStork` trigger support.
- Removed tx-supplied Stork `feed_id` from execute instruction.
- Derive Stork `feed_id` from stored order trigger at execution.
- Runtime-validate `stork_feed` PDA against committed `feed_id`.
- Added create-time trigger validation (`validate_trigger_on_create`).

See:
- `/Users/nitishmalluru/Developer/tx-cpi-invoker/anchor/programs/order_executor/src/lib.rs`
- `/Users/nitishmalluru/Developer/tx-cpi-invoker/anchor/programs/order_executor/ARCHITECTURE.md`

### Keeper / Client Compatibility
- Added `price_above_stork` trigger kind.
- Updated Stork execute instruction encoding to send only discriminator (no appended `feedId`).
- Updated trigger decoding for new Stork variant.

See:
- `/Users/nitishmalluru/Developer/tx-cpi-invoker/services/keeper/src/orders/types.ts`
- `/Users/nitishmalluru/Developer/tx-cpi-invoker/services/keeper/src/solana/orderExecutorClient.ts`

### Surfpool Test Harness
- Added `tests/stork_tests.ts` synthetic Stork feed tests.
- Added shared cheatcode helper module `tests/helpers/surfpool.ts` (method probing, clock control, `surfnet_setAccount` fallback).
- Added Surfpool cheatcode detection for both `surfnet_getSurfnetInfo` and `surfnet_getSurfnetInfos`.
- Added explicit skip warning text when Surfpool cheatcodes are unavailable.
- Updated synthetic Stork feed seeding to use documented `surfnet_setAccount` payload shape first, with fallback to legacy positional payload.
- Converted Stork test timestamps/staleness checks to Surfpool clock control (`surfnet_getClock` / `surfnet_advanceClock` fallback).
- Resolved program ID from `Anchor.toml` based on RPC endpoint in tests.

See:
- `/Users/nitishmalluru/Developer/tx-cpi-invoker/anchor/tests/stork_tests.ts`
- `/Users/nitishmalluru/Developer/tx-cpi-invoker/anchor/tests/helpers/surfpool.ts`
- `/Users/nitishmalluru/Developer/tx-cpi-invoker/anchor/tests/basic_tests.ts`

### Config / Scripts
- Aligned `anchor/Anchor.toml` localnet `order_executor` to the declared program ID (`2f2ph1...`).
- Added `anchor/Surfpool.toml` manifest for reproducible Surfpool startup.
- Added `anchor/scripts/surfpool-preflight.sh` to verify Surfpool RPC + deployed program before running tests.
- Changed Anchor TS test scripts to use `ts-node/register/transpile-only`.

See:
- `/Users/nitishmalluru/Developer/tx-cpi-invoker/anchor/Anchor.toml`
- `/Users/nitishmalluru/Developer/tx-cpi-invoker/anchor/Surfpool.toml`
- `/Users/nitishmalluru/Developer/tx-cpi-invoker/anchor/scripts/surfpool-preflight.sh`
- `/Users/nitishmalluru/Developer/tx-cpi-invoker/anchor/package.json`

## Cross-References

- Test directory guide: `/Users/nitishmalluru/Developer/tx-cpi-invoker/anchor/tests/README.md`
- On-chain Stork architecture details: `/Users/nitishmalluru/Developer/tx-cpi-invoker/anchor/programs/order_executor/ARCHITECTURE.md`
