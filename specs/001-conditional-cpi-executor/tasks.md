---

description: "Tasks for Conditional CPI Executor (Anchor smart contract + tests)"
---

# Tasks: Conditional CPI Executor

**Feature**: `001-conditional-cpi-executor`
**Input**: Design documents in `specs/001-conditional-cpi-executor/` (plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md)

**Scope emphasis (per request)**:
- Phase 1 focuses on Anchor smart contract scaffolding + unit-test harness (MVP scope)
- Foundational tasks (T001+) focus on Anchor program setup + PDA/state definitions
- US1 (P1) breaks down contract implementation AND its unit tests as highest priority
- Explicit test tasks included for research/quickstart edge cases: missing proofs, wrong event IDs, stale/freshness window

## Constitution Gates *(planning → tasks)*

- Add unit/integration/security tests for on-chain invariants and error cases.
- Keep state model minimal (PDAs + lifecycle), and keep limits explicit.
- Treat keeper as untrusted: strict proof-to-requirement matching and replay protection.

## Checklist Format *(REQUIRED)*

Every task line MUST follow:

```text
EXAMPLE: - [ ] T### [P?] [US#?] Description with file path
```

Notes:
- `[P]` only when work is independent (different files, no blocking deps)
- `[US#]` only in user story phases (US1..US4)

---

## Phase 1: Setup — Smart Contract & Testing (MVP Scope)

**Goal**: Establish Anchor program scaffolding for the conditional executor + a test harness that can be iterated rapidly.

- [ ] T001 Create conditional executor module scaffold in anchor/programs/vault/src/conditional_executor/mod.rs
- [ ] T002 [P] Define constants and PDA seeds in anchor/programs/vault/src/conditional_executor/constants.rs
- [ ] T003 [P] Define core state types (Config, Requirement, ConditionRequirement, RequirementState) in anchor/programs/vault/src/conditional_executor/state.rs
- [ ] T004 [P] Define instruction argument types (CreateRequirementArgs, ExecuteArgs, OracleProof) in anchor/programs/vault/src/conditional_executor/types.rs
- [ ] T005 [P] Define executor error codes in anchor/programs/vault/src/conditional_executor/error.rs
- [ ] T006 Wire conditional executor module into the program in anchor/programs/vault/src/lib.rs
- [ ] T007 [P] Add sha256 helper for `accounts_hash` in anchor/programs/vault/src/conditional_executor/hash.rs
- [ ] T008 Add any required Rust deps (e.g. sha2) in anchor/programs/vault/Cargo.toml
- [ ] T009 [P] Add test utilities (discriminator helper + PDA helpers) in anchor/programs/vault/src/tests.rs

**Checkpoint**: `cargo test` (program unit tests) runs and can import the new module.

---

## Phase 2: Foundational — Blocking Prerequisites

**Goal**: Implement the shared validation + serialization building blocks that every user story depends on.

- [ ] T010 Implement Requirement PDA derivation helpers in anchor/programs/vault/src/conditional_executor/pda.rs
- [ ] T011 Implement bounded parsing/validation helpers (limits, duplicates) in anchor/programs/vault/src/conditional_executor/validate.rs
- [ ] T012 Implement proof message parsing interface (extract condition_id, outcome, timestamp) in anchor/programs/vault/src/conditional_executor/proof.rs
- [ ] T013 Implement trusted signer selection (hardcoded default + optional Config PDA) in anchor/programs/vault/src/conditional_executor/config.rs

**Checkpoint**: Core helpers compile and are callable from instruction handlers.

---

## Phase 3: User Story 1 — Create a Conditional Transaction (Priority: P1) 🎯 MVP

**Goal**: User creates a Requirement PDA that immutably stores: delegated CPI intent + condition set + freshness/fee bounds.

**Independent Test**: A unit test can create a requirement with 2 conditions and verify persisted fields match.

### Tests (write first)

