import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { KeeperRoute, OrderEnvelope } from "../orders/types.js";

export type BuildExecuteInstructionInput = {
  route: KeeperRoute;
  order: OrderEnvelope;
  keeper: PublicKey;
  pdaAccount?: PublicKey;
  storkFeed?: PublicKey;
};

export class VaultClient {
  constructor(
    readonly connection: Connection,
    readonly programId: PublicKey,
  ) {}

  async scanOpenOrders(): Promise<OrderEnvelope[]> {
    // TODO: implement account scan + decode for Order PDAs.
    return [];
  }

  buildExecuteInstruction(_input: BuildExecuteInstructionInput): TransactionInstruction {
    // TODO: map route to execute_order_if_ready* instruction data + accounts.
    return new TransactionInstruction({
      programId: this.programId,
      keys: [{ pubkey: SystemProgram.programId, isWritable: false, isSigner: false }],
      data: Buffer.alloc(0),
    });
  }
}
