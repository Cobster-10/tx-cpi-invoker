# Order Executor TypeScript Tests

## Prerequisites

1. **Build the program** (generates IDL):
   ```bash
   npm run anchor-build
   ```

2. **Install test dependencies** (from project root or `anchor/`):
   ```bash
   cd anchor && npm install
   ```

## Running Tests

### Option A: Standard Anchor Test (solana-test-validator)

```bash
anchor test --skip-local-validator
```

Requires `solana-test-validator` running on `http://127.0.0.1:8899`, or use the default `anchor test` which starts it automatically.

### Option B: Surfpool (recommended for mainnet-fork testing)

[Surfpool](https://docs.surfpool.run/) is a drop-in replacement for `solana-test-validator` with mainnet forking and cheatcodes.

1. **Install Surfpool** (if not installed):
   ```bash
   curl -sL https://run.surfpool.run/ | bash
   ```

2. **Terminal 1** – start Surfpool from the `anchor/` directory:
   ```bash
   cd anchor
   surfpool start --legacy-anchor-compatibility
   ```
   Surfpool auto-deploys your program when run in an Anchor project. Use `--no-tui` for CI or `--ci` for headless mode.

3. **Terminal 2** – run TypeScript tests:
   ```bash
   cd anchor
   ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 npm run test
   ```

   Or from project root:
   ```bash
   ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 npm run anchor-test-ts
   ```

### Environment Variables

- `ANCHOR_PROVIDER_URL` – RPC URL (default: from `Anchor.toml` provider cluster)
- `ANCHOR_WALLET` – Path to wallet keypair for fee payer (default: `~/.config/solana/id.json`)

   If `ANCHOR_WALLET` is not set, use:
   ```bash
   ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=~/.config/solana/id.json npm run test
   ```
