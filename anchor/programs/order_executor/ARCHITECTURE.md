# Order Executor Architecture

## Mission

Execute a user-specified CPI (Cross-Program Invocation) when a trigger condition is met. Users define *what* to call and *when* to call it; keepers monitor triggers and invoke the program when conditions are satisfied.

## Order Lifecycle

```
init_user_counter ─► create_order ─► [Pending]
                                         │
                          ┌──────────────┼──────────────┐
                          ▼                              ▼
                  execute_order_*                   cancel_order
                          │                              │
                          ▼                              ▼
                     [Executed]                     [Canceled]
                          │                              │
                          └──────────────┬───────────────┘
                                         ▼
                                     close_order
                                   (reclaim rent)
```

## Function Map (High Level)

### User-facing instructions

- `init_user_counter`
  - **What it does**: creates one PDA per user to track `next_order_id` and `open_order_count`.
  - **Why needed**: gives deterministic order IDs and a stable seed source for order PDA derivation.

- `create_order`
  - **What it does**: stores trigger + CPI blueprint (`CpiAction`) into an Order PDA and escrows user SOL into a system-owned Vault PDA.
  - **Why needed**: separates "define plan now" from "execute later when trigger is true".

- `execute_order_if_ready`
  - **What it does**: executes orders with base triggers (`TimeAfter`, `PdaValueEquals`).
  - **Why needed**: permissionless keeper execution path without oracle account requirements.

- `execute_order_if_ready_stork`
  - **What it does**: executes orders with Stork oracle triggers (`PriceBelowStork`, `StorkOutcomeEquals`).
  - **Why needed**: explicit instruction contract for oracle-dependent execution.

- `cancel_order`
  - **What it does**: user cancels an unexecuted order and refunds escrow from Vault PDA back to user.
  - **Why needed**: user exit path if trigger is no longer desirable.

- `close_order`
  - **What it does**: closes a settled order account (`executed` or `canceled`), decrements open count, and returns rent.
  - **Why needed**: account lifecycle cleanup and rent recovery.

### Internal helpers

- `validate_order_ready`
  - **What it does**: blocks already-executed, canceled, or expired orders.
  - **Why needed**: prevents replay and invalid state transitions.

- `evaluate_trigger_base`
  - **What it does**: evaluates non-Stork triggers.
  - **Why needed**: keeps trigger logic isolated and explicit.

- `evaluate_trigger_stork`
  - **What it does**: evaluates Stork feed triggers with freshness checks.
  - **Why needed**: enforces oracle-specific validation and max-age safety.

- `execute_order_action`
  - **What it does**: validates dynamic CPI accounts, validates target program account, builds CPI instruction, and calls `invoke_signed`.
  - **Why needed**: this is the core secure CPI executor.

- `settle_execution`
  - **What it does**: pays keeper bounty from escrow and marks order as executed.
  - **Why needed**: economic incentive for permissionless execution.

- `is_whitelisted_program`
  - **What it does**: allows only System Program and SPL Token Program as CPI targets.
  - **Why needed**: strong default-deny boundary against arbitrary CPI.

## How create_order Works

1. User calls `create_order` with:
   - **Trigger**: the condition that must be true for execution (see Trigger Types below)
   - **CpiAction**: the CPI specification (target `program_id`, list of `CpiAccount` pubkeys with writability flags, and raw instruction `data`)
   - **input_amount**: SOL to escrow into the Vault PDA
   - **execution_bounty**: portion of escrow paid to the keeper on successful execution
   - **expires_slot**: optional slot-based expiration

2. The program validates:
   - The target `program_id` is whitelisted
   - At most 32 CPI accounts (to bound compute)
   - The `UserOrderCounter` exists and belongs to the caller
   - Expiration is in the future (if set)

3. Two PDAs are created:
   - `Order` PDA: `["order", user_pubkey, order_id_le_bytes]` (stores state/data)
   - `Vault` PDA: `["vault", user_pubkey, order_id_le_bytes]` (system-owned, 0 data, holds escrow SOL)
   
   SOL escrow is transferred from user to Vault PDA.

## How execute_order Works

Execution happens in four stages:

```
validate_order_ready ─► evaluate_trigger_* ─► execute_order_action ─► settle_execution
```

### 1. validate_order_ready

Checks that the order is not already executed/canceled and has not expired.

### 2. Trigger Evaluation

Two separate instruction entrypoints exist, each calling a dedicated evaluator:

- **`execute_order_if_ready`** calls `evaluate_trigger_base` for `TimeAfter` and `PdaValueEquals` triggers
- **`execute_order_if_ready_stork`** calls `evaluate_trigger_stork` for `PriceBelowStork` and `StorkOutcomeEquals` triggers

### 3. execute_order_action

This is the core CPI engine. It:

1. Re-validates the CPI target is whitelisted
2. Derives the Order PDA bump for signing
3. Derives the Vault PDA bump for signing
4. Validates each `remaining_account` against the stored `CpiAction`:
   - Pubkey must match
   - Writable accounts must actually be writable
