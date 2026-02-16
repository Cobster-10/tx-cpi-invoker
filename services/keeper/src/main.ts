import { loadConfig } from "./config.js";
import { log } from "./logger.js";
import { MetricsServer } from "./metrics/http.js";
import { OrderScanner } from "./orders/orderScanner.js";
import { TriggerEvaluator } from "./orders/triggerEvaluator.js";
import { createSolanaContext } from "./solana/connection.js";
import { TxBuilder } from "./solana/txBuilder.js";
import { TxSender } from "./solana/txSender.js";
import { OrderExecutorClient } from "./solana/orderExecutorClient.js";
import { SqliteStore } from "./state/sqliteStore.js";
import { OrderEnvelope } from "./orders/types.js";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const main = async (): Promise<void> => {
  const config = loadConfig();
  const solana = createSolanaContext(config);

  const metrics = new MetricsServer();
  const store = new SqliteStore(config.sqlitePath);
  const client = new OrderExecutorClient(solana.connection, solana.programId);
  const scanner = new OrderScanner(client);
  const evaluator = new TriggerEvaluator(solana.connection);
  const txBuilder = new TxBuilder(client);
  const txSender = new TxSender(solana.connection, solana.keeperKeypair, config);

  metrics.start();

  log.info("Keeper scaffold started", {
    rpc: config.rpcHttpUrl,
    programId: config.programId,
    dryRun: config.dryRun,
  });

  const queue = new Map<string, OrderEnvelope>();

  while (true) {
    const orders = await scanner.scanOpenOrders();
    const scannedOrderIds = new Set<string>();

    for (const order of orders) {
      const orderKey = order.orderPubkey.toBase58();
      scannedOrderIds.add(orderKey);
      queue.set(orderKey, order);
    }

    // Drop stale queue entries when accounts are no longer open.
    for (const queuedOrderKey of Array.from(queue.keys())) {
      if (!scannedOrderIds.has(queuedOrderKey)) {
        queue.delete(queuedOrderKey);
      }
    }

    for (const [orderKey, order] of queue.entries()) {
      const candidate = await evaluator.evaluate(order);
      if (!candidate) continue;

      if (store.isDuplicate(orderKey, candidate.route)) {
        queue.delete(orderKey);
        continue;
      }

      const attempts = store.getAttemptCount(orderKey, candidate.route) + 1;

      const tx = txBuilder.build({
        candidate,
        order,
        keeper: solana.keeperKeypair.publicKey,
      });

      try {
        const result = await txSender.send(tx);
        store.recordExecutionResult(candidate, result, attempts);

        // Keep queue focused on unresolved work only.
        if (result.status === "confirmed" || result.status === "simulated") {
          queue.delete(orderKey);
        }
      } catch (error) {
        log.error("Execution attempt failed", {
          order: orderKey,
          route: candidate.route,
          attempts,
          error,
        });
        store.recordCandidateFailure(candidate, "execution_error", attempts);
      }
    }

    await sleep(config.pollIntervalMs);
  }
};

main().catch((error) => {
  log.error("Keeper crashed", error);
  process.exit(1);
});
