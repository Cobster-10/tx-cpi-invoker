import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
import { createHash } from "node:crypto";
import { OrderEnvelope, Trigger } from "../orders/types.js";

export type SwapInstruction = {
  programId: PublicKey;
  accounts: Array<{ pubkey: PublicKey; isWritable: boolean }>;
  data: Buffer;
};

export type BuildExecuteOrderIfReadyInput = {
  order: OrderEnvelope;
  keeper: PublicKey;
  pdaAccount?: PublicKey;
  swapInstruction?: SwapInstruction;
};

export type BuildExecuteOrderIfReadyStorkInput = {
  order: OrderEnvelope;
  keeper: PublicKey;
  storkFeed: PublicKey;
  swapInstruction?: SwapInstruction;
};

export type BuildCancelInstructionInput = {
  order: OrderEnvelope;
  user: PublicKey;
};

export type TokenAccountPair = {
  vaultTokenAccount: PublicKey;
  userTokenAccount: PublicKey;
};

export type BuildCloseInstructionInput = {
  order: OrderEnvelope;
  user: PublicKey;
  /** Optional pairs of (vault_token_account, user_token_account) for token drain on close */
  tokenAccountPairs?: TokenAccountPair[];
};

export type BuildSystemTransferActionInput = {
  user: PublicKey;
  orderId: bigint;
  recipient: PublicKey;
  lamports: bigint;
};

export class OrderExecutorClient {
  private static readonly ORDER_ACCOUNT_SIZE = 1749;
  private static readonly ORDER_DISCRIMINATOR = createHash("sha256")
    .update("account:Order")
    .digest()
    .subarray(0, 8);

  constructor(
    readonly connection: Connection,
    readonly programId: PublicKey,
  ) {}

  // This function is used in main loop to scan for open orders
  async scanOpenOrders(): Promise<OrderEnvelope[]> {
    const accounts = await this.connection.getProgramAccounts(this.programId, {
      filters: [{ dataSize: OrderExecutorClient.ORDER_ACCOUNT_SIZE }],
    });

    const openOrders: OrderEnvelope[] = [];
    for (const account of accounts) {
      const order = this.decodeOrderAccount(account.pubkey, account.account.data);
      if (!order) continue;
      if (order.executed || order.canceled) continue;
      openOrders.push(order);
    }
    return openOrders;
  }

