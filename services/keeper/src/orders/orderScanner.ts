import { VaultClient } from "../solana/vaultClient.js";
import { OrderEnvelope } from "./types.js";

export class OrderScanner {
  constructor(private readonly vaultClient: VaultClient) {}

  async scanOpenOrders(): Promise<OrderEnvelope[]> {
    // TODO: fetch program accounts and decode OrderEnvelope objects.
    return this.vaultClient.scanOpenOrders();
  }
}
