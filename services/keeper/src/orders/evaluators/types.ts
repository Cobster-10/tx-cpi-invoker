import { ExecutionCandidate, OrderEnvelope, Trigger } from "../types.js";

export type FeedSnapshot = {
  feedId: Uint8Array;
  quantizedValue: bigint;
  timestampNs: bigint;
};

/**
 * Evaluators that can be polled (e.g. time_after, pda_value_equals).
 * They fetch RPC data and return a candidate if the trigger is satisfied.
 */
export interface IPollableEvaluator {
  supports(trigger: Trigger): boolean;
  evaluate(order: OrderEnvelope): Promise<ExecutionCandidate | null>;
}

/**
 * Evaluates Stork triggers when given a price snapshot.
 * Called from the WebSocket event handler, not from the poll loop.
 */
export interface IStorkEvaluator {
  supports(trigger: Trigger): boolean;
  evaluate(order: OrderEnvelope, snapshot: FeedSnapshot): ExecutionCandidate | null;
}
