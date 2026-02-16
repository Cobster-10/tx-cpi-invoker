import { PublicKey, Transaction } from "@solana/web3.js";
import { ExecutionCandidate, FeedSnapshot, OrderEnvelope } from "../orders/types.js";
import { OrderExecutorClient } from "./orderExecutorClient.js";

export type BuildTransactionInput = {
  candidate: ExecutionCandidate;
  order: OrderEnvelope;
  keeper: PublicKey;
  snapshot?: FeedSnapshot;
};

export class TxBuilder {
  constructor(private readonly client: OrderExecutorClient) {}

  build(input: BuildTransactionInput): Transaction {
    // Scaffold: builds only the order executor execute instruction.
    // TODO: prepend signed Stork update instruction when snapshot has payload.
    const instruction = this.client.buildExecuteInstruction({
      route: input.candidate.route,
      order: input.order,
      keeper: input.keeper,
    });

    const tx = new Transaction();
    tx.add(instruction);
    return tx;
  }
}
