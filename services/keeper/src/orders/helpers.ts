import { PublicKey } from "@solana/web3.js";

export const STORK_FEED_SEED = "stork_feed";
export const STORK_PROGRAM_ID = new PublicKey(
  "stork1JUZMKYgjNagHiK2KdMmb42iTnYe9bYUCDUk8n",
);

export const bytesToHex = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("hex");

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
