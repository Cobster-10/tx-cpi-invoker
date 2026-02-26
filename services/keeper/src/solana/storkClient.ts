import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import type { StorkPushPayload } from "../orders/types.js";
import storkIdl from "./stork.json" with { type: "json" };

type StorkIdl = typeof storkIdl;

const STORK_PROGRAM_ID = new PublicKey(
  (storkIdl as StorkIdl).address,
);

function getUpdateTemporalNumericValueEvmInstruction() {
  const ix = (storkIdl as StorkIdl).instructions.find(
    (i) => i.name === "update_temporal_numeric_value_evm",
  );
  if (!ix) throw new Error("update_temporal_numeric_value_evm not found in IDL");
  return ix;
}

/** Decode IDL const seed (array of byte values) to Buffer. */
function idlConstToBuffer(value: number[]): Buffer {
  return Buffer.from(value);
}

/** Resolve PDA seeds from IDL; arg path "update_data.id.0" maps to feedId. */
function resolveFeedSeeds(
  seeds: { kind: string; value?: number[]; path?: string }[],
  feedId: Uint8Array,
): Buffer[] {
  const result: Buffer[] = [];
  for (const seed of seeds) {
    if (seed.kind === "const" && seed.value) {
      result.push(idlConstToBuffer(seed.value));
    } else if (seed.kind === "arg" && seed.path === "update_data.id.0") {
      result.push(Buffer.from(feedId));
    }
  }
  return result;
}

function deriveStorkConfigPda(): PublicKey {
  const ix = getUpdateTemporalNumericValueEvmInstruction();
  const configAccount = ix.accounts?.find((a) => a.name === "config");
  const seeds = (configAccount as { pda?: { seeds: { kind: string; value?: number[] }[] } })
    ?.pda?.seeds;
  if (!seeds || seeds.length === 0) {
    throw new Error("config PDA seeds not found in IDL");
  }
  const seedBuffers = seeds.map((s) => idlConstToBuffer(s.value!));
  const [pda] = PublicKey.findProgramAddressSync(seedBuffers, STORK_PROGRAM_ID);
  return pda;
}

/**
 * Treasury PDA: seeds from contract source (not in IDL).
 * Stork uses [STORK_TREASURY_SEED, treasury_id].
 */
function deriveStorkTreasuryPda(treasuryId: number): PublicKey {
  const STORK_TREASURY_SEED = Buffer.from("stork_treasury", "utf8");
  const [pda] = PublicKey.findProgramAddressSync(
    [STORK_TREASURY_SEED, Buffer.from([treasuryId])],
    STORK_PROGRAM_ID,
  );
  return pda;
}

function deriveStorkFeedPda(feedId: Uint8Array): PublicKey {
  const ix = getUpdateTemporalNumericValueEvmInstruction();
  const feedAccount = ix.accounts?.find((a) => a.name === "feed");
  const seeds = (feedAccount as { pda?: { seeds: { kind: string; value?: number[]; path?: string }[] } })
    ?.pda?.seeds;
  if (!seeds || seeds.length < 2) {
    throw new Error("feed PDA seeds not found in IDL");
  }
  const seedBuffers = resolveFeedSeeds(seeds, feedId);
  const [pda] = PublicKey.findProgramAddressSync(seedBuffers, STORK_PROGRAM_ID);
  return pda;
}

/** Discriminator from IDL. */
function getDiscriminator(): Buffer {
  const ix = getUpdateTemporalNumericValueEvmInstruction();
  const disc = (ix as { discriminator?: number[] }).discriminator;
  if (!disc || disc.length !== 8) {
    throw new Error("discriminator not found in IDL");
  }
  return Buffer.from(disc);
}

/**
 * Encode i128 as little-endian bytes (16 bytes).
 * IDL type: i128 in TemporalNumericValue.quantized_value.
 */
function encodeI128(value: bigint): Buffer {
  const buf = Buffer.alloc(16);
  const isNegative = value < 0n;
  const abs = isNegative ? -value : value;
  buf.writeBigUInt64LE(abs & 0xffffffffffffffffn, 0);
  buf.writeBigUInt64LE((abs >> 64n) & 0xffffffffffffffffn, 8);
  if (isNegative) {
    for (let i = 0; i < 16; i++) buf[i] = ~buf[i];
    let carry = 1;
    for (let i = 0; i < 16 && carry; i++) {
      const sum = buf[i] + carry;
      buf[i] = sum & 0xff;
      carry = sum >> 8;
    }
  }
  return buf;
}

/**
 * Encode TemporalNumericValueEvmInput per IDL types.
 * Layout: id[32] | temporal_numeric_value { timestamp_ns[8], quantized_value[16] } |
 *         publisher_merkle_root[32] | value_compute_alg_hash[32] | r[32] | s[32] | v[1] | treasury_id[1]
 */
function encodeTemporalNumericValueEvmInput(payload: StorkPushPayload): Buffer {
  const id = Buffer.from(payload.feedId);
  if (id.length !== 32) throw new Error("feedId must be 32 bytes");

  const timestampNs = Buffer.alloc(8);
  timestampNs.writeBigUInt64LE(payload.timestampNs);

  const quantizedValue = encodeI128(payload.quantizedValue);

  const publisherMerkleRoot = Buffer.from(payload.publisherMerkleRoot);
  if (publisherMerkleRoot.length !== 32) {
    throw new Error("publisherMerkleRoot must be 32 bytes");
  }

  const valueComputeAlgHash = Buffer.from(payload.valueComputeAlgHash);
  if (valueComputeAlgHash.length !== 32) {
    throw new Error("valueComputeAlgHash must be 32 bytes");
  }

  const r = Buffer.from(payload.signatureR);
  const s = Buffer.from(payload.signatureS);
  if (r.length !== 32 || s.length !== 32) {
    throw new Error("signature r and s must be 32 bytes each");
  }

  return Buffer.concat([
    id,
    timestampNs,
    quantizedValue,
    publisherMerkleRoot,
    valueComputeAlgHash,
    r,
    s,
    Buffer.from([payload.signatureV, payload.treasuryId]),
  ]);
}

export type BuildStorkUpdateInstructionInput = {
  payload: StorkPushPayload;
  payer: PublicKey;
};

/**
 * Build the Stork update_temporal_numeric_value_evm instruction.
 * Uses stork.json IDL for program ID, discriminator, and account PDAs.
 * The payer (keeper) pays the update fee and signs the transaction.
 */
export function buildStorkUpdateInstruction(
  input: BuildStorkUpdateInstructionInput,
): TransactionInstruction {
  const config = deriveStorkConfigPda();
  const treasury = deriveStorkTreasuryPda(input.payload.treasuryId);
  const feed = deriveStorkFeedPda(input.payload.feedId);

  const data = Buffer.concat([
    getDiscriminator(),
    encodeTemporalNumericValueEvmInput(input.payload),
  ]);

  return new TransactionInstruction({
    programId: STORK_PROGRAM_ID,
    keys: [
      { pubkey: config, isWritable: false, isSigner: false },
      { pubkey: treasury, isWritable: true, isSigner: false },
      { pubkey: feed, isWritable: true, isSigner: false },
      { pubkey: input.payer, isWritable: true, isSigner: true },
      { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
    ],
    data,
  });
}
