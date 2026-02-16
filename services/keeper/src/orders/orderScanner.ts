import { OrderExecutorClient } from "../solana/orderExecutorClient.js";
import { OrderEnvelope } from "./types.js";

export class OrderScanner {
  constructor(private readonly client: OrderExecutorClient) {}

  async scanOpenOrders(): Promise<OrderEnvelope[]> {
    return this.client.scanOpenOrders();
  }
}
