# Order Executor Program

An on-chain Solana program that executes user-specified CPIs when trigger conditions are met, built with [Anchor](https://www.anchor-lang.com/).

## Program IDs (Configured)

Program IDs in this repo are configured in:

- `/Users/nitishmalluru/Developer/tx-cpi-invoker/anchor/Anchor.toml`
- `/Users/nitishmalluru/Developer/tx-cpi-invoker/anchor/programs/order_executor/src/lib.rs` (`declare_id!`)

Check current configured IDs:

```bash
cd /Users/nitishmalluru/Developer/tx-cpi-invoker/anchor
rg -n 'order_executor = \"|declare_id!' Anchor.toml programs/order_executor/src/lib.rs
```

Important:
- The local program ID can change if you run `anchor keys sync`.
- Keep `Anchor.toml`, `declare_id!`, and the built IDL in sync before deploying/testing.

## Deploying Your Own Program

### 1. Generate a new program keypair

```bash
cd anchor
solana-keygen new -o target/deploy/order_executor-keypair.json
```

### 2. Get the new program ID

```bash
solana address -k target/deploy/order_executor-keypair.json
```

### 3. Update the program ID (or sync from keypair)

Update the program ID in these files:

- `anchor/Anchor.toml` - Update `order_executor = "..."` under `[programs.devnet]`
- `anchor/programs/order_executor/src/lib.rs` - Update `declare_id!("...")`

Recommended for local development:

```bash
cd /Users/nitishmalluru/Developer/tx-cpi-invoker/anchor
anchor keys sync
anchor build
```

This syncs the configured program IDs with `target/deploy/order_executor-keypair.json` and regenerates the IDL.

### 4. Build and deploy

```bash
anchor build
solana airdrop 2 --url devnet
anchor deploy --provider.cluster devnet
```

### 5. Regenerate the TypeScript client

```bash
cd ..
npm run codama:js
```

This updates the generated client code in `apps/web/src/lib/generated/order_executor/`.

## Program Overview

The order executor program allows users to:

- **Create Orders**: Define a CPI action and a trigger condition, escrowing SOL into an Order PDA
- **Execute Orders**: Keepers execute orders when trigger conditions are met, invoking the stored CPI
- **Cancel Orders**: Users can cancel pending orders and reclaim escrowed SOL
- **Close Orders**: Users can close settled orders to reclaim rent

## Testing

```bash
anchor test --skip-deploy
```

For Surfpool-based integration testing (recommended for this repo), see:

- `/Users/nitishmalluru/Developer/tx-cpi-invoker/anchor/SURFPOOL_DOCS.md`
- `/Users/nitishmalluru/Developer/tx-cpi-invoker/anchor/tests/README.md`
