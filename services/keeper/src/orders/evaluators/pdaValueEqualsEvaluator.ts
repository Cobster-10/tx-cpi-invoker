import { Connection } from "@solana/web3.js";
import { ExecutionCandidate, OrderEnvelope, Trigger } from "../types.js";
import { IPollableEvaluator } from "./types.js";

export class PdaValueEqualsEvaluator implements IPollableEvaluator {
  constructor(private readonly connection: Connection) {}

  supports(trigger: Trigger): boolean {
    return trigger.kind === "pda_value_equals";
  }

  async evaluate(order: OrderEnvelope): Promise<ExecutionCandidate | null> {
    const trigger = order.trigger;
    if (trigger.kind !== "pda_value_equals") return null;

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
}
