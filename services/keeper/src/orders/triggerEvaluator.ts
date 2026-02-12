import { Connection } from "@solana/web3.js";
import { StorkFeedCache } from "../stork/storkFeedCache.js";
import { ExecutionCandidate, OrderEnvelope } from "./types.js";

export class TriggerEvaluator {
  constructor(
    private readonly _connection: Connection,
    private readonly _storkFeedCache: StorkFeedCache,
  ) {}

  async evaluate(_order: OrderEnvelope): Promise<ExecutionCandidate | null> {
    // TODO: implement trigger routing and readiness checks.
    return null;
  }
}
