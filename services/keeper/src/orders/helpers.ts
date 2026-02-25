import { PublicKey } from "@solana/web3.js";
import type { OrderEnvelope } from "./types.js";

export const STORK_FEED_SEED = "stork_feed";
export const STORK_PROGRAM_ID = new PublicKey(
  "stork1JUZMKYgjNagHiK2KdMmb42iTnYe9bYUCDUk8n",
);

export const bytesToHex = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("hex");

export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

export function extractStorkFeedIds(orders: OrderEnvelope[]): Uint8Array[] {
  const seen = new Set<string>();
  const result: Uint8Array[] = [];
  for (const order of orders) {
    const t = order.trigger;
    if (
      t.kind !== "price_below_stork" &&
      t.kind !== "price_above_stork" &&
      t.kind !== "stork_outcome_equals"
    ) {
      continue;
    }
    const hex = bytesToHex(t.feedId);
    if (seen.has(hex)) continue;
    seen.add(hex);
    result.push(t.feedId);
  }
  return result;
}

export const hexToBytes = (hex: string): Uint8Array => {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  return new Uint8Array(Buffer.from(normalized, "hex"));
};

export const deriveStorkFeedPda = (feedId: Uint8Array): PublicKey => {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(STORK_FEED_SEED, "utf8"), Buffer.from(feedId)],
    STORK_PROGRAM_ID,
  );
  return pda;
};
