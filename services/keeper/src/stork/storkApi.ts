import { FeedSnapshot } from "../orders/types.js";

export type StorkApiConfig = {
  baseUrl: string;
  apiKey: string;
};

export class StorkApi {
  constructor(private readonly _config: StorkApiConfig) {}

  async fetchLatestSnapshots(_feedIdsHex: string[]): Promise<FeedSnapshot[]> {
    // TODO: call Stork HTTP/WS and parse signed payloads + feed snapshots.
    return [];
  }
}
