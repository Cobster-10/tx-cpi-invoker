# Data Model: Conditional CPI Executor

**Branch**: 001-conditional-cpi-executor
**Date**: 2026-02-04

## Entities

### 1) Config (PDA, optional)

**Purpose**: Holds global configuration for proof verification.

**Fields**
- `authority: Pubkey` — allowed to initialize/update config.
- `stork_signer_pubkey: Pubkey` — the trusted signer identity.
- `bump: u8`

**Validation rules**
- Only `authority` can update.
- If Config is not present, program uses a hardcoded default signer pubkey.

### 2) Requirement (PDA)

**Purpose**: Immutable user intent + condition gating + lifecycle state.

**Seeds** (proposed)
- `"requirement"`, user authority pubkey, user-chosen `nonce` (u64 or bytes)

**Fields**
- `authority: Pubkey`
- `state: RequirementState` — `Active | Canceled | Executed`
- `created_at_unix: i64`
- `executed_at_slot: Option<u64>`

**Delegated CPI intent (immutable once created)**
- `target_program: Pubkey`
- `instruction_data: Vec<u8>`
- `accounts_hash: [u8; 32]` — hash of the expected account metas (pubkey + is_writable + is_signer) used for CPI

**Conditions**
- `conditions: Vec<ConditionRequirement>`
  - bounded length (default max: 8)

**Fees / economics**
- `max_keeper_fee_lamports: u64`
- `keeper_fee_recipient: Option<Pubkey>` (if omitted, payer is keeper and fee is transferred to keeper)

**Freshness policy**
- `max_proof_age_secs: u32` (default 3600)
- `max_future_skew_secs: u32` (default 300)

**Validation rules**
- `conditions.len() <= MAX_CONDITIONS`
- `instruction_data.len() <= MAX_IX_DATA_LEN`
- `max_keeper_fee_lamports` must be explicitly set; payment must not exceed it.

### 3) ConditionRequirement (embedded)

**Fields**
- `condition_id: [u8; 32]` — recommended: sha256(external_id)
- `expected_outcome: Vec<u8>` — bounded size (domain-specific; e.g., 8–32 bytes)

**Validation rules**
- No duplicate `condition_id` within a single Requirement.

### 4) OracleProof (instruction argument)

**Purpose**: Provided at execution-time by keeper; verified in-transaction.

**Fields**
- `message: Vec<u8>`
- `signature: [u8; 64]`

**Parsed from message**
- `condition_id: [u8; 32]`
- `outcome: Vec<u8>`
- `timestamp_unix: i64`

## Relationships

- Config is global (one per program).
- Requirement is owned by a single authority.
- Requirement embeds multiple ConditionRequirements.

## State transitions

- `Active -> Canceled` via `cancel_requirement` (authority only)
- `Active -> Executed` via `execute` (keeper or anyone; must satisfy proofs)
- `Canceled -> (Closed)` via `withdraw_and_close` (authority only)
- `Executed` is terminal (no further execute; optional close policy can be decided later)

## Invariants

- CPI intent is immutable after creation.
- A Requirement can be executed at most once.
- Execution requires a cryptographic match to the trusted signer key.
- Execution is all-or-nothing (atomic): if any condition fails, no CPI side effects occur.