- [ ] T014 [P] [US1] Add test: create_requirement creates PDA and persists intent/conditions in anchor/programs/vault/src/tests.rs
- [ ] T015 [P] [US1] Add test: create_requirement rejects > MAX_CONDITIONS in anchor/programs/vault/src/tests.rs
- [ ] T016 [P] [US1] Add test: create_requirement rejects duplicate condition_id in anchor/programs/vault/src/tests.rs
- [ ] T017 [P] [US1] Add test: create_requirement rejects oversized instruction_data in anchor/programs/vault/src/tests.rs

### Implementation

- [ ] T018 [US1] Implement CreateRequirement accounts + handler in anchor/programs/vault/src/conditional_executor/instructions/create_requirement.rs
- [ ] T019 [US1] Store Requirement state (immutable CPI intent + conditions + bounds) in anchor/programs/vault/src/conditional_executor/state.rs
- [ ] T020 [US1] Compute and persist `accounts_hash` from expected metas in anchor/programs/vault/src/conditional_executor/hash.rs
- [ ] T021 [US1] Expose `create_requirement` entrypoint in anchor/programs/vault/src/lib.rs

**Checkpoint**: US1 tests pass and can be demoed independently (create + read back state).

---

## Phase 4: User Story 2 — Trustless Atomic Execution by Keeper (Priority: P2)

**Goal**: Keeper submits a single atomic tx: ed25519 verify instruction(s) + `execute`; program verifies all conditions and transitions state.

**Independent Test**: Execute fails on missing/wrong/stale proofs; succeeds only with correct fresh proofs; replay fails.

### Tests (explicitly required edge cases)

- [ ] T022 [P] [US2] Add test: execute fails with missing proof (no side effects) in anchor/programs/vault/src/tests.rs
- [ ] T023 [P] [US2] Add test: execute fails with wrong condition_id (wrong event ID) in anchor/programs/vault/src/tests.rs
- [ ] T024 [P] [US2] Add test: execute fails with stale proof (freshness window violation) in anchor/programs/vault/src/tests.rs
- [ ] T025 [P] [US2] Add test: execute succeeds with fresh matching proofs and marks executed in anchor/programs/vault/src/tests.rs
- [ ] T026 [P] [US2] Add test: execute replay attempt fails on second call in anchor/programs/vault/src/tests.rs
- [ ] T027 [P] [US2] Add test: execute fails when keeper fee exceeds max cap in anchor/programs/vault/src/tests.rs

### Implementation

- [ ] T028 [US2] Implement ed25519 instruction inspection (Instructions Sysvar) in anchor/programs/vault/src/conditional_executor/ed25519.rs
- [ ] T029 [US2] Implement freshness checks (max age + future skew) in anchor/programs/vault/src/conditional_executor/proof.rs
- [ ] T030 [US2] Implement proof-to-requirement matching (condition_id + outcome) in anchor/programs/vault/src/conditional_executor/verify.rs
- [ ] T031 [US2] Implement keeper fee enforcement + transfer in anchor/programs/vault/src/conditional_executor/fees.rs
- [ ] T032 [US2] Implement Execute accounts + handler (verify all → mark executed) in anchor/programs/vault/src/conditional_executor/instructions/execute.rs
- [ ] T033 [US2] Expose `execute` entrypoint in anchor/programs/vault/src/lib.rs

**Checkpoint**: US2 tests pass and the on-chain state transitions to Executed exactly once.

---

## Phase 5: User Story 3 — Cancel & Withdraw (Priority: P3)

**Goal**: User can cancel an active requirement; canceled requirements cannot execute; user can withdraw/close to reclaim rent.

**Independent Test**: Cancel prevents execute; withdraw_and_close returns lamports and closes PDA.

### Tests

