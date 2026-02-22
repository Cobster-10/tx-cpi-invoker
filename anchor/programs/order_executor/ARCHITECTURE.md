# Order Executor Program Architecture

## 1) What this program is

A Solana program that lets a user:

1. Define a future CPI action now (`create_order`)
2. Lock SOL escrow in a vault PDA
3. Allow anyone (keeper) to execute that action later when a trigger is true

If you only remember 3 things:

- **Order PDA = plan** (trigger + CPI blueprint)
- **Vault PDA = money** (escrowed SOL)
- **Keeper = caller** (permissionless executor)

---

## 2) Core Accounts and Why They Exist

| Account | Seed | Purpose |
|---|---|---|
| `UserOrderCounter` | `['order_counter', user]` | Tracks `next_order_id` and open-order count for deterministic PDAs |
| `Order` | `['order', user, order_id]` | Stores trigger + CPI blueprint + status flags |
| `Vault` | `['vault', user, order_id]` | System-owned PDA that actually holds escrowed SOL |

Why two PDAs (`Order` and `Vault`) instead of one?

- `Order` is Anchor account data, not appropriate as SOL transfer source for system transfer use cases.
- `Vault` is a system-owned lamport holder specifically for funding payouts and CPI flows.

---

## 3) Order Lifecycle (State Machine)

```mermaid
flowchart LR
  A[init_user_counter] --> B[create_order]
  B --> C[Pending Open Order]
  C -->|trigger true + execute_order_*| D[Executed]
  C -->|cancel_order by user| E[Canceled]
  D --> F[close_order]
  E --> F
  F --> G[Order account closed]
```

Key rule: `close_order` is only valid after `executed == true` or `canceled == true`.

---

## 4) Instruction-by-Instruction (What + Why)

### `init_user_counter`

- Creates per-user counter PDA.
- Needed so order IDs are deterministic and monotonic.

### `create_order`

- Validates input and whitelisted target program.
- Creates `Order` + `Vault` PDAs.
- Stores trigger and CPI blueprint (`CpiAction`).
- Transfers `input_amount` lamports from user to vault.

Why needed: separates "decide action now" from "execute later".

### `execute_order_if_ready`

- For base triggers: `TimeAfter`, `PdaValueEquals`.
- Validates order is executable.
- Evaluates trigger.
- Executes stored CPI blueprint.
- Pays keeper bounty and marks order executed.

### `execute_order_if_ready_stork`

- Same execution pipeline, but for Stork-trigger variants (`PriceBelowStork`, `PriceAboveStork`, `StorkOutcomeEquals`).
- Takes an explicit `stork_feed` account and validates it against the committed trigger `feed_id` at runtime.

### `cancel_order`

- User-only escape hatch.
- Refunds entire vault lamports to user.
- Marks order canceled.

### `close_order`

- Final cleanup after executed/canceled.
- Decrements open-order counter.
- Closes `Order` account and returns rent to user.
- Drains any remaining vault lamports first.

---

## 5) Trigger Routing

```mermaid
flowchart TD
  T[Order.trigger] --> A{Trigger variant}
  A -->|TimeAfter / PdaValueEquals| B[execute_order_if_ready]
  A -->|PriceBelowStork / PriceAboveStork / StorkOutcomeEquals| C[execute_order_if_ready_stork]
  B --> D[validate_order_ready]
  C --> D
  D --> E[evaluate_trigger_*]
  E --> F[execute_order_action]
  F --> G[settle_execution]
```

Why split execute instructions?

- Keeps account contracts explicit.
- Avoids ambiguous optional oracle accounts.
- Easier client/keeper instruction building.

---

## 6) Stork Feed Semantics (What `feed_id` Means)

`feed_id` identifies a Stork numeric feed. It is **not** a boolean.

- Stork feeds store a timestamped numeric fact (`quantized_value`, `timestamp_ns`).
- The trigger converts that numeric value into a boolean condition.
- `feed_id` answers "which feed?", while the trigger fields answer "what condition?".

Supported Stork trigger semantics in this program:

- `PriceBelowStork`: `quantized_value <= max_price_q`
- `PriceAboveStork`: `quantized_value >= min_price_q`
- `StorkOutcomeEquals`: `quantized_value == expected_outcome_q`

Kalshi-specific interpretation:

