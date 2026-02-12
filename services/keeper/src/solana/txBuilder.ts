import { PublicKey, Transaction } from "@solana/web3.js";
import { ExecutionCandidate, FeedSnapshot, OrderEnvelope } from "../orders/types.js";
import { VaultClient } from "./vaultClient.js";

export type BuildTransactionInput = {
  candidate: ExecutionCandidate;
  order: OrderEnvelope;
  keeper: PublicKey;
  snapshot?: FeedSnapshot;
};

export class TxBuilder {
  constructor(private readonly vaultClient: VaultClient) {}

  build(input: BuildTransactionInput): Transaction {
    // Scaffold: builds only the vault execute instruction.
    // TODO: prepend signed Stork update instruction when snapshot has payload.
    const instruction = this.vaultClient.buildExecuteInstruction({
      route: input.candidate.route,
      order: input.order,
      keeper: input.keeper,
    });

    const tx = new Transaction();
    tx.add(instruction);
    return tx;
  }
}
