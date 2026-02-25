import { Connection } from "@solana/web3.js";
import { ExecutionCandidate, OrderEnvelope, Trigger } from "../types.js";
import { IPollableEvaluator } from "./types.js";

export class TimeAfterEvaluator implements IPollableEvaluator {
  constructor(private readonly connection: Connection) {}

  supports(trigger: Trigger): boolean {
    return trigger.kind === "time_after";
  }

  async evaluate(order: OrderEnvelope): Promise<ExecutionCandidate | null> {
    const trigger = order.trigger;
    if (trigger.kind !== "time_after") return null;

    const slot = await this.connection.getSlot();
    if (BigInt(slot) >= trigger.slot) {
      return {
        orderPubkey: order.orderPubkey,
        route: "base",
        reason: `slot ${slot} >= ${trigger.slot}`,
      };
    }
    return null;
  }
}
