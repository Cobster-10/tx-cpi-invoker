import {
  Connection,
  Keypair,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import { KeeperConfig } from "../config.js";
import { ExecutionResult } from "../orders/types.js";

export class TxSender {
  constructor(
    private readonly connection: Connection,
    private readonly keeper: Keypair,
    private readonly config: KeeperConfig,
  ) {}

  async send(tx: Transaction): Promise<ExecutionResult> {
    tx.feePayer = this.keeper.publicKey;

    if (this.config.dryRun) {
      return this.simulate(tx);
    }
    return this.sendAndConfirm(tx);
  }

  private async simulate(tx: Transaction): Promise<ExecutionResult> {
    const result = await this.connection.simulateTransaction(tx, [
      this.keeper,
    ]);

    if (result.value.err) {
      throw new Error(
        `Simulation failed: ${JSON.stringify(result.value.err)}`,
      );
    }

    return {
      signature: "dry-run",
      slot: 0,
      status: "simulated",
    };
  }

  private async sendAndConfirm(tx: Transaction): Promise<ExecutionResult> {
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash(this.config.commitment);
    tx.recentBlockhash = blockhash;
    (tx as Transaction & { lastValidBlockHeight?: number }).lastValidBlockHeight =
      lastValidBlockHeight;

    const signature = await sendAndConfirmTransaction(
      this.connection,
      tx,
      [this.keeper],
      {
        commitment: this.config.commitment,
        preflightCommitment: this.config.commitment,
        maxRetries: 5,
      },
    );

    const status = await this.connection.getSignatureStatus(signature);
    const slot = status.value?.slot ?? 0;

    return {
      signature,
      slot,
      status: "confirmed",
    };
  }
}
