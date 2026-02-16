# tx-cpi-invoker

Solana automation stack for trigger-based CPI execution:

- On-chain program: `order_executor` (Anchor)
- Off-chain executor: `keeper` service
- Frontend app: Next.js UI (`apps/web`)

## Top-Level Structure

```text
.
├── anchor/                   # Anchor workspace (on-chain program + tests)
│   └── programs/order_executor/
├── apps/
│   └── web/                  # Frontend (Next.js)
├── services/
│   └── keeper/               # Off-chain keeper runtime
├── codama.json               # IDL -> client generation config
└── package.json              # Workspace root scripts/tools
```

## Naming Decisions

- `order_executor` (underscore) for the Anchor program is correct and conventional for Rust/Anchor.

- `keeper` keeps the intent clear without repeating `order` everywhere.

- Keep `anchor/` as-is.
  - Anchor tooling expects this workflow naturally.

## Why This Structure Is Optimal

- Frontend, on-chain program, and keeper are separated physically and logically.
- Each runtime (`apps/web`, `services/keeper`) has its own `package.json`.
- Root `package.json` remains as workspace orchestrator (shared scripts, codegen, formatting).
- This layout scales cleanly when you add:
  - order creation UI
  - open queue/order list UI
  - optional API/indexer services later

## Root Scripts

- `npm run anchor-build`
- `npm run anchor-test`
- `npm run web:dev`
- `npm run web:build`
- `npm run keeper:dev`
- `npm run keeper:build`

## Current Status

- `order_executor` tests cover create/execute/cancel/close lifecycle.
- `keeper` has:
  - open-order scan + decode
  - queue loop
  - trigger checks
  - vault-aware execute/cancel/close instruction builders

See:

- `anchor/programs/order_executor/ARCHITECTURE.md`
- `services/keeper/ARCHITECTURE.md`
