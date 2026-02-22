import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { createHash } from "node:crypto";
import { CpiAction, KeeperRoute, OrderEnvelope, Trigger } from "../orders/types.js";

export type BuildExecuteInstructionInput = {
  route: KeeperRoute;
  order: OrderEnvelope;
  keeper: PublicKey;
  pdaAccount?: PublicKey;
  storkFeed?: PublicKey;
};

export type BuildCancelInstructionInput = {
  order: OrderEnvelope;
  user: PublicKey;
};

export type BuildCloseInstructionInput = {
  order: OrderEnvelope;
  user: PublicKey;
};

export type BuildSystemTransferActionInput = {
  user: PublicKey;
  orderId: bigint;
  recipient: PublicKey;
  lamports: bigint;
};

export class OrderExecutorClient {
  private static readonly ORDER_ACCOUNT_SIZE = 1748;
  private static readonly ORDER_DISCRIMINATOR = createHash("sha256")
    .update("account:Order")
    .digest()
    .subarray(0, 8);

  constructor(
    readonly connection: Connection,
    readonly programId: PublicKey,
  ) {}

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

  deriveOrderPda(user: PublicKey, orderId: bigint): [PublicKey, number] {
    const orderIdLe = Buffer.alloc(8);
    orderIdLe.writeBigUInt64LE(orderId);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("order"), user.toBuffer(), orderIdLe],
      this.programId,
    );
  }

  deriveVaultPda(user: PublicKey, orderId: bigint): [PublicKey, number] {
    const orderIdLe = Buffer.alloc(8);
    orderIdLe.writeBigUInt64LE(orderId);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), user.toBuffer(), orderIdLe],
      this.programId,
    );
  }

  buildSystemTransferAction(input: BuildSystemTransferActionInput): CpiAction {
    if (input.lamports > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("lamports exceeds Number.MAX_SAFE_INTEGER; split transfer amount");
    }

    const [vault] = this.deriveVaultPda(input.user, input.orderId);
    const transferIx = SystemProgram.transfer({
      fromPubkey: vault,
      toPubkey: input.recipient,
      lamports: Number(input.lamports),
    });

    return {
      programId: SystemProgram.programId,
      accounts: [
        { pubkey: vault, isWritable: true },
        { pubkey: input.recipient, isWritable: true },
      ],
      data: Buffer.from(transferIx.data),
    };
  }

  buildExecuteInstruction(input: BuildExecuteInstructionInput): TransactionInstruction {
    const [derivedVault] = this.deriveVaultPda(input.order.user, input.order.orderId);
    const vault = input.order.vaultPubkey ?? derivedVault;
    const pdaAccount = input.pdaAccount ?? this.defaultPdaAccountForTrigger(input.order.trigger);

    if (input.route === "stork" && !input.storkFeed) {
      throw new Error("storkFeed is required for stork execution route");
    }

    const data =
      input.route === "stork"
        ? this.encodeExecuteOrderIfReadyStorkData(input.order.trigger)
        : this.encodeInstructionDiscriminator("execute_order_if_ready");

    const baseKeys =
      input.route === "stork"
        ? [
            { pubkey: input.order.orderPubkey, isWritable: true, isSigner: false },
            { pubkey: vault, isWritable: true, isSigner: false },
            { pubkey: input.storkFeed!, isWritable: false, isSigner: false },
            { pubkey: input.order.user, isWritable: false, isSigner: false },
            { pubkey: input.keeper, isWritable: true, isSigner: true },
            { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
          ]
        : [
            { pubkey: input.order.orderPubkey, isWritable: true, isSigner: false },
            { pubkey: vault, isWritable: true, isSigner: false },
            { pubkey: input.order.user, isWritable: false, isSigner: false },
            { pubkey: input.keeper, isWritable: true, isSigner: true },
            { pubkey: pdaAccount, isWritable: false, isSigner: false },
            { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
          ];

    const cpiKeys = input.order.action.accounts.map((account) => ({
      pubkey: account.pubkey,
      isWritable: account.isWritable,
      isSigner: false,
    }));
    cpiKeys.push({
      pubkey: input.order.action.programId,
      isWritable: false,
      isSigner: false,
    });

    return new TransactionInstruction({
      programId: this.programId,
      keys: [...baseKeys, ...cpiKeys],
      data,
    });
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

    return new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: input.user, isWritable: true, isSigner: true },
        { pubkey: orderCounter, isWritable: true, isSigner: false },
        { pubkey: order, isWritable: true, isSigner: false },
        { pubkey: vault, isWritable: true, isSigner: false },
        { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
      ],
      data: Buffer.concat([
        this.encodeInstructionDiscriminator("close_order"),
        this.encodeU64(input.order.orderId),
      ]),
    });
  }

  private defaultPdaAccountForTrigger(trigger: Trigger): PublicKey {
    if (trigger.kind === "pda_value_equals") {
      return trigger.account;
    }
    // Optional account for non-PdaValueEquals triggers; keep deterministic.
    return SystemProgram.programId;
  }

  private encodeExecuteOrderIfReadyStorkData(trigger: Trigger): Buffer {
    if (
      trigger.kind !== "price_below_stork" &&
      trigger.kind !== "price_above_stork" &&
      trigger.kind !== "stork_outcome_equals"
    ) {
      throw new Error("stork route requires a stork trigger");
    }
    return this.encodeInstructionDiscriminator("execute_order_if_ready_stork");
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
      const action = this.readCpiAction(cursor);
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

  private readCpiAction(cursor: BufferCursor): CpiAction {
    const programId = cursor.readPubkey();
    const accountCount = cursor.readU32();
    const accounts = Array.from({ length: accountCount }, () => ({
      pubkey: cursor.readPubkey(),
      isWritable: cursor.readBool(),
    }));
    const dataLen = cursor.readU32();
    const ixData = cursor.readFixedBytes(dataLen);

    return {
      programId,
      accounts,
      data: Buffer.from(ixData),
    };
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
