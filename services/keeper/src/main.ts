import { loadConfig } from "./config.js";
import { log } from "./logger.js";
import { MetricsServer } from "./metrics/http.js";
import { OrderScanner } from "./orders/orderScanner.js";
import { TriggerEvaluator } from "./orders/evaluators/triggerEvaluator.js";
import { extractStorkFeedIds } from "./orders/helpers.js";
import { createSolanaContext } from "./solana/connection.js";
import { TxBuilder } from "./solana/txBuilder.js";
import { TxSender } from "./solana/txSender.js";
import { OrderExecutorClient } from "./solana/orderExecutorClient.js";
import { SqliteStore } from "./state/sqliteStore.js";
import { OrderEnvelope } from "./orders/types.js";
import { StorkWSListener } from "./stork/subscriber-service.js";
import { FeedIdMapper } from "./stork/feedIdMapper.js";
import { priceUpdateToSnapshot } from "./stork/priceUpdateToSnapshot.js";

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

  const feedMapper = config.storkFeedMap
    ? new FeedIdMapper(config.storkFeedMap)
    : null;

  let storkListener: StorkWSListener | null = null;
  if (config.storkWsUrl && config.storkApiKey && feedMapper) {
    storkListener = new StorkWSListener(
      config.storkWsUrl,
      config.storkApiKey,
      feedMapper.getAssetIds()
    );
    storkListener.start();
    storkListener.on("connected", () => log.info("Stork WebSocket connected"));
    storkListener.on("disconnected", () =>
      log.warn("Stork WebSocket disconnected, reconnecting...")
    );
  } else if (config.storkWsUrl || config.storkApiKey) {
    log.warn(
      "Stork WS/API key set but STORK_FEED_MAP missing; Stork triggers disabled"
    );
  }

  log.info("Keeper scaffold started", {
    rpc: config.rpcHttpUrl,
    programId: config.programId,
    dryRun: config.dryRun,
    storkEnabled: !!storkListener,
  });

  const queue = new Map<string, OrderEnvelope>();
  const subscribedAssetIds = new Set<string>(
    feedMapper?.getAssetIds() ?? []
  );

  const subscribeNewStorkAssets = (orders: OrderEnvelope[]) => {
    
    if (!storkListener || !feedMapper) return;
    
    const feedIds = extractStorkFeedIds(orders);
    const toAdd: string[] = [];
    for (const fid of feedIds) {
      const assetId = feedMapper.getAssetId(fid);
      if (assetId && !subscribedAssetIds.has(assetId)) toAdd.push(assetId);
    }
    if (toAdd.length > 0) {
      toAdd.forEach((a) => subscribedAssetIds.add(a));
      console.log("subscribing", subscribedAssetIds);
      storkListener.subscribe(toAdd); 
      log.info("Stork subscribed to new assets", { assets: toAdd });
    }
  };

  // Listen for price updates from stork and execute orders that are ready
  if (storkListener && feedMapper) {
    storkListener.on("priceUpdate", (update) => {
      const snapshot = priceUpdateToSnapshot(update, feedMapper);
      if (!snapshot) return;

      // 
      const orders = Array.from(queue.values());
      const relevant = evaluator.getStorkOrdersForFeed(orders, snapshot.feedId);


      for (const order of relevant) {
        console.log("order", order);

        const candidate = evaluator.evaluateStork(order, snapshot);
        if (!candidate) continue;

        const orderKey = order.orderPubkey.toBase58();
        if (store.isDuplicate(orderKey, candidate.route)) continue;

        const attempts = store.getAttemptCount(orderKey, candidate.route) + 1;
        const tx = txBuilder.build({
          candidate,
          order,
          keeper: solana.keeperKeypair.publicKey,
        });

        txSender
          .send(tx)
          .then((result) => {
            console.log("result", result);
            store.recordExecutionResult(candidate, result, attempts);
            if (result.status === "confirmed" || result.status === "simulated") {
              queue.delete(orderKey);
            }
          })
          .catch((error) => {
            log.error("Stork execution attempt failed", {
              order: orderKey,
              route: candidate.route,
              attempts,
              error,
            });
            store.recordCandidateFailure(candidate, "execution_error", attempts);
          });
      }
    });
  }

  while (true) {
    const orders = await scanner.scanOpenOrders();
    const scannedOrderIds = new Set<string>();

    
    for (const order of orders) {
      const orderKey = order.orderPubkey.toBase58();
      scannedOrderIds.add(orderKey);
      queue.set(orderKey, order);
    }

    console.log("orders", orders);
    subscribeNewStorkAssets(orders);

    for (const queuedOrderKey of Array.from(queue.keys())) {
      if (!scannedOrderIds.has(queuedOrderKey)) {
        queue.delete(queuedOrderKey);
      }
    }

    for (const [orderKey, order] of queue.entries()) {
      // make sure the order is a non stork order and it is ready to be executed
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
