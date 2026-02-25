import { bytesToHex } from "../orders/helpers.js";

/**
 * Maps between Stork feed_id (32 bytes) and asset ID (e.g. "BTCUSD").
 * Stork WebSocket uses asset IDs; on-chain triggers use feed_id.
 *
 * Config: STORK_FEED_MAP env as JSON object: {"<feed_id_hex>": "BTCUSD", ...}
 * Example: STORK_FEED_MAP='{"a1b2c3...":"BTCUSD","d4e5f6...":"ETHUSD"}'
 */
export class FeedIdMapper {
  private readonly feedIdToAssetId: Map<string, string>;
  private readonly assetIdToFeedId: Map<string, Uint8Array>;

  constructor(feedMap: Record<string, string>) {
    this.feedIdToAssetId = new Map();
    this.assetIdToFeedId = new Map();

    for (const [hex, assetId] of Object.entries(feedMap)) {
      const normalizedHex = hex.startsWith("0x") ? hex.slice(2) : hex;
      if (normalizedHex.length !== 64) continue;
      this.feedIdToAssetId.set(normalizedHex.toLowerCase(), assetId);
      this.assetIdToFeedId.set(assetId, new Uint8Array(Buffer.from(normalizedHex, "hex")));
    }
  }

  getAssetId(feedId: Uint8Array): string | undefined {
    return this.feedIdToAssetId.get(bytesToHex(feedId).toLowerCase());
  }

  getFeedId(assetId: string): Uint8Array | undefined {
    return this.assetIdToFeedId.get(assetId);
  }

  /** All asset IDs we can map to (for subscribe). */
  getAssetIds(): string[] {
    return Array.from(this.assetIdToFeedId.keys());
  }

  /** All feed_ids we can map from (from orders). */
  getKnownFeedIds(): Uint8Array[] {
    return Array.from(this.assetIdToFeedId.values());
  }
}
