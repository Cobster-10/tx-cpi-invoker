#!/usr/bin/env npx tsx
/**
 * Decode an Order PDA account from localnet/devnet.
 * Usage: npx tsx scripts/decode-order-pda.ts [ORDER_PDA] [RPC_URL]
 * Example: npx tsx scripts/decode-order-pda.ts 2h6HCrriKgQMiZBhy93wSQhDJGx1RtazT9y75GHKpkFC http://127.0.0.1:8899
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { createHash } from "node:crypto";

const ORDER_DISCRIMINATOR = createHash("sha256")
  .update("account:Order")
  .digest()
  .subarray(0, 8);

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

function decodeOrder(data: Buffer): Record<string, unknown> | null {
  if (data.length < 8) return null;
  if (!data.subarray(0, 8).equals(ORDER_DISCRIMINATOR)) return null;

  try {
    const cursor = new BufferCursor(data.subarray(8));
    const user = cursor.readPubkey();
    const orderId = cursor.readU64();
    const inputAmount = cursor.readU64();
    const trigger = readTrigger(cursor);
    const action = readCpiAction(cursor);
    const createdSlot = cursor.readU64();
    const expiresFlag = cursor.readU8();
    const expiresSlot = expiresFlag === 1 ? cursor.readU64() : null;
    const executed = cursor.readBool();
    const canceled = cursor.readBool();
    const executionBounty = cursor.readU64();

    return {
      user: user.toBase58(),
      orderId: orderId.toString(),
      inputAmount: inputAmount.toString(),
      inputAmountSol: (Number(inputAmount) / 1e9).toFixed(9),
      trigger,
      action,
      createdSlot: createdSlot.toString(),
      expiresSlot: expiresSlot ? expiresSlot.toString() : null,
      executed,
      canceled,
      executionBounty: executionBounty.toString(),
      executionBountySol: (Number(executionBounty) / 1e9).toFixed(9),
    };
  } catch (e) {
    console.error("Decode error:", e);
    return null;
  }
}

function readTrigger(cursor: BufferCursor): Record<string, unknown> {
  const variant = cursor.readU8();
  switch (variant) {
    case 0:
      return { kind: "time_after", slot: cursor.readU64().toString() };
    case 1:
      return {
        kind: "pda_value_equals",
        account: cursor.readPubkey().toBase58(),
        expectedValue: cursor.readU64().toString(),
      };
    case 2:
      return {
        kind: "price_below_stork",
        feedId: cursor.readFixedBytes(32).toString("hex"),
        maxPriceQ: cursor.readI128().toString(),
        maxAgeSec: cursor.readU64().toString(),
      };
    case 3:
      return {
        kind: "price_above_stork",
        feedId: cursor.readFixedBytes(32).toString("hex"),
        minPriceQ: cursor.readI128().toString(),
        maxAgeSec: cursor.readU64().toString(),
      };
    case 4:
      return {
        kind: "stork_outcome_equals",
        feedId: cursor.readFixedBytes(32).toString("hex"),
        expectedOutcomeQ: cursor.readI128().toString(),
        maxAgeSec: cursor.readU64().toString(),
      };
    default:
      return { kind: "unknown", variant };
  }
}

function readCpiAction(cursor: BufferCursor): Record<string, unknown> {
  const programId = cursor.readPubkey();
  const accountCount = cursor.readU32();
  const accounts = Array.from({ length: accountCount }, () => ({
    pubkey: cursor.readPubkey().toBase58(),
    isWritable: cursor.readBool(),
  }));
  const dataLen = cursor.readU32();
  const ixData = cursor.readFixedBytes(dataLen);

  return {
    programId: programId.toBase58(),
    accounts,
    dataLength: dataLen,
    dataHex: ixData.toString("hex"),
  };
}

async function main() {
  const orderPda = process.argv[2] ?? "2h6HCrriKgQMiZBhy93wSQhDJGx1RtazT9y75GHKpkFC";
  const rpcUrl = process.argv[3] ?? "http://127.0.0.1:8899";

  const connection = new Connection(rpcUrl);
  const pubkey = new PublicKey(orderPda);

  console.log(`Fetching account ${orderPda} from ${rpcUrl}...\n`);

  const accountInfo = await connection.getAccountInfo(pubkey);
  if (!accountInfo) {
    console.error("Account not found. Is localnet running? Does the PDA exist?");
    process.exit(1);
  }

  console.log("Account info:");
  console.log("  Owner:", accountInfo.owner.toBase58());
  console.log("  Lamports:", accountInfo.lamports.toString());
  console.log("  Data length:", accountInfo.data.length);
  console.log("");

  const decoded = decodeOrder(accountInfo.data);
  if (!decoded) {
    console.error("Failed to decode as Order account. Wrong discriminator or malformed data.");
    process.exit(1);
  }

  console.log("Decoded Order PDA:");
  console.log(JSON.stringify(decoded, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
