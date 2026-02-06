# Quickstart: Conditional CPI Executor (Local)

**Branch**: 001-conditional-cpi-executor
**Date**: 2026-02-04

This quickstart is for local development and validation of the conditional executor design.

## Prerequisites

- Node.js 20+
- Rust toolchain compatible with Anchor
- Solana CLI
- Anchor CLI

## Repo setup

- Install JS deps: `npm install`
- Build program + generate client types: `npm run setup`

## Build

- Build Anchor program: `npm run anchor-build`
- Build Next.js app: `npm run build`

## Local test loop (program)

- Run Anchor tests (local validator): `npm run anchor-test`

Test cases to add/ensure (must pass):

- Missing proof => execute fails, no side effects
- Wrong proof (wrong condition_id) => fails
- Wrong outcome => fails
- Stale proof (older than max age) => fails
- Replay (execute twice) => second fails
- Cancel then execute => fails
- Cancel then withdraw_and_close => succeeds and closes PDA
- Keeper fee above max => fails

## Keeper (worker) dev loop

The keeper is planned as a long-running process under `keeper/`.

Environment variables (proposed):
- `RPC_URL`
- `PROGRAM_ID`
- `STORK_API_URL`
- `STORK_SIGNER_PUBKEY`
- `POLL_INTERVAL_SECS` (default 30 near deadlines)
- `MAX_PROOF_AGE_SECS` (default 3600)

Core runtime responsibilities:
- Poll upstream sources
- Fetch proofs
- Build an atomic transaction: ed25519 verify instruction(s) + execute
- (Optional) use a nonce account when executing a delayed / pre-signed flow

## UI

- Start dev server: `npm run dev`
- UI reads Requirement accounts from chain and displays lifecycle state (active/executed/canceled).
