import { Connection, Keypair, Transaction } from "@solana/web3.js";
import { KeeperConfig } from "../config.js";
import { ExecutionResult } from "../orders/types.js";

export class TxSender {
  constructor(
    private readonly _connection: Connection,
    private readonly _keeper: Keypair,
    private readonly config: KeeperConfig,
  ) {}

  async send(_tx: Transaction): Promise<ExecutionResult> {
    // Scaffold behavior: report simulated result in dry-run mode.
    return {
      signature: this.config.dryRun ? "dry-run" : "not-implemented",
      slot: 0,
      status: "simulated",
    };
  }
}
