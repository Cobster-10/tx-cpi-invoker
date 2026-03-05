import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { KeeperConfig } from "../config.js";

export type SolanaContext = {
  connection: Connection;
  keeperKeypair: Keypair;
  programId: PublicKey;
};

export const createSolanaContext = (config: KeeperConfig): SolanaContext => {
  const connection = new Connection(config.rpcHttpUrl, config.commitment);

  const keypairData = JSON.parse(readFileSync(config.keeperKeypairPath, "utf8"));
  const secretKey = Array.isArray(keypairData)
    ? new Uint8Array(keypairData)
    : new Uint8Array(keypairData.secretKey);
  const keeperKeypair = Keypair.fromSecretKey(secretKey);

  return {
    connection,
    keeperKeypair,
    programId: new PublicKey(config.programId),
  };
};
