# Keeper Service Architecture

## 1) Keeper Mission

The keeper is an off-chain worker that:

1. Finds open `Order` PDAs
2. Checks whether each trigger is ready
3. Submits execute transactions for ready orders

In short: **discover -> evaluate -> execute -> record**.

---

## 2) Current Runtime Design (as implemented)

```mermaid
flowchart LR
  RPC[(Solana RPC)] --> S[OrderScanner]
  S --> Q[(In-memory queue)]
  Q --> E[TriggerEvaluator]
  E --> B[TxBuilder]
  B --> T[TxSender]
  T --> ST[SqliteStore placeholder]
```

Important current-state truth:

- `TxSender` is scaffolded (returns simulated status in dry-run flow).
- `SqliteStore` is currently in-memory behavior, not durable DB writes.
- Stork route plumbing exists in types/client but trigger evaluator currently skips Stork execution.

---

## 3) Main Loop Behavior

```mermaid
flowchart TD
  A[scanOpenOrders] --> B[upsert into queue]
  B --> C[remove stale queue entries]
  C --> D{for each queued order}
  D --> E[evaluate trigger]
  E -->|not ready| D
  E -->|ready| F{duplicate already settled?}
  F -->|yes| G[drop from queue]
  F -->|no| H[build tx]
  H --> I[send tx]
  I --> J[record result + attempts]
  J --> K{status confirmed/simulated?}
  K -->|yes| G
  K -->|no| D
```

This loop runs every `pollIntervalMs`.

---

## 4) Components and Responsibilities

### `OrderExecutorClient`

- Scans and decodes open order accounts from chain.
- Derives order/vault PDAs from `(user, order_id)`.
- Builds execute/cancel/close instructions.
- Builds vault-based system-transfer CPI action payloads.

### `OrderScanner`

- Thin wrapper around client scan.

### `TriggerEvaluator`

- Evaluates currently-supported routes:
  - `time_after`
  - `pda_value_equals`
- Stork trigger kinds currently return `null` (deferred route).

### `TxBuilder`

- Builds execute transaction around program instruction.
- Stork signed-update prepend is marked TODO.

### `TxSender`

- Presently returns simulated result scaffold.
- Real send/confirm/retry pipeline is not yet wired.

### `SqliteStore`

- Current code tracks attempts/duplicate suppression in memory.
- Constructor accepts path but persistent sqlite behavior is not implemented yet.

### `MetricsServer`

- Placeholder class; no live metrics exported yet.

---

## 5) Keeper <-> Program Account Contract

For execute calls, keeper must pass:

1. Program fixed accounts (`order`, `vault`, `user`, `keeper`, route-specific account(s), `system_program`)
2. CPI dynamic accounts in exact stored order
3. CPI target program account as final remaining account

```mermaid
flowchart LR
  A[Fixed execute accounts] --> B[remaining: cpi account 0..n]
  B --> C[remaining: target program account]
  C --> D[on-chain validate + invoke_signed]
```

If remaining account order or identities differ from stored `CpiAction`, execution fails.

---

## 6) Trigger Support Matrix (Current)

| Trigger | Keeper Evaluates? | Execute Route |
|---|---:|---|
| `TimeAfter` | Yes | `base` |
| `PdaValueEquals` | Yes | `base` |
| `PriceBelowStork` | Not yet | Planned `stork` |
| `StorkOutcomeEquals` | Not yet | Planned `stork` |

---

## 7) Failure Model and Idempotency

Current protections:

1. Duplicate guard by `(orderPubkey, route)` status in store.
2. Queue entries removed when order is no longer open.
3. Failed attempts recorded with incrementing count.

Because order execution on-chain is state-gated (`executed/canceled`), retrying an already-finalized order is safe and will fail deterministically.

---

## 8) Production-Ready Target (minimal, non-bloated)

Keep the same module boundaries; upgrade internals:

1. **Real `TxSender` pipeline**
   - simulate -> sign -> send -> confirm
   - bounded retry with backoff + error classification
2. **Durable store**
   - real sqlite persistence for attempts/results/checkpoints
3. **Hybrid ingestion**
   - keep polling
   - add websocket program-account subscription for lower latency
4. **Stork route completion**
   - fetch/cache signed updates
   - prepend signed update ix before execute ix

This is enough for reliability without introducing unnecessary system complexity.

---

## 9) End-to-End Keeper View

```mermaid
sequenceDiagram
  participant K as Keeper
  participant RPC as Solana RPC
  participant P as order_executor Program

  K->>RPC: getProgramAccounts(order_executor)
  RPC-->>K: open orders
  K->>K: evaluate trigger
  K->>P: execute_order_* tx
  P-->>K: success/failure
  K->>K: record result, update queue
```

That is the operational model today: **poll + queue + evaluate + execute scaffold**, with clear extension points for full production behavior.
