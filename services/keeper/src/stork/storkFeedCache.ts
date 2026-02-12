import { bytesToHex } from "../orders/helpers.js";
import { FeedSnapshot } from "../orders/types.js";
import { StorkApi } from "./storkApi.js";

export class StorkFeedCache {
  private readonly snapshots = new Map<string, FeedSnapshot>();

  constructor(
    private readonly storkApi: StorkApi,
    private readonly allowlist: string[],
  ) {}

  async refresh(requestedFeedIds: Uint8Array[]): Promise<void> {
    const requested = requestedFeedIds.map(bytesToHex);
    const ids = this.allowlist.length > 0 ? this.allowlist : requested;
    if (ids.length === 0) return;

    const latest = await this.storkApi.fetchLatestSnapshots(ids);
    for (const snapshot of latest) {
      this.snapshots.set(bytesToHex(snapshot.feedId), snapshot);
    }
  }

  get(feedId: Uint8Array): FeedSnapshot | undefined {
    return this.snapshots.get(bytesToHex(feedId));
  }
}
