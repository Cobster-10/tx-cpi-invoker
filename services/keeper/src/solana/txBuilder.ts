import {
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { ExecutionCandidate, OrderEnvelope } from "../orders/types.js";
import { deriveStorkFeedPda } from "../orders/helpers.js";
import { OrderExecutorClient } from "./orderExecutorClient.js";
import type { SwapInstruction } from "./orderExecutorClient.js";
import { buildStorkUpdateInstruction } from "./storkClient.js";
import { getSwapInstruction } from "./jupiterClient.js";

export type BuildTransactionInput = {
  candidate: ExecutionCandidate;
  order: OrderEnvelope;
  keeper: PublicKey;
  /** Required for stork route: derive stork_feed PDA from candidate.feedId */
  storkFeed?: PublicKey;
};

export class TxBuilder {
  constructor(private readonly client: OrderExecutorClient) {}

  async build(input: BuildTransactionInput): Promise<Transaction> {
    const tx = new Transaction();

    let swapInstruction: SwapInstruction | undefined;
    let setupInstructions: TransactionInstruction[] = [];
    let computeBudgetInstructions: TransactionInstruction[] = [];

    if (input.order.action.kind === "swapIntent") {
      const [vaultPda] = this.client.deriveVaultPda(
        input.order.user,
        input.order.orderId
      );
      const jupiterResult = await getSwapInstruction({
        vaultPda,
        inputMint: input.order.action.intent.inputMint,
        outputMint: input.order.action.intent.outputMint,
        amountLamports: Number(input.order.action.intent.inputAmount),
        slippageBps: input.order.action.intent.maxSlippageBps,
        payer: input.keeper,
      });
      if (!jupiterResult) {
        throw new Error(
          "Jupiter API unavailable or failed to fetch swap instruction for SwapIntent order"
        );
      }
      swapInstruction = jupiterResult.swapInstruction;
      setupInstructions = jupiterResult.setupInstructions;
      computeBudgetInstructions = jupiterResult.computeBudgetInstructions;
    }

    // For SwapIntent: prepend Jupiter setup (create ATAs, wrap SOL) and compute budget
    for (const ix of computeBudgetInstructions) {
      tx.add(ix);
    }
    for (const ix of setupInstructions) {
      tx.add(ix);
    }

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
        swapInstruction,
      });
      tx.add(instruction);
    } else {
      const instruction = this.client.buildExecuteOrderIfReadyInstruction({
        order: input.order,
        keeper: input.keeper,
        swapInstruction,
      });
      tx.add(instruction);
    }

    return tx;
  }
}
