import { Connection } from "@solana/web3.js";
import { ExecutionCandidate, OrderEnvelope } from "../types.js";
import { bytesEqual } from "../helpers.js";
import {
  TimeAfterEvaluator,
  PdaValueEqualsEvaluator,
  StorkEvaluator,
} from "./index.js";
import type { FeedSnapshot } from "./types.js";

/**
 * Facade that dispatches to individual trigger evaluators.
 *
 * - Base triggers (time_after, pda_value_equals): polled via evaluate().
 * - Stork triggers: return null here; use evaluateStork() from the WebSocket
 *   event handler when a price update arrives.
 */
export class TriggerEvaluator {
  private readonly pollableEvaluators: [
    TimeAfterEvaluator,
    PdaValueEqualsEvaluator,
  ];
  readonly storkEvaluator = new StorkEvaluator();

  constructor(private readonly connection: Connection) {
    this.pollableEvaluators = [
      new TimeAfterEvaluator(connection),
      new PdaValueEqualsEvaluator(connection),
    ];
  }

  /**
   * Evaluate base triggers (poll-driven).
   * Returns null for Stork triggers; those are handled by evaluateStork().
   */
  async evaluate(order: OrderEnvelope): Promise<ExecutionCandidate | null> {
    const trigger = order.trigger;

    if (
      trigger.kind === "price_below_stork" ||
      trigger.kind === "price_above_stork" ||
      trigger.kind === "stork_outcome_equals"
    ) {
      return null;
    }

    for (const evaluator of this.pollableEvaluators) {
      if (evaluator.supports(trigger)) {
        return evaluator.evaluate(order);
      }
    }
    return null;
  }

  /**
   * Evaluate Stork triggers (event-driven).
   * Call this when a price update arrives from the WebSocket.
   */
  evaluateStork(order: OrderEnvelope, snapshot: FeedSnapshot): ExecutionCandidate | null {
    return this.storkEvaluator.evaluate(order, snapshot);
  }

  /**
   * Return orders that have Stork triggers for the given feed_id.
   * Used by the WebSocket handler to filter which orders to evaluate on a price update.
   */
  getStorkOrdersForFeed(orders: OrderEnvelope[], feedId: Uint8Array): OrderEnvelope[] {
    return orders.filter((order) => {
      const t = order.trigger;
      if (
        t.kind !== "price_below_stork" &&
        t.kind !== "price_above_stork" &&
        t.kind !== "stork_outcome_equals"
      ) {
        return false;
      }
      return bytesEqual(t.feedId, feedId);
    });
  }
}
