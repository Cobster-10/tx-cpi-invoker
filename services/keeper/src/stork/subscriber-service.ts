import WebSocket from "ws";
import { EventEmitter } from "events";

export interface StorkPriceUpdate {
  assetId: string;
  encodedAssetId: string;
  price: string;
  timestamp: string;
  signature: {
    r: string;
    s: string;
    v: string;
  };
  publisherMerkleRoot: string;
  calculationAlgHash: string;
}

export class StorkWSListener extends EventEmitter {
  private ws: WebSocket | null = null;
  private readonly wsUrl: string;
  private readonly apiKey: string;
  private readonly assets: string[];

  constructor(wsUrl: string, apiKey: string, assets: string[]) {
    super();
    this.wsUrl = wsUrl;
    this.apiKey = apiKey;
    this.assets = assets;
  }

  public start() {
    // Stork WS usually requires auth in the header or as a protocol
    this.ws = new WebSocket(this.wsUrl, {
      headers: { Authorization: `Basic ${this.apiKey}` }
    });

    this.ws.on("open", () => {
      this.emit("connected");
      this.subscribe(this.assets);
    });

    this.ws.on("message", (data: string) => {
      try {
        const raw = JSON.parse(data.toString());
        this.handleMessage(raw);
      } catch {
        /* ignore malformed JSON */
      }
    });

    this.ws.on("close", () => {
      this.emit("disconnected");
      setTimeout(() => this.start(), 3000);
    });
  }

  public subscribe(assets: string[]) {
    const assetMap = new Map<string, string>();
    for (const asset of this.assets) {
      assetMap.set(asset, asset);
    }
    for (const asset of assets) {
      if (assetMap.has(asset)) {
        continue;
      } else {
        this.assets.push(asset);
        assetMap.set(asset, asset);
      }
    }
    const subMsg = {
      type: "subscribe",
      data: Array.from(assetMap.keys())
    };
    this.ws?.send(JSON.stringify(subMsg));
  }

  private handleMessage(msg: any) {
    if (msg.type === "oracle_prices" && msg.data) {
      for (const [symbol, val] of Object.entries(msg.data) as [string, any][]) {
        const update = this.normalizePriceUpdate(symbol, val);
        if (update) this.emit("priceUpdate", update);
      }
      return;
    }

    if (msg.assetId != null && msg.price != null) {
      const update = this.normalizePriceUpdate(msg.assetId, msg);
      if (update) this.emit("priceUpdate", update);
    }
  }

  private normalizePriceUpdate(symbol: string, val: any): StorkPriceUpdate | null {
    const signed = val.stork_signed_price ?? val;
    if (!signed) return null;

    const ts = signed.timestamped_signature ?? signed;
    const price = signed.price ?? val.price;
    const timestamp = ts?.timestamp ?? signed.timestamp ?? val.timestamp;
    const sig = ts?.signature ?? signed.signature ?? val.signature ?? { r: "", s: "", v: "" };

    const publisherMerkleRoot =
      signed.publisher_merkle_root ?? signed.publisherMerkleRoot ?? val.publisherMerkleRoot ?? "";
    const calculationAlgHash =
      signed.calculation_alg?.checksum ??
      signed.calculationAlgHash ??
      val.calculationAlgHash ??
      "";

    return {
      assetId: symbol,
      encodedAssetId: signed.encoded_asset_id ?? signed.encodedAssetId ?? "",
      price: String(price ?? "0"),
      timestamp: String(timestamp ?? "0"),
      signature:
        typeof sig === "object"
          ? {
              r: String(sig.r ?? ""),
              s: String(sig.s ?? ""),
              v: String(sig.v ?? ""),
            }
          : { r: "", s: "", v: "" },
      publisherMerkleRoot,
      calculationAlgHash,
    };
  }
}


// const subscriberService = new StorkWSListener(
//   "wss://api.jp.stork-oracle.network/evm/subscribe",
//   "amFjb2ItdGV4YXNhbTphZGViMGU2Zi1jYmMyLTRjNTgtOWY2YS1hYWJhMWI1YTIwYjQ=",
//   ["BTCUSD"]
// );

// subscriberService.start();

// subscriberService.on('priceUpdate', (update: StorkPriceUpdate) => {
//   console.log(update);
// });

// await new Promise(resolve => setTimeout(resolve, 5000));

// subscriberService.subscribe([ "ETHUSD", "SOLUSD"]);