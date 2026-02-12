import dotenv from "dotenv";

dotenv.config({ path: process.env.KEEPER_ENV_PATH });

export type KeeperConfig = {
  rpcHttpUrl: string;
  rpcWsUrl: string;
  vaultProgramId: string;
  keeperKeypairPath: string;
  pollIntervalMs: number;
  maxConcurrency: number;
  commitment: "processed" | "confirmed" | "finalized";
  storkApiKey: string;
  storkWsUrl: string;
  storkHttpUrl: string;
  sqlitePath: string;
  storkFeedAllowlist: string[];
  dryRun: boolean;
};

const numberEnv = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const boolEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (!value) return fallback;
  return value.toLowerCase() === "true";
};

export const loadConfig = (): KeeperConfig => ({
  rpcHttpUrl: process.env.RPC_HTTP_URL ?? "https://api.devnet.solana.com",
  rpcWsUrl: process.env.RPC_WS_URL ?? "wss://api.devnet.solana.com",
  vaultProgramId:
    process.env.VAULT_PROGRAM_ID ?? "HTGredcpihEqbJL9a3JBof4JQkgU5EdovAFt7xcPR2mg",
  keeperKeypairPath: process.env.KEEPER_KEYPAIR_PATH ?? "~/.config/solana/id.json",
  pollIntervalMs: numberEnv(process.env.POLL_INTERVAL_MS, 2000),
  maxConcurrency: Math.max(1, numberEnv(process.env.MAX_CONCURRENCY, 4)),
  commitment:
    (process.env.COMMITMENT as KeeperConfig["commitment"] | undefined) ??
    "confirmed",
  storkApiKey: process.env.STORK_API_KEY ?? "",
  storkWsUrl: process.env.STORK_WS_URL ?? "",
  storkHttpUrl: process.env.STORK_HTTP_URL ?? "",
  sqlitePath: process.env.SQLITE_PATH ?? "./keeper.db",
  storkFeedAllowlist: (process.env.STORK_FEED_ALLOWLIST ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  dryRun: boolEnv(process.env.DRY_RUN, true),
});
