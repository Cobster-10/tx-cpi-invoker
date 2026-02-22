# Anchor Program (order_executor)

This directory contains the Anchor program, tests, and Surfpool local test workflow.

## Requirements

- Solana CLI
- Anchor CLI
- Node/npm
- Rust toolchain
- Wallet at `~/.config/solana/id.json` (or set `ANCHOR_WALLET`)

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

Requires a validator/Surfpool running on `127.0.0.1:8899`.

```bash
cd ./anchor
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=$HOME/.config/solana/id.json npm run test
```

## Surfpool Workflow (recommended)

Use the repo-specific runbooks:
- `anchor/SURFPOOL_DOCS.md`
- `anchor/tests/README.md`