  // This function is used to derive the order PDA address from the user and order ID
  deriveOrderPda(user: PublicKey, orderId: bigint): [PublicKey, number] {
    const orderIdLe = Buffer.alloc(8);
    orderIdLe.writeBigUInt64LE(orderId);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("order"), user.toBuffer(), orderIdLe],
      this.programId,
    );
  }

  // This function is used to derive the vault PDA address from the user and order ID
  deriveVaultPda(user: PublicKey, orderId: bigint): [PublicKey, number] {
    const orderIdLe = Buffer.alloc(8);
    orderIdLe.writeBigUInt64LE(orderId);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), user.toBuffer(), orderIdLe],
      this.programId,
    );
  }


  buildExecuteOrderIfReadyInstruction(
    input: BuildExecuteOrderIfReadyInput,
  ): TransactionInstruction {
    const [derivedVault] = this.deriveVaultPda(input.order.user, input.order.orderId);
    const vault = input.order.vaultPubkey ?? derivedVault;
    const pdaAccount = input.pdaAccount ?? this.defaultPdaAccountForTrigger(input.order.trigger);

    const baseKeys = [
      { pubkey: input.order.orderPubkey, isWritable: true, isSigner: false },
      { pubkey: vault, isWritable: true, isSigner: false },
      { pubkey: input.order.user, isWritable: false, isSigner: false },
      { pubkey: input.keeper, isWritable: true, isSigner: true },
      { pubkey: pdaAccount, isWritable: false, isSigner: false },
      { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
      { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
    ];

    const data = Buffer.concat([
      this.encodeInstructionDiscriminator("execute_order_if_ready"),
      this.encodeOptionVecU8(input.swapInstruction?.data),
    ]);

    return this.buildExecuteInstructionWithKeys(
      input.order,
      baseKeys,
      data,
      input.swapInstruction,
    );
  }

  buildExecuteOrderIfReadyStorkInstruction(
    input: BuildExecuteOrderIfReadyStorkInput,
  ): TransactionInstruction {
    const [derivedVault] = this.deriveVaultPda(input.order.user, input.order.orderId);
    const vault = input.order.vaultPubkey ?? derivedVault;

    this.validateStorkTrigger(input.order.trigger);

    const baseKeys = [
      { pubkey: input.order.orderPubkey, isWritable: true, isSigner: false },
      { pubkey: vault, isWritable: true, isSigner: false },
      { pubkey: input.storkFeed, isWritable: false, isSigner: false },
      { pubkey: input.order.user, isWritable: false, isSigner: false },
      { pubkey: input.keeper, isWritable: true, isSigner: true },
      { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
      { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
    ];

    const data = Buffer.concat([
      this.encodeInstructionDiscriminator("execute_order_if_ready_stork"),
      this.encodeOptionVecU8(input.swapInstruction?.data),
    ]);

    return this.buildExecuteInstructionWithKeys(
      input.order,
      baseKeys,
      data,
      input.swapInstruction,
    );
  }

  private buildExecuteInstructionWithKeys(
    order: OrderEnvelope,
    baseKeys: { pubkey: PublicKey; isWritable: boolean; isSigner: boolean }[],
    data: Buffer,
    swapInstruction?: SwapInstruction,
  ): TransactionInstruction {
    let cpiKeys: { pubkey: PublicKey; isWritable: boolean; isSigner: boolean }[];

    if (swapInstruction) {
      cpiKeys = swapInstruction.accounts.map((account) => ({
        pubkey: account.pubkey,
        isWritable: account.isWritable,
        isSigner: false,
      }));
      cpiKeys.push({
        pubkey: swapInstruction.programId,
        isWritable: false,
        isSigner: false,
      });
    } else {
      const action = order.action;
      if (action.kind !== "cpi") {
        throw new Error("swapInstruction required for SwapIntent orders");
      }
      cpiKeys = action.action.accounts.map((account) => ({
        pubkey: account.pubkey,
        isWritable: account.isWritable,
        isSigner: false,
      }));
      cpiKeys.push({
        pubkey: action.action.programId,
        isWritable: false,
        isSigner: false,
      });
    }

    return new TransactionInstruction({
      programId: this.programId,
      keys: [...baseKeys, ...cpiKeys],
      data,
    });
  }

  private encodeOptionVecU8(value: Buffer | undefined): Buffer {
    if (value === undefined) {
      return Buffer.from([0]);
    }
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(value.length);
    return Buffer.concat([Buffer.from([1]), lenBuf, value]);
  }

  private validateStorkTrigger(trigger: Trigger): void {
    if (
      trigger.kind !== "price_below_stork" &&
      trigger.kind !== "price_above_stork" &&
      trigger.kind !== "stork_outcome_equals"
    ) {
      throw new Error("stork route requires a stork trigger");
    }
  }

  buildCancelInstruction(input: BuildCancelInstructionInput): TransactionInstruction {
    const [vault] = this.deriveVaultPda(input.order.user, input.order.orderId);
    const [order] = this.deriveOrderPda(input.order.user, input.order.orderId);

    return new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: input.user, isWritable: true, isSigner: true },
        { pubkey: order, isWritable: true, isSigner: false },
        { pubkey: vault, isWritable: true, isSigner: false },
        { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
      ],
      data: Buffer.concat([
        this.encodeInstructionDiscriminator("cancel_order"),
        this.encodeU64(input.order.orderId),
      ]),
    });
  }

  buildCloseInstruction(input: BuildCloseInstructionInput): TransactionInstruction {
    const [vault] = this.deriveVaultPda(input.order.user, input.order.orderId);
    const [order] = this.deriveOrderPda(input.order.user, input.order.orderId);
    const [orderCounter] = PublicKey.findProgramAddressSync(
      [Buffer.from("order_counter"), input.user.toBuffer()],
      this.programId,
    );

    const keys = [
      { pubkey: input.user, isWritable: true, isSigner: true },
      { pubkey: orderCounter, isWritable: true, isSigner: false },
      { pubkey: order, isWritable: true, isSigner: false },
      { pubkey: vault, isWritable: true, isSigner: false },
      { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
      { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
    ];

    if (input.tokenAccountPairs?.length) {
      for (const pair of input.tokenAccountPairs) {
        keys.push(
          { pubkey: pair.vaultTokenAccount, isWritable: true, isSigner: false },
          { pubkey: pair.userTokenAccount, isWritable: true, isSigner: false },
        );
      }
    }

    return new TransactionInstruction({
      programId: this.programId,
      keys,
      data: Buffer.concat([
        this.encodeInstructionDiscriminator("close_order"),
        this.encodeU64(input.order.orderId),
      ]),
    });
  }

  // HELPER FUNCTIONS
  
  private defaultPdaAccountForTrigger(trigger: Trigger): PublicKey {
    if (trigger.kind === "pda_value_equals") {
      return trigger.account;
    }
    // Optional account for non-PdaValueEquals triggers; keep deterministic.
    return SystemProgram.programId;
  }

  private encodeInstructionDiscriminator(ixName: string): Buffer {
    const hash = createHash("sha256")
      .update(`global:${ixName}`)
      .digest();
    return hash.subarray(0, 8);
  }

  private encodeU64(value: bigint): Buffer {
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64LE(value);
    return buffer;
  }

  private decodeOrderAccount(orderPubkey: PublicKey, data: Buffer): OrderEnvelope | null {
    if (data.length < 8) return null;
    if (!data.subarray(0, 8).equals(OrderExecutorClient.ORDER_DISCRIMINATOR)) return null;

    try {
      const cursor = new BufferCursor(data.subarray(8));
      const user = cursor.readPubkey();
      const orderId = cursor.readU64();
      cursor.readU64(); // input_amount (unused by keeper)
      const trigger = this.readTrigger(cursor);
      const action = this.readOrderAction(cursor);
      cursor.readU64(); // created_slot (unused by keeper)
      const expiresFlag = cursor.readU8();
      const expiresSlot = expiresFlag === 1 ? cursor.readU64() : null;
      const executed = cursor.readBool();
      const canceled = cursor.readBool();
      const executionBounty = cursor.readU64();

      const [vaultPubkey] = this.deriveVaultPda(user, orderId);
      return {
        orderPubkey,
        vaultPubkey,
        orderId,
        user,
        trigger,
        action,
        expiresSlot,
        executed,
        canceled,
        executionBounty,
      };
    } catch {
      return null;
    }
  }

  private readTrigger(cursor: BufferCursor): Trigger {
    const variant = cursor.readU8();
    switch (variant) {
      case 0:
        return { kind: "time_after", slot: cursor.readU64() };
      case 1:
        return {
          kind: "pda_value_equals",
          account: cursor.readPubkey(),
          expectedValue: cursor.readU64(),
        };
      case 2:
        return {
          kind: "price_below_stork",
          feedId: cursor.readFixedBytes(32),
          maxPriceQ: cursor.readI128(),
          maxAgeSec: cursor.readU64(),
        };
      case 3:
        return {
          kind: "price_above_stork",
          feedId: cursor.readFixedBytes(32),
          minPriceQ: cursor.readI128(),
          maxAgeSec: cursor.readU64(),
        };
      case 4:
        return {
          kind: "stork_outcome_equals",
          feedId: cursor.readFixedBytes(32),
          expectedOutcomeQ: cursor.readI128(),
          maxAgeSec: cursor.readU64(),
        };
      default:
        throw new Error(`unknown trigger variant: ${variant}`);
    }
  }

  private readOrderAction(cursor: BufferCursor): OrderEnvelope["action"] {
    const variant = cursor.readU8();
    if (variant === 0) {
      const programId = cursor.readPubkey();
      const accountCount = cursor.readU32();
      const accounts = Array.from({ length: accountCount }, () => ({
        pubkey: cursor.readPubkey(),
        isWritable: cursor.readBool(),
      }));
      const dataLen = cursor.readU32();
      const ixData = cursor.readFixedBytes(dataLen);
      return {
        kind: "cpi",
        action: {
          programId,
          accounts,
          data: Buffer.from(ixData),
        },
      };
    }
    if (variant === 1) {
      const swapProgram = cursor.readPubkey();
      const inputMint = cursor.readPubkey();
      const outputMint = cursor.readPubkey();
      const inputAmount = cursor.readU64();
      const maxSlippageBps = cursor.readU16();
      return {
        kind: "swapIntent",
        intent: {
          swapProgram,
          inputMint,
          outputMint,
          inputAmount,
          maxSlippageBps,
        },
      };
    }
    throw new Error(`unknown OrderAction variant: ${variant}`);
  }
}

class BufferCursor {
  private offset = 0;

  constructor(private readonly buffer: Buffer) {}

  readU8(): number {
    this.ensure(1);
    const value = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  readBool(): boolean {
    return this.readU8() === 1;
  }

  readU16(): number {
    this.ensure(2);
    const value = this.buffer.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  readU32(): number {
    this.ensure(4);
    const value = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  readU64(): bigint {
    this.ensure(8);
    const value = this.buffer.readBigUInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  readI128(): bigint {
    const bytes = this.readFixedBytes(16);
    const lo = bytes.readBigUInt64LE(0);
    const hi = bytes.readBigUInt64LE(8);
    const combined = (hi << 64n) | lo;
    const signBit = 1n << 127n;
    return (combined & signBit) !== 0n ? combined - (1n << 128n) : combined;
  }

  readPubkey(): PublicKey {
    return new PublicKey(this.readFixedBytes(32));
  }

  readFixedBytes(len: number): Buffer {
    this.ensure(len);
    const value = this.buffer.subarray(this.offset, this.offset + len);
    this.offset += len;
    return value;
  }

  private ensure(len: number): void {
    if (this.offset + len > this.buffer.length) {
      throw new Error("buffer underflow");
    }
  }
}
