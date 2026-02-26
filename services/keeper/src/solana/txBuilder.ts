import { PublicKey, Transaction } from "@solana/web3.js";
import { ExecutionCandidate, OrderEnvelope } from "../orders/types.js";
import { deriveStorkFeedPda } from "../orders/helpers.js";
import { OrderExecutorClient } from "./orderExecutorClient.js";
import { buildStorkUpdateInstruction } from "./storkClient.js";

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

      if (input.candidate.storkPushPayload) {
        const storkUpdateIx = buildStorkUpdateInstruction({
          payload: input.candidate.storkPushPayload,
          payer: input.keeper,
        });
        tx.add(storkUpdateIx);
      }

      const instruction = this.client.buildExecuteOrderIfReadyStorkInstruction({
        order: input.order,
        keeper: input.keeper,
        storkFeed,
      });
      tx.add(instruction);
    } else {
      const instruction = this.client.buildExecuteOrderIfReadyInstruction({
        order: input.order,
        keeper: input.keeper,
      });
      tx.add(instruction);
    }

    return tx;
  }
}
