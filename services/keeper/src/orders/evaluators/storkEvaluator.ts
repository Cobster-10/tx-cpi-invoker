import { ExecutionCandidate, OrderEnvelope, Trigger } from "../types.js";
import { FeedSnapshot, IStorkEvaluator } from "./types.js";

const NS_PER_SEC = 1_000_000_000n;

function isSnapshotFresh(timestampNs: bigint, maxAgeSec: bigint): boolean {
  const nowNs = BigInt(Date.now()) * 1_000_000n;
  const ageNs = nowNs - timestampNs;
  const ageSec = ageNs / NS_PER_SEC;
  return ageSec <= maxAgeSec;
}

export class StorkEvaluator implements IStorkEvaluator {
  supports(trigger: Trigger): boolean {
    return (
      trigger.kind === "price_below_stork" ||
      trigger.kind === "price_above_stork" ||
      trigger.kind === "stork_outcome_equals"
    );
  }

  evaluate(order: OrderEnvelope, snapshot: FeedSnapshot): ExecutionCandidate | null {
    const trigger = order.trigger;

    if (trigger.kind === "price_below_stork") {
      if (!isSnapshotFresh(snapshot.timestampNs, trigger.maxAgeSec)) return null;
      if (snapshot.quantizedValue > trigger.maxPriceQ) return null;
      return {
        orderPubkey: order.orderPubkey,
        route: "stork",
        reason: `price ${snapshot.quantizedValue} <= ${trigger.maxPriceQ}`,
        feedId: snapshot.feedId,
        storkPushPayload: snapshot.storkPushPayload,
      };
    }

    if (trigger.kind === "price_above_stork") {
      if (!isSnapshotFresh(snapshot.timestampNs, trigger.maxAgeSec)) return null;
      if (snapshot.quantizedValue < trigger.minPriceQ) return null;
      return {
        orderPubkey: order.orderPubkey,
        route: "stork",
        reason: `price ${snapshot.quantizedValue} >= ${trigger.minPriceQ}`,
        feedId: snapshot.feedId,
        storkPushPayload: snapshot.storkPushPayload,
      };
    }

    if (trigger.kind === "stork_outcome_equals") {
      if (!isSnapshotFresh(snapshot.timestampNs, trigger.maxAgeSec)) return null;
      if (snapshot.quantizedValue !== trigger.expectedOutcomeQ) return null;
      return {
        orderPubkey: order.orderPubkey,
        route: "stork",
        reason: `outcome ${snapshot.quantizedValue} == ${trigger.expectedOutcomeQ}`,
        feedId: snapshot.feedId,
        storkPushPayload: snapshot.storkPushPayload,
      };
    }

    return null;
  }
}
