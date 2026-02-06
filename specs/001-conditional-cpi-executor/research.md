# Research: Conditional CPI Executor (Stork Proof-Gated)

**Branch**: 001-conditional-cpi-executor
**Date**: 2026-02-04

This document resolves planning unknowns and records decisions with rationale and alternatives.

## Decision 1: On-chain signature verification approach

**Decision**: Verify Stork signatures using Solana’s ed25519 precompile (`Ed25519Program`) and validate inside the program by inspecting the Instructions Sysvar to confirm the expected ed25519 verification instruction(s) were executed in the same transaction.

**Rationale**:
- Programs cannot natively verify ed25519 signatures cheaply; the canonical pattern is to include an ed25519 verify instruction in the same transaction and then have the program assert it exists and matches the expected public key + message.
- Keeps execution atomic: if verification fails, the transaction fails and the CPI never executes.

**Alternatives considered**:
- In-program ed25519 verification (too expensive / not supported as a standard pattern).
- Off-chain verification only (breaks trustlessness; keeper could lie).

## Decision 2: Trusted signer key handling

**Decision**: Support both (a) a hardcoded default Stork signer public key and (b) an optional `Config` PDA that can be initialized (and optionally rotated) by a privileged authority.

**Rationale**:
- Meets the constraint “no execution without cryptographic match” while allowing a safe migration path if Stork rotates keys.
- `Config` PDA keeps the key explicit and auditable on-chain.

**Alternatives considered**:
- Hardcode only (simpler but brittle to key rotation).
- Fully user-configurable signer per Requirement (increases attack surface; complicates trust model).

## Decision 3: Proof payload normalization

**Decision**: Treat each proof as a pair of byte blobs:
- `message` (bytes) — canonical serialized payload
- `signature` (bytes) — ed25519 signature over `message`

The on-chain program parses `message` to extract:
- `condition_id`
- `outcome`
- `timestamp_unix`

**Rationale**:
- Keeps the program interface stable even if upstream APIs change; only the off-chain keeper adapter needs updating.
- Parsing a minimal canonical schema is easier to bound and test.

**Alternatives considered**:
- Pass JSON strings (larger, slower, more fragile).
- Store entire upstream response (unbounded and version-dependent).

## Decision 4: Condition ID encoding and storage

**Decision**: Store condition identifiers in the Requirement PDA as fixed-size bytes (recommended: 32-byte hash of the external condition ID string), while still accepting external IDs off-chain.

**Rationale**:
- PDAs are rent-sensitive; fixed-size IDs reduce variability and cost.
- Hashing avoids storing long strings on-chain.

**Alternatives considered**:
- Store variable-length strings (higher rent, more edge cases).

## Decision 5: Freshness / staleness enforcement

**Decision**: Enforce a freshness window using `Clock` sysvar unix timestamp.
- Default `max_proof_age_secs = 3600` (60 minutes)
- Reject proofs where `now - proof_timestamp_unix > max_proof_age_secs`
- Reject proofs with timestamps too far in the future (default tolerance: 300 seconds)

**Rationale**:
- Prevents stale proofs from triggering executions long after conditions changed.
- Keeps the rule simple and testable.

**Alternatives considered**:
- Slot-based freshness only (harder to align with off-chain timestamps).
- No freshness enforcement (unsafe).

## Decision 6: Durable Nonce usage

**Decision**: Durable Nonce is used only for delayed / pre-signed transactions.
- Normal keeper execution uses a fresh recent blockhash.
- If users pre-sign, the keeper executes using a nonce account and includes `AdvanceNonceAccount` in the same atomic transaction.

**Rationale**:
- Durable nonce adds complexity and accounts; use only when necessary.

**Alternatives considered**:
- Always use durable nonce (unnecessary overhead).

## Decision 7: Keeper architecture

**Decision**: Implement the keeper as a long-running Node worker (separate from Next.js API routes).

**Rationale**:
- High-frequency polling and websocket/RPC subscriptions fit a worker model better than serverless.
- Avoids deployment constraints of serverless runtimes.

**Alternatives considered**:
- Next.js API routes (deployment-dependent; not ideal for long-lived loops).

## Decision 8: Binding CPI intent immutability

**Decision**: Store immutable CPI intent in the Requirement PDA:
- `target_program`
- `instruction_data`
- a hash of expected remaining accounts (pubkey + writable/signable flags) to prevent keeper account substitution

**Rationale**:
- Prevents a keeper from swapping in different accounts to change the effect of a CPI.

**Alternatives considered**:
- Store only instruction bytes (insufficient; accounts can be swapped).
- Store full account metas list on-chain (more rent; viable later if needed).