- If Stork publishes a Kalshi **price/probability** feed, use `below` / `above`.
- If Stork publishes a Kalshi **resolution/outcome** feed, use `StorkOutcomeEquals`.
- `StorkOutcomeEquals` is only "market resolved" semantically when the selected Stork feed is an outcome feed.

## 7) Stork Create + Execute Flow (Committed Feed ID)

For Stork triggers, the `feed_id` is committed at `create_order` time because it is stored inside the order's `Trigger`.

Execution derives the expected `feed_id` from the stored trigger instead of trusting a transaction parameter:

1. Read `order.trigger`.
2. Extract expected `feed_id` from the Stork trigger variant.
3. Derive the expected Stork feed PDA using `["stork_feed", feed_id]` under the Stork program.
4. Verify the provided `stork_feed` account matches that PDA.
5. Read the latest value and apply freshness + trigger condition checks.

This prevents a keeper from swapping the oracle feed at execution time.

## 8) Stork Two-Step Transaction Model

Off-chain detection is only a scheduling signal. On-chain trigger evaluation remains the source of truth.

```mermaid
sequenceDiagram
  participant K as Keeper / Invocation Server
  participant S as Stork Program
  participant O as order_executor

  K->>S: Stork signed update instruction(s)
  S-->>S: Verify signed payload and update feed account
  K->>O: execute_order_if_ready_stork
  O->>O: Derive feed_id from stored order trigger
  O->>O: Validate stork_feed PDA matches committed feed_id
  O->>O: Check freshness + threshold/equality
  O->>O: Execute CPI action + settle bounty
```

---

## 9) CPI Engine (Most Important Part)

The stored `CpiAction` contains:

- `program_id`
- ordered list of CPI account pubkeys + writable flags
- raw instruction data bytes

At execution time, keeper supplies real `AccountInfo`s through `remaining_accounts`.

Expected `remaining_accounts` layout:

1. `action.accounts[0..n]`
2. `action.program_id` account as final entry

```mermaid
sequenceDiagram
  participant K as Keeper Tx
  participant P as order_executor
  participant TP as Target Program

  K->>P: execute_order_* (base accounts + remaining_accounts)
  P->>P: validate order state + trigger
  P->>P: validate each remaining account against stored blueprint
  P->>P: validate target program AccountInfo exists/executable
  P->>TP: invoke_signed(CPI)
  TP-->>P: success/failure
  P->>P: pay bounty, mark executed
```

Signer behavior:

- Program derives both signer seeds:
  - `order` PDA seeds
  - `vault` PDA seeds
- CPI `AccountMeta.is_signer` is set true when account pubkey equals order or vault PDA.
- Runtime then honors PDA signing through `invoke_signed`.

---

## 10) Security Invariants

1. **Program whitelist**
   - CPI target must be allowed (`System` or `SPL Token`).
2. **Exact account matching**
   - Provided CPI accounts must match stored pubkeys exactly.
3. **No writable escalation**
   - If stored account is read-only, execution cannot make it writable.
4. **Replay resistance**
   - `executed` and `canceled` gates prevent re-execution.
5. **Expiry gate**
   - Expired orders cannot execute.
6. **User authority on control paths**
   - Cancel/close require user signer and PDA constraints.
7. **Stork feed identity is committed**
   - The Stork feed is derived from the stored trigger `feed_id` at execution, not a caller-supplied oracle selector.

---

## 11) What this architecture is good at

- Time/PDA/Stork-triggered SOL payouts from escrow vault.
- Token transfers where expected authority is an executor PDA.
- Deterministic, auditable delayed execution with clear account constraints.

## 12) Known limitations (intentional)

1. **Stored CPI data is static**
   - Good for fixed-parameter actions.
   - Not ideal for highly state-dependent DeFi instructions.
2. **Whitelist is intentionally narrow**
   - New target programs must be explicitly added.
3. **`init_user_counter` is required once per user**
   - Client should auto-initialize if missing.
4. **`StorkOutcomeEquals` depends on feed semantics**
   - It only represents market resolution if Stork publishes a resolution/outcome feed for that market.

---

## 13) Minimal End-to-End Example

```mermaid
flowchart LR
  U[User] -->|create_order| O[Order PDA stores transfer blueprint]
  U -->|escrow SOL| V[Vault PDA]
  K[Keeper] -->|after trigger| X[execute_order_if_ready]
  X -->|CPI transfer| R[Recipient gets funds]
  X -->|bounty| K
```

That is the full model: **user defines plan + funds vault, keeper executes when trigger is true, program enforces the plan exactly**.
