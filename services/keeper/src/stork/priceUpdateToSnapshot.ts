import type { FeedSnapshot } from "../orders/evaluators/types.js";
import type { StorkPriceUpdate } from "./subscriber-service.js";
import type { FeedIdMapper } from "./feedIdMapper.js";

/**
 * Convert a Stork WebSocket price update to a FeedSnapshot for trigger evaluation.
 * Returns null if the asset ID is not in the feed map.
 */
export function priceUpdateToSnapshot(
  update: StorkPriceUpdate,
  mapper: FeedIdMapper
): FeedSnapshot | null {
  const feedId = mapper.getFeedId(update.assetId);
  if (!feedId) return null;

  let quantizedValue: bigint;
  try {
    quantizedValue = BigInt(update.price);
  } catch {
    return null;
  }

  let timestampNs: bigint;
  try {
    const ts = BigInt(update.timestamp);
    timestampNs = ts > 1e15 ? ts : ts * 1_000_000n;
  } catch {
    return null;
  }

  return {
    feedId,
    quantizedValue,
    timestampNs,
  };
}
