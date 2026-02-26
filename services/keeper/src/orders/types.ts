import { PublicKey } from "@solana/web3.js";

export type KeeperRoute = "base" | "stork";

/**
 * Payload needed to build the Stork update_temporal_numeric_value_evm instruction.
 * Passed from priceUpdateToSnapshot through FeedSnapshot → ExecutionCandidate → TxBuilder.
 */
export type StorkPushPayload = {
  feedId: Uint8Array;
  quantizedValue: bigint;
  timestampNs: bigint;
  publisherMerkleRoot: Uint8Array;
  valueComputeAlgHash: Uint8Array;
  signatureR: Uint8Array;
  signatureS: Uint8Array;
  signatureV: number;
  treasuryId: number;
};

export type Trigger =
  | { kind: "time_after"; slot: bigint }
  | { kind: "pda_value_equals"; account: PublicKey; expectedValue: bigint }
  | {
      kind: "price_below_stork";
      feedId: Uint8Array;
      maxPriceQ: bigint;
      maxAgeSec: bigint;
    }
  | {
      kind: "price_above_stork";
      feedId: Uint8Array;
      minPriceQ: bigint;
      maxAgeSec: bigint;
    }
  | {
      kind: "stork_outcome_equals";
      feedId: Uint8Array;
      expectedOutcomeQ: bigint;
      maxAgeSec: bigint;
    };

export type CpiAction = {
  programId: PublicKey;
  accounts: Array<{ pubkey: PublicKey; isWritable: boolean }>;
  data: Buffer;
};

export type OrderEnvelope = {
  orderPubkey: PublicKey;
  vaultPubkey?: PublicKey;
  orderId: bigint;
  user: PublicKey;
  trigger: Trigger;
  action: CpiAction;
  expiresSlot: bigint | null;
  executed: boolean;
  canceled: boolean;
  executionBounty: bigint;
};

export type SignedUpdatePayload = {
  programId: PublicKey;
  accounts: Array<{ pubkey: PublicKey; isWritable: boolean; isSigner: boolean }>;
  data: Buffer;
};

export type ExecutionCandidate = {
  orderPubkey: PublicKey;
  route: KeeperRoute;
  reason: string;
  feedId?: Uint8Array;
  /** When present, the keeper should prepend the Stork update instruction before execute_order_if_ready_stork. */
  storkPushPayload?: StorkPushPayload;
};

export type ExecutionResult = {
  signature: string;
  slot: number;
  status: "confirmed" | "failed" | "simulated";
  errorCode?: string;
};

