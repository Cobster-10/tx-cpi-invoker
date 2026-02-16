# Keeper Architecture

## Goal

Continuously observe open `Order` PDAs, detect when their trigger conditions become true, and submit execution transactions to the `order_executor` program.

## High-Level Flow

```
scan open orders -> upsert in work queue -> evaluate trigger -> build tx -> send tx -> record result
```

The loop runs every `pollIntervalMs`.

## Runtime Components

- `OrderExecutorClient`
  - Scans and decodes open `Order` accounts from chain.
  - Derives `order` and `vault` PDAs.
  - Builds execution/cancel/close instructions with the required account metas.
  - Builds vault-based system-transfer `CpiAction` payloads for order creation workflows.

- `OrderScanner`
  - Thin wrapper around `OrderExecutorClient.scanOpenOrders()`.

- `TriggerEvaluator`
  - Evaluates base triggers:
    - `time_after`
    - `pda_value_equals`
  - Stork trigger execution remains intentionally deferred until Stork invocation wiring is added.

- `TxBuilder`
  - Builds a transaction containing the order-executor execute instruction.

- `TxSender`
  - Sends (or simulates in dry-run mode) the transaction.

- `SqliteStore` (currently in-memory placeholder)
  - Tracks duplicate execution status and attempt counts.

## Queue Design

The keeper uses an in-memory work queue (`Map<orderPubkey, OrderEnvelope>`) in `main.ts`:

1. Scan current open orders.
2. Upsert each order into the queue.
3. Remove queue entries not present in latest scan (stale/closed/canceled).
4. For each queued order:
   - Evaluate trigger.
   - Skip if not ready.
   - Build and send execution tx if ready.
   - Record attempt/result.
   - Remove from queue on terminal success (`confirmed` or `simulated`).

This is the "observe PDA creation -> add to queue -> wait for trigger -> execute" behavior.

## Account Model Requirements

Because the on-chain executor now uses a system-owned vault PDA:

- Execution instructions must include:
  - `order` PDA
  - `vault` PDA
  - trigger-specific accounts
  - dynamic CPI accounts
  - CPI target program account (last)

- System-transfer actions must use:
  - `from = vaultPda`
  - not `from = orderPda`

## Current Implementation Status

Implemented:

- On-chain open-order scan and decode.
- Queue-based scheduling loop.
- Trigger evaluation for base triggers.
- Vault-aware execute/cancel/close instruction builders.
- Vault-based system-transfer action builder.

Deferred:

- Stork signed-update ingestion and stork execution path.
- Durable SQLite persistence (current class is in-memory).
- Real transaction submission/signature confirmation path in `TxSender` (current dry-run scaffold).
- Optional websocket subscriptions (`onProgramAccountChange`) for lower latency.

## Optimal Architecture (Target)

For production, keep the same module boundaries and add:

1. Hybrid ingestion:
   - Polling as correctness fallback.
   - `onProgramAccountChange` subscription for low-latency queue updates.
2. Durable state:
   - Persist queue/checkpoints/attempts in SQLite.
3. Robust send pipeline:
   - Simulate -> send -> confirm -> retry with backoff.
4. Stork pipeline:
   - Feed cache refresh + signed update ix injection before execute.

This keeps complexity low while making the keeper reliable and cost-efficient.
