import dotenv from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
dotenv.config({
  path: process.env.KEEPER_ENV_PATH ?? resolve(__dirname, "../.env"),
});

export type KeeperConfig = {
  rpcHttpUrl: string;
  rpcWsUrl: string;
  programId: string;
  keeperKeypairPath: string;
  pollIntervalMs: number;
  maxConcurrency: number;
  commitment: "processed" | "confirmed" | "finalized";
  sqlitePath: string;
  dryRun: boolean;
  // Stork fields are optional until the invocation server is implemented
  storkApiKey?: string;
  storkWsUrl?: string;
  storkHttpUrl?: string;
  storkFeedAllowlist?: string[];
  /** feed_id_hex -> asset_id mapping. JSON: {"<hex>":"BTCUSD",...} */
  storkFeedMap?: Record<string, string>;
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
  programId:
    process.env.PROGRAM_ID ?? "HTGredcpihEqbJL9a3JBof4JQkgU5EdovAFt7xcPR2mg",
  keeperKeypairPath: process.env.KEEPER_KEYPAIR_PATH ?? "~/.config/solana/id.json",
  pollIntervalMs: numberEnv(process.env.POLL_INTERVAL_MS, 2000),
  maxConcurrency: Math.max(1, numberEnv(process.env.MAX_CONCURRENCY, 4)),
  commitment:
    (process.env.COMMITMENT as KeeperConfig["commitment"] | undefined) ??
    "confirmed",
  sqlitePath: process.env.SQLITE_PATH ?? "./keeper.db",
  dryRun: boolEnv(process.env.DRY_RUN, true),
  storkApiKey: process.env.STORK_API_KEY || undefined,
  storkWsUrl: process.env.STORK_WS_URL || undefined,
  storkHttpUrl: process.env.STORK_HTTP_URL || undefined,
  storkFeedAllowlist: process.env.STORK_FEED_ALLOWLIST
    ? process.env.STORK_FEED_ALLOWLIST.split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : undefined,
  storkFeedMap: parseStorkFeedMap(process.env.STORK_FEED_MAP),
});

function parseStorkFeedMap(value: string | undefined): Record<string, string> | undefined {
  if (!value || value.trim() === "") return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof k === "string" && typeof v === "string") result[k] = v;
      }
      return Object.keys(result).length > 0 ? result : undefined;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}
