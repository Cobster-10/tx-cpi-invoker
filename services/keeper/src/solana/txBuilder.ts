import { PublicKey, Transaction } from "@solana/web3.js";
import { ExecutionCandidate, OrderEnvelope } from "../orders/types.js";
import { deriveStorkFeedPda } from "../orders/helpers.js";
import { OrderExecutorClient } from "./orderExecutorClient.js";

export type BuildTransactionInput = {
  candidate: ExecutionCandidate;
  order: OrderEnvelope;
  keeper: PublicKey;
  /** Required for stork route: derive stork_feed PDA from candidate.feedId */
  storkFeed?: PublicKey;
};

export class TxBuilder {
  constructor(private readonly client: OrderExecutorClient) {}

  build(input: BuildTransactionInput): Transaction {
    const tx = new Transaction();

    if (input.candidate.route === "stork" && input.candidate.feedId) {
      const storkFeed =
        input.storkFeed ?? deriveStorkFeedPda(input.candidate.feedId);
      // TODO: prepend Stork push instruction when signed payload is available.
      // For now, assume feed is already updated (e.g. by Chain Pusher).
      const instruction = this.client.buildExecuteInstruction({
        route: "stork",
        order: input.order,
        keeper: input.keeper,
        storkFeed,
      });
      tx.add(instruction);
    } else {
      const instruction = this.client.buildExecuteInstruction({
        route: input.candidate.route,
        order: input.order,
        keeper: input.keeper,
      });
      tx.add(instruction);
    }

    return tx;
  }
}
