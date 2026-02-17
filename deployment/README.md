# Order Executor Deployment Runbook

This runbook deploys the `order_executor` Anchor program to a Surfnet or Solana cluster.

## Prerequisites

1. **Build the program** (from project root):
   ```bash
   npm run anchor-build
   # or: cd anchor && anchor build
   ```
   This produces:
   - `anchor/target/deploy/order_executor.so`
   - `anchor/target/deploy/order_executor-keypair.json`
   - `anchor/target/idl/order_executor.json`

2. **Surfnet running** (for localnet deployment):
   ```bash
   surfpool start --legacy-anchor-compatibility
   ```

## Usage

### Deploy to local Surfnet

1. Start Surfpool (in one terminal):
   ```bash
   surfpool start --legacy-anchor-compatibility
   ```

2. Run the deployment runbook (in another terminal):
   ```bash
   surfpool run deployment -u --env localnet
   ```
   Use `-u` for unsupervised (no browser prompt). Omit `-u` for supervised mode with browser UI.

### Deploy to devnet

```bash
surfpool run deployment -u --env devnet
```

## Environment variables

The `txtx.yml` manifest defines environments. Select with `--env <name>`:

- **localnet** – Connects to `http://127.0.0.1:8899` (Surfpool)
- **devnet** – Connects to `https://api.devnet.solana.com`

The `payer` keypair (`~/.config/solana/id.json` by default) pays for deployment and must have SOL.
