import type { FeedSnapshot } from "../orders/evaluators/types.js";
import type { StorkPriceUpdate } from "./subscriber-service.js";
import type { FeedIdMapper } from "./feedIdMapper.js";

/**
 * Parse a hex string to exactly 32 bytes. Pads with leading zeros if needed.
 */
function hexToBytes32(hex: string): Uint8Array | null {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (normalized.length > 64) return null;
  const padded = normalized.padStart(64, "0");
  try {
    return new Uint8Array(Buffer.from(padded, "hex"));
  } catch {
    return null;
  }
}

/**
 * Parse signature v to u8 (27/28 or 0x1b/0x1c).
 */
function parseSignatureV(v: string): number | null {
  const parsed = v.startsWith("0x")
    ? parseInt(v, 16)
    : parseInt(v, 10);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 255) return null;
  return parsed;
}

/**
 * Convert a Stork WebSocket price update to a FeedSnapshot for trigger evaluation.
 * Returns null if the asset ID is not in the feed map.
 *
 * When the update contains valid signature data, storkPushPayload is populated
 * so the keeper can push the update to the Stork contract before executing orders.
 */
export function priceUpdateToSnapshot(
  update: StorkPriceUpdate,
  mapper: FeedIdMapper,
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

  const snapshot: FeedSnapshot = {
    feedId,
    quantizedValue,
    timestampNs,
  };

  // Build storkPushPayload if we have valid signature data for on-chain push
  const publisherMerkleRoot = hexToBytes32(update.publisherMerkleRoot);
  const valueComputeAlgHash = hexToBytes32(update.calculationAlgHash);
  const r = hexToBytes32(update.signature.r);
  const s = hexToBytes32(update.signature.s);
  const v = parseSignatureV(update.signature.v);

  if (
    publisherMerkleRoot &&
    valueComputeAlgHash &&
    r &&
    s &&
    v !== null
  ) {
    snapshot.storkPushPayload = {
      feedId,
      quantizedValue,
      timestampNs,
      publisherMerkleRoot,
      valueComputeAlgHash,
      signatureR: r,
      signatureS: s,
      signatureV: v,
      treasuryId: 0,
    };
  }

  return snapshot;
}
