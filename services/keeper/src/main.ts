import { loadConfig } from "./config.js";
import { log } from "./logger.js";
import { MetricsServer } from "./metrics/http.js";
import { OrderScanner } from "./orders/orderScanner.js";
import { TriggerEvaluator } from "./orders/triggerEvaluator.js";
import { createSolanaContext } from "./solana/connection.js";
import { TxBuilder } from "./solana/txBuilder.js";
import { TxSender } from "./solana/txSender.js";
import { VaultClient } from "./solana/vaultClient.js";
import { SqliteStore } from "./state/sqliteStore.js";
import { StorkApi } from "./stork/storkApi.js";
import { StorkFeedCache } from "./stork/storkFeedCache.js";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const main = async (): Promise<void> => {
  const config = loadConfig();
  const solana = createSolanaContext(config);

  const metrics = new MetricsServer();
  const store = new SqliteStore(config.sqlitePath);
  const vaultClient = new VaultClient(solana.connection, solana.vaultProgramId);
  const scanner = new OrderScanner(vaultClient);
  const storkApi = new StorkApi({
    baseUrl: config.storkHttpUrl,
    apiKey: config.storkApiKey,
  });
  const storkCache = new StorkFeedCache(storkApi, config.storkFeedAllowlist);
  const evaluator = new TriggerEvaluator(solana.connection, storkCache);
  const txBuilder = new TxBuilder(vaultClient);
  const txSender = new TxSender(solana.connection, solana.keeperKeypair, config);

  metrics.start();

  log.info("Keeper scaffold started", {
    rpc: config.rpcHttpUrl,
    programId: config.vaultProgramId,
    dryRun: config.dryRun,
  });

  // Scaffold loop: wiring only. Deep execution logic will be added incrementally.
  while (true) {
    const orders = await scanner.scanOpenOrders();

    for (const order of orders) {
      const candidate = await evaluator.evaluate(order);
      if (!candidate) continue;

      const tx = txBuilder.build({
        candidate,
        order,
        keeper: solana.keeperKeypair.publicKey,
      });

      const result = await txSender.send(tx);
      store.recordExecutionResult(candidate, result, 1);
    }

    await sleep(config.pollIntervalMs);
  }
};

main().catch((error) => {
  log.error("Keeper crashed", error);
  process.exit(1);
});
