import { PublicKey } from "@solana/web3.js";

export type KeeperRoute = "base" | "stork_price" | "stork_outcome";

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

export type FeedSnapshot = {
  feedId: Uint8Array;
  quantizedValue: bigint;
  timestampNs: bigint;
  signedUpdatePayload?: SignedUpdatePayload;
};

export type ExecutionCandidate = {
  orderPubkey: PublicKey;
  route: KeeperRoute;
  reason: string;
  feedId?: Uint8Array;
};

export type ExecutionResult = {
  signature: string;
  slot: number;
  status: "confirmed" | "failed" | "simulated";
  errorCode?: string;
};
