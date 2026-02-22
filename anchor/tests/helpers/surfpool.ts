import { Connection, PublicKey } from "@solana/web3.js";

type RpcResponse<T = unknown> = {
  error?: { code?: number; message?: string; [key: string]: unknown };
  result?: T;
};

export type SurfnetClock = {
  epoch: number;
  slot: number;
  timestamp: number | string;
};

export type SurfnetSetAccountInput = {
  pubkey: PublicKey;
  lamports?: number;
  data?: Buffer;
  owner?: PublicKey;
  executable?: boolean;
  rentEpoch?: number;
};

const SURFPOOL_INFO_METHODS = ["surfnet_getSurfnetInfos", "surfnet_getSurfnetInfo"] as const;

export async function hasSurfpoolCheatcodes(connection: Connection): Promise<boolean> {
  for (const method of SURFPOOL_INFO_METHODS) {
    try {
      const response = await rpcRequest(connection, method, []);
      if (!response?.error) return true;
    } catch {
      // Try the next known method name/version.
    }
  }
  return false;
}

export async function callSurfnetCheatcode<T = unknown>(
  connection: Connection,
  method: string,
  params: unknown[] = [],
): Promise<T> {
  const response = await rpcRequest<T>(connection, method, params);
  if (response?.error) {
    throw new Error(`Surfpool cheatcode ${method} failed: ${JSON.stringify(response.error)}`);
  }
  return response.result as T;
}

export async function getSurfnetClock(connection: Connection): Promise<SurfnetClock> {
  try {
    return await callSurfnetCheatcode<SurfnetClock>(connection, "surfnet_getClock", []);
  } catch (error) {
    if (!isMethodNotFound(error)) {
      throw error;
    }

    // Compatibility fallback for Surfpool builds that do not expose clock cheatcodes.
    const slot = await connection.getSlot();
    const [epochInfo, blockTime] = await Promise.all([
      connection.getEpochInfo().catch(() => null),
      connection.getBlockTime(slot).catch(() => null),
    ]);
    return {
      epoch: epochInfo?.epoch ?? 0,
      slot,
      timestamp: blockTime ?? Math.floor(Date.now() / 1000),
    };
  }
}

export async function getSurfnetUnixTimestampNs(connection: Connection): Promise<bigint> {
  const clock = await getSurfnetClock(connection);
  const timestampSec =
    typeof clock.timestamp === "string" ? BigInt(clock.timestamp) : BigInt(clock.timestamp);
  return timestampSec * 1_000_000_000n;
}

export async function advanceSurfnetClockSeconds(
  connection: Connection,
  seconds: number,
): Promise<void> {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`seconds must be positive, got ${seconds}`);
  }

  try {
    await callSurfnetCheatcode(connection, "surfnet_advanceClock", [{ seconds }]);
    return;
  } catch (advanceError) {
    if (!isMethodNotFound(advanceError)) {
      throw advanceError;
    }
    const clock = await getSurfnetClock(connection);
    const currentSec =
      typeof clock.timestamp === "string" ? Number(clock.timestamp) : Number(clock.timestamp);
    const targetSec = currentSec + Math.floor(seconds);
    try {
      await surfnetTimeTravelToTimestamp(connection, targetSec);
      return;
    } catch (travelError) {
      if (!isMethodNotFound(travelError) && !isInvalidTimeTravelParams(travelError)) {
        throw new Error(
          [
            "Failed to advance Surfpool clock using surfnet_advanceClock and surfnet_timeTravel",
            `advance error: ${errorText(advanceError)}`,
            `timeTravel error: ${errorText(travelError)}`,
          ].join("\n"),
        );
      }

      // Final compatibility fallback for Surfpool builds without clock manipulation cheatcodes.
      await sleep(Math.floor(seconds * 1000) + 250);
      return;
    }
  }
}

async function surfnetTimeTravelToTimestamp(connection: Connection, timestampSec: number): Promise<void> {
  const timestampMs = Math.floor(timestampSec * 1000);
  const attempts: Array<Record<string, number>> = [
    // Newer/older builds vary by field name and unit (sec vs ms).
    { timestamp: timestampSec },
    { timestamp: timestampMs },
    { absoluteTimestamp: timestampSec },
    { absoluteTimestamp: timestampMs },
  ];

  let lastError: unknown;
  for (const params of attempts) {
    try {
      await callSurfnetCheatcode(connection, "surfnet_timeTravel", [params]);
      return;
    } catch (error) {
      lastError = error;
      if (isMethodNotFound(error)) {
        throw error;
      }
      // Keep probing alternate field names / units for timeTravel compatibility.
    }
  }

  throw lastError instanceof Error ? lastError : new Error(errorText(lastError));
}

function isMethodNotFound(error: unknown): boolean {
  const text = errorText(error);
  return text.includes("Method not found") || text.includes("\"code\":-32601");
}

function isInvalidTimeTravelParams(error: unknown): boolean {
  const text = errorText(error);
  return text.includes("surfnet_timeTravel") && text.includes("Invalid params");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function surfnetSetAccount(
  connection: Connection,
  input: SurfnetSetAccountInput,
): Promise<void> {
  const dataBase64 = input.data?.toString("base64");
  const dataHex = input.data?.toString("hex");
  const owner = input.owner?.toBase58();
  const pubkey = input.pubkey.toBase58();

  const documentedPayload: Record<string, unknown> = {
    pubkey,
  };
  if (input.lamports !== undefined) documentedPayload.lamports = input.lamports;
  if (dataBase64 !== undefined) documentedPayload.data = dataBase64;
  if (owner !== undefined) documentedPayload.owner = owner;
  if (input.executable !== undefined) documentedPayload.executable = input.executable;
  // Kept for compatibility with versions that accept extra account fields.
  if (input.rentEpoch !== undefined) documentedPayload.rent_epoch = input.rentEpoch;

  try {
    await callSurfnetCheatcode(connection, "surfnet_setAccount", [documentedPayload]);
    return;
  } catch (documentedError) {
    // Fallback to the legacy positional format observed in this repo's Surfpool runtime.
    const legacyOptions: Record<string, unknown> = {};
    if (input.lamports !== undefined) legacyOptions.lamports = input.lamports;
    if (owner !== undefined) legacyOptions.owner = owner;
    if (input.executable !== undefined) legacyOptions.executable = input.executable;
    if (input.rentEpoch !== undefined) legacyOptions.rent_epoch = input.rentEpoch;
    if (dataHex !== undefined) legacyOptions.data = dataHex;

    try {
      await callSurfnetCheatcode(connection, "surfnet_setAccount", [pubkey, legacyOptions]);
      return;
    } catch (legacyError) {
      throw new Error(
        [
          "surfnet_setAccount failed for documented payload and legacy fallback",
          `documented payload error: ${errorText(documentedError)}`,
          `legacy payload error: ${errorText(legacyError)}`,
        ].join("\n"),
      );
    }
  }
}

async function rpcRequest<T>(
  connection: Connection,
  method: string,
  params: unknown[],
): Promise<RpcResponse<T>> {
  return (connection as any)._rpcRequest(method, params) as Promise<RpcResponse<T>>;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
