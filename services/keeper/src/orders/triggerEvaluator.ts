import { Connection } from "@solana/web3.js";
import { ExecutionCandidate, OrderEnvelope } from "./types.js";

export class TriggerEvaluator {
  constructor(private readonly connection: Connection) {}

  async evaluate(order: OrderEnvelope): Promise<ExecutionCandidate | null> {
    const trigger = order.trigger;

    switch (trigger.kind) {
      case "time_after": {
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

      case "pda_value_equals": {
        const accountInfo = await this.connection.getAccountInfo(trigger.account);
        if (!accountInfo || accountInfo.data.length < 8) return null;

        const value = accountInfo.data.readBigUInt64LE(0);
        if (value === trigger.expectedValue) {
          return {
            orderPubkey: order.orderPubkey,
            route: "base",
            reason: `PDA value matches ${trigger.expectedValue}`,
          };
        }
        return null;
      }

      case "price_below_stork":
      case "stork_outcome_equals":
        // Stork triggers require the invocation server (not yet implemented).
        // Return null to skip for now; will be handled when Stork support is added.
        return null;

      default:
        return null;
    }
  }
}
