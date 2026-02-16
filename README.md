# tx-cpi-invoker

Solana automation stack for trigger-based CPI execution:

- On-chain program: `order_executor` (Anchor)
- Off-chain executor: `keeper` service
- Frontend app: static SvelteKit UI (`apps/web`)

## Top-Level Structure

```text
.
├── anchor/                   # Anchor workspace (on-chain program + tests)
│   └── programs/order_executor/
├── apps/
│   └── web/                  # Frontend (SvelteKit static app)
├── services/
│   └── keeper/               # Off-chain keeper runtime
├── codama.json               # IDL -> client generation config
└── package.json              # Workspace root scripts/tools
```

## Root Scripts

- `npm run anchor-build`
- `npm run anchor-test`
- `npm run web:dev`
- `npm run web:build`
- `npm run web:preview`
- `npm run web:check`
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
