# Order Executor Program

An on-chain Solana program that executes user-specified CPIs when trigger conditions are met, built with [Anchor](https://www.anchor-lang.com/).

## Pre-deployed Program

The program is deployed on **devnet** at:

```
3p8QPys3SHaEyf4szGgcoF4x2FbGaT3uTgZibLity5hi
```

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

### 3. Update the program ID

Update the program ID in these files:

- `anchor/Anchor.toml` - Update `order_executor = "..."` under `[programs.devnet]`
- `anchor/programs/order_executor/src/lib.rs` - Update `declare_id!("...")`

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