5. Validates the target program `AccountInfo` (last remaining account) matches `action.program_id` and is executable
6. Builds the `Instruction` with correct `AccountMeta` entries (setting `is_signer: true` for Order/Vault PDAs when referenced)
7. Calls `invoke_signed` with Order + Vault seeds so runtime grants signer privilege to whichever PDA is required by the CPI

### 4. settle_execution

Transfers the execution bounty from the Vault PDA to the keeper and marks the order as executed.

## Why remaining_accounts

The CPI accounts are dynamic -- chosen by the user at `create_order` time. They cannot be part of a fixed Anchor `#[derive(Accounts)]` struct because the number and identity of accounts varies per order. Instead:

- The **Order PDA** stores the expected pubkeys and writability flags
- The **keeper** provides the actual `AccountInfo` objects at execution time via `remaining_accounts`
- The **program** validates each one matches the stored specification

### remaining_accounts Layout

```
[cpi_account_0, cpi_account_1, ..., cpi_account_n, target_program]
```

The target program's `AccountInfo` must be the last element. Solana's `invoke_signed` requires it in the account info slice to perform the CPI.

## Why Order + Vault PDAs Sign

`invoke_signed` uses both seeds:

- `["order", user, order_id, bump]`
- `["vault", user, order_id, bump]`

This lets the runtime treat either PDA as signer when referenced by the CPI. In practice:

- Lets the CPI target program verify the caller has authority
- Enables System Program transfers from the Vault PDA (data-less system account)
- Enables token-related authority checks where Order PDA or Vault PDA is expected signer

## Why is_signer is Set for PDAs

When building `AccountMeta`, `is_signer` is set to `true` for accounts whose pubkey matches the Order PDA or Vault PDA. While `invoke_signed` grants signer status at runtime, setting signer flags in metadata is still best practice.

## Why No Global Writable-Authority Gate

The program does not require every writable CPI account to be PDA-controlled. Instead it enforces:

- Exact pubkey matching against the stored `CpiAction`
- No writable escalation (expected read-only cannot become writable)
- Program whitelist restrictions

This is required to support valid CPIs where writable destination accounts are not PDA-controlled (for example SOL/token recipients). Authority-sensitive checks are still enforced by the target program during CPI (for example signer/owner checks in System Program and SPL Token Program).

## Why Program Whitelist

Only two programs are allowed as CPI targets:

1. **System Program** -- SOL transfers
2. **SPL Token Program** -- token transfers, approvals

This prevents arbitrary code execution. The whitelist can be expanded as the protocol matures, but starting restrictive is a security-first approach.

## Why Two Execute Instructions

Solana conventions favor fixed account contracts per instruction. Base triggers (`TimeAfter`, `PdaValueEquals`) need no external oracle accounts. Stork triggers need the Stork feed PDA (validated via `seeds::program`). Merging these into one instruction would require optional accounts and runtime branching, which:

- Makes the account contract ambiguous to tooling and clients
- Adds complexity to instruction decoding
- Goes against the Solana pattern of explicit, predictable account lists

Instead, the two instructions share the same flow via helper functions (`validate_order_ready`, `execute_order_action`, `settle_execution`), keeping duplication minimal.

## Trigger Types

| Trigger | Description | Instruction |
|---------|-------------|-------------|
| `TimeAfter { slot }` | Fires when `clock.slot >= slot` | `execute_order_if_ready` |
| `PdaValueEquals { account, expected_value }` | Fires when the first 8 bytes of the PDA equal `expected_value` (u64 LE) | `execute_order_if_ready` |
| `PriceBelowStork { feed_id, max_price_q, max_age_sec }` | Fires when the Stork oracle price is at or below `max_price_q` and the feed is fresh | `execute_order_if_ready_stork` |
| `StorkOutcomeEquals { feed_id, expected_outcome_q, max_age_sec }` | Fires when the Stork oracle value exactly equals `expected_outcome_q` and the feed is fresh | `execute_order_if_ready_stork` |

## Known Limitations

### Stale CPI Data

The CPI instruction `data` is stored at `create_order` time. If the target program expects dynamic parameters (e.g., a swap amount based on current price), the stored data may be stale by execution time. This design works well for:

- Simple SOL/token transfers with fixed amounts
- Any CPI where the instruction data is deterministic at order creation

It is **not suitable** for stateful DeFi interactions where parameters change between create and execute (e.g., limit orders on a DEX with slippage).

### Whitelist Scope

The current whitelist is intentionally narrow (System + SPL Token). Expanding to additional programs requires careful review of each program's security model and account expectations.

### Escrow Source Requirement

System transfers must source lamports from data-less system accounts. This architecture satisfies that by escrowing in the Vault PDA, not the Order account.

### ATA Creation Not Included Yet

Associated Token Account creation is intentionally not enabled in the current whitelist. If ATA support is needed, it should be added with explicit instruction-specific validation for payer/funding behavior and expected writable accounts.

### init_user_counter

The `UserOrderCounter` must be initialized via a separate `init_user_counter` instruction before the first `create_order`. This is a one-time operation per user wallet. Client SDKs should check for counter existence and initialize if needed.
