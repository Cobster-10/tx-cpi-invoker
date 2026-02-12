import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { KeeperConfig } from "../config.js";

export type SolanaContext = {
  connection: Connection;
  keeperKeypair: Keypair;
  vaultProgramId: PublicKey;
};

export const createSolanaContext = (config: KeeperConfig): SolanaContext => {
  const connection = new Connection(config.rpcHttpUrl, config.commitment);

  // Scaffold default: generated keypair. Replace with file loading in implementation step.
  const keeperKeypair = Keypair.generate();

  return {
    connection,
    keeperKeypair,
    vaultProgramId: new PublicKey(config.vaultProgramId),
  };
};
