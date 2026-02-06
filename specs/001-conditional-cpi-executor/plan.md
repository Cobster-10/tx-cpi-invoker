# Implementation Plan: Solana Conditional CPI Executor (Trustless Keeper)

**Branch**: `001-conditional-cpi-executor` | **Date**: 2026-02-04 | **Spec**: ./spec.md
**Input**: Feature specification from `specs/001-conditional-cpi-executor/spec.md` plus user planning input (tech stack, constraints, and architectural choices).

## Summary

Deliver a Solana (Anchor) conditional execution primitive:

- Users create a Requirement PDA that immutably stores a delegated CPI intent (target program + instruction data + any required accounts policy) and a list of condition IDs + expected outcomes.
- An untrusted keeper later submits a single atomic transaction containing Stork oracle signature verification and an `execute` instruction.
- The program verifies proofs strictly match the stored requirements (ID + outcome + freshness), enforces replay protection and cancellation, and only then performs the CPI using the Requirement PDA as signer.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: Rust (Anchor `0.32.1` / Solana SDK `2.3`) + TypeScript (Node `20.x`, TypeScript `5.x`, Next.js `16.0.10`)
**Primary Dependencies**: `anchor-lang 0.32.1`, Solana ed25519 precompile verification (via `Ed25519Program` + Instructions Sysvar), Next.js, `@solana/kit`, `ws`.
**Storage**: On-chain PDAs (Requirement + optional Config) as system-of-record; off-chain in-memory cache for keeper scheduling only.
**Testing**: `anchor test` / `cargo test` for program; `npm run lint` / `npm run build` for TS.
**Target Platform**: Solana Devnet/Mainnet; keeper on Linux; UI on Next.js Node runtime.
**Project Type**: Web + on-chain program + long-running keeper worker.
**Performance Goals**: Keeper polls every ~30s near deadlines; `execute` remains within compute for a bounded number of conditions.
**Constraints**: Single atomic tx (verification + CPI); trusted Stork signer pubkey hardcoded or configurable; proof freshness window default 60 minutes; rent-minimal PDAs with close/reclaim.
**Scale/Scope**: MVP supports ~1,000 active requirements; default max 8 conditions per requirement (explicit error if exceeded).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- Code Quality: Minimal PDAs, explicit lifecycle state transitions, and clear invariants.
- Testing Standards: Tests cover missing/wrong/stale proofs, replay, cancel/withdraw/close, and fee bounds.
- User Experience Consistency: Same lifecycle statuses surfaced in UI, keeper, and on-chain state.
- Performance & Scalability: Explicit upper bounds for conditions/proofs and predictable linear verification.
- Security: Trusted signer key enforcement, strict proof matching, replay protection, and input validation.
- Cross-Component Harmony: Keeper is untrusted/optional; UI can read chain state; off-chain failures never risk funds.

Gate result: PASS.

## Project Structure

### Documentation (this feature)

```text
specs/001-conditional-cpi-executor/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── keeper.openapi.yaml
│   └── stork-proof.schema.json
└── tasks.md             # created later by /speckit.tasks
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
anchor/
├── Anchor.toml
└── programs/
  └── vault/
    └── src/
      ├── lib.rs
      └── tests.rs

app/                     # Next.js UI

keeper/                  # long-running Node worker (added in implementation)

target/                  # build artifacts
```

**Structure Decision**: Monorepo. Keep the on-chain program in `anchor/`, UI in `app/`, and implement the polling/execution service as a separate long-running worker in `keeper/` (not a serverless route) to support high-frequency polling and durable nonce flows.

## Phase 0 — Research

Output: research.md (decisions + rationale + alternatives).

## Phase 1 — Design & Contracts

Outputs: data-model.md, contracts/, quickstart.md.

## Post-Design Constitution Check

PASS.

## Complexity Tracking

No justified violations.
