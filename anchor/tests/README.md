# Anchor Tests (TypeScript)

This directory contains RPC-backed integration tests for the `order_executor` program.

## Files

- `basic_tests.ts`
  - basic order lifecycle tests (create, execute, cancel)
- `stork_tests.ts`
  - Surfpool-only Stork trigger tests using synthetic Stork feed accounts
- `helpers/surfpool.ts`
  - Surfpool cheatcode helpers (RPC method detection, setAccount wrapper, clock/time-travel compatibility)

## Requirements

- `anchor build` completed (IDL + `.so` present)
- RPC running on `127.0.0.1:8899` (Surfpool or validator)
- wallet available (`~/.config/solana/id.json`) or set `ANCHOR_WALLET`

## Commands

### Run all TS tests

```bash
cd ./anchor
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=$HOME/.config/solana/id.json npm run test
```

### Run Stork Surfpool tests only

```bash
cd ./anchor
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=$HOME/.config/solana/id.json npm run test:surfpool:stork
```

### Run Surfpool preflight (recommended before Stork suite)

```bash
cd ./anchor
npm run surfpool:preflight
```

### One command: preflight + Stork suite

```bash
cd ./anchor
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=$HOME/.config/solana/id.json npm run test:surfpool:stork:preflight
```

## What `basic_tests.ts` verifies

- user counter initialization
- order creation stores expected fields and funds vault
- keeper execution path (`execute_order_if_ready`) succeeds
- cancel path refunds and marks order canceled

## What `stork_tests.ts` verifies

- `PriceBelowStork` success/failure
- `PriceAboveStork` success/failure
- `StorkOutcomeEquals` success/failure
- stale Stork feed rejection (`StaleOraclePrice`)
- wrong Stork feed account rejection (`InvalidOracleAccount`)

## Notes

- Tests resolve the program ID from `Anchor.toml` based on the RPC endpoint (localhost => `[programs.localnet]`).
- `stork_tests.ts` uses Surfpool cheatcodes for synthetic Stork feed seeding (`surfnet_setAccount`).
- `helpers/surfpool.ts` includes compatibility fallbacks for Surfpool version differences (`Info` vs `Infos`, clock/time-travel variations).

## Related Docs

- `anchor/SURFPOOL_DOCS.md`
- `anchor/programs/order_executor/ARCHITECTURE.md`
