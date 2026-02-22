# Surfpool Runbook

Use this for local Surfpool testing of the Anchor program and Stork trigger suite.

## Scope

- Local Surfpool RPC (`127.0.0.1:8899`)
- Program deployed to the local Surfpool instance
- Optional mainnet-fork source RPC

## Requirements

- `surfpool` installed
- `solana` CLI installed
- `anchor` CLI installed
- built program (`anchor build`)
- wallet available at `~/.config/solana/id.json` (or set `ANCHOR_WALLET`)

Install Surfpool (if needed):

```bash
curl -sL https://run.surfpool.run/ | bash
```

## Files Used

- `anchor/Surfpool.toml` (Surfpool manifest)
- `anchor/txtx.yml` + `anchor/runbooks/` (txtx workspace/runbooks; generated/used by Surfpool deployment)
- `anchor/scripts/surfpool-preflight.sh` (RPC + program deployment check)

## One-Time Setup (or after program key changes)

```bash
cd ./anchor
anchor keys sync
anchor build
```

If `surfpool run deployment ...` fails with a program keypair/IDL mismatch, run the same two commands again.

## Standard Local Flow

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

Notes:
- First run may prompt for a txtx workspace name and generate `txtx.yml` + `runbooks/`.
- Run Surfpool from `anchor/` (not repo root) to avoid duplicate local workspaces.

### 2) Preflight check (Terminal 2)

```bash
cd ./anchor
npm run surfpool:preflight
```

This verifies:
- Surfpool RPC is reachable
- Surfpool cheatcode info method exists (`Info` or `Infos`)
- local program is deployed/executable on `127.0.0.1:8899`

### 3) Run the Stork Surfpool tests (Terminal 2)

```bash
cd ./anchor
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=$HOME/.config/solana/id.json npm run test:surfpool:stork
```

Expected:
- `7 passing`

### 4) Optional: one command (preflight + Stork tests)

```bash
cd ./anchor
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=$HOME/.config/solana/id.json npm run test:surfpool:stork:preflight
```

## Mainnet-Fork Variant (optional)

Start Surfpool with mainnet as source RPC (execution is still local):

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

## Troubleshooting (short)

### `This program may not be used for executing instructions`
The program is missing/not executable on the Surfpool RPC.

Do:
1. `cd ./anchor && anchor build`
2. restart Surfpool from `./anchor`
3. run `npm run surfpool:preflight`

### `surfpool run deployment` keypair/IDL mismatch
Your `target/deploy/order_executor-keypair.json` pubkey does not match `declare_id!` / IDL.

Do:
```bash
cd ./anchor
anchor keys sync
anchor build
```

### Stork tests fail on clock cheatcodes (`getClock`, `advanceClock`)
Your Surfpool build may not support all clock cheatcodes or may use different `timeTravel` params/units.
The helper in `anchor/tests/helpers/surfpool.ts` already includes compatibility fallbacks.

### `MODULE_TYPELESS_PACKAGE_JSON` warning
Harmless Node warning from mocha/ts-node test execution.