- [ ] T034 [P] [US3] Add test: cancel_requirement marks canceled and prevents execute in anchor/programs/vault/src/tests.rs
- [ ] T035 [P] [US3] Add test: withdraw_and_close closes requirement PDA and returns lamports in anchor/programs/vault/src/tests.rs

### Implementation

- [ ] T036 [US3] Implement CancelRequirement accounts + handler in anchor/programs/vault/src/conditional_executor/instructions/cancel_requirement.rs
- [ ] T037 [US3] Implement WithdrawAndClose accounts + handler in anchor/programs/vault/src/conditional_executor/instructions/withdraw_and_close.rs
- [ ] T038 [US3] Expose cancel/withdraw entrypoints in anchor/programs/vault/src/lib.rs

**Checkpoint**: US3 tests pass; canceled requirements cannot be executed.

---

## Phase 6: User Story 4 — PDA-Signed Delegation (Priority: P4)

**Goal**: Delegated CPI is authorized by the Requirement PDA (invoke_signed) and cannot be altered by the keeper (accounts_hash binding).

**Independent Test**: Execute performs a CPI where the PDA signature is required, and account substitution is rejected.

### Tests

- [ ] T039 [P] [US4] Add test: execute performs SystemProgram transfer signed by Requirement PDA in anchor/programs/vault/src/tests.rs
- [ ] T040 [P] [US4] Add test: execute fails when remaining accounts do not match stored accounts_hash in anchor/programs/vault/src/tests.rs

### Implementation

- [ ] T041 [US4] Add optional funding path for Requirement PDA (initial deposit or separate instruction) in anchor/programs/vault/src/conditional_executor/instructions/fund_requirement.rs
- [ ] T042 [US4] Implement CPI invocation via invoke_signed using stored intent in anchor/programs/vault/src/conditional_executor/cpi.rs
- [ ] T043 [US4] Enforce remaining-accounts hash binding during execute in anchor/programs/vault/src/conditional_executor/cpi.rs
- [ ] T044 [US4] Persist CPI intent (target_program + ix_data + accounts_hash) during create_requirement in anchor/programs/vault/src/conditional_executor/instructions/create_requirement.rs

**Checkpoint**: US4 tests pass; keeper cannot substitute accounts, and CPI requires PDA signing.

---

## Final Phase: Polish & Cross-Cutting

- [ ] T045 [P] Update quickstart test checklist to match implemented tests in specs/001-conditional-cpi-executor/quickstart.md
- [ ] T046 [P] Add/update error messages for debuggability in anchor/programs/vault/src/conditional_executor/error.rs
- [ ] T047 Run full on-chain unit test suite (`cargo test`) in anchor/programs/vault/Cargo.toml
- [ ] T048 Run local validator test loop (`npm run anchor-test`) via scripts in package.json (scripts section)

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 → US1 → (US2 and US3 can proceed after US1) → US4 → Polish
- US2 depends on US1 (Requirement state must exist)
- US3 depends on US1 (Requirement state must exist)
- US4 depends on US2 (execution path) and US1 (stored intent)

## Parallel Execution Examples (per story)

US1 (after Phase 2):
- [P] tests T014–T017 can be implemented in parallel (same file risk: if working in parallel, coordinate edits to anchor/programs/vault/src/tests.rs)
- [P] state/types/error files from Phase 1 can be prepared in parallel (T002–T005)

US2:
- [P] test cases T022–T027 can be implemented independently (coordinate edits to anchor/programs/vault/src/tests.rs)
- [P] helpers in anchor/programs/vault/src/conditional_executor/{ed25519.rs,proof.rs,verify.rs,fees.rs} can be split across contributors

US3:
- [P] cancel/withdraw tests can be parallelized with US2 tests once US1 is landed

## Implementation Strategy

- MVP: complete Phase 1 + Phase 2 + US1 only, then stop and validate.
- Then implement US2 edge-case tests + execute handler.
- Add US3 cancellation/close lifecycle.
- Finish with US4 CPI + accounts-hash binding.
