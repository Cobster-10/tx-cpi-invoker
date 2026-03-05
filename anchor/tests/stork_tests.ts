import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { createHash } from "crypto";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  advanceSurfnetClockSeconds,
  getSurfnetUnixTimestampNs,
  hasSurfpoolCheatcodes,
  surfnetSetAccount,
} from "./helpers/surfpool";

const idlPath = path.join(process.cwd(), "target/idl/order_executor.json");
const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
const anchorTomlPath = path.join(process.cwd(), "Anchor.toml");

const STORK_PROGRAM_ID = new PublicKey("stork1JUZMKYgjNagHiK2KdMmb42iTnYe9bYUCDUk8n");
const STORK_FEED_SEED = Buffer.from("stork_feed", "utf8");
const ORDER_INPUT_LAMPORTS = 1_000_000_000n;
const TRANSFER_LAMPORTS = 50_000_000n;

type StorkTriggerKind = "below" | "above" | "outcome";

type CreateStorkOrderInput = {
  provider: anchor.AnchorProvider;
  program: Program;
  triggerKind: StorkTriggerKind;
  feedId: Buffer;
  thresholdQ: bigint;
  maxAgeSec: bigint;
};

type CreatedStorkOrder = {
  user: Keypair;
  recipient: Keypair;
  orderCounterPda: PublicKey;
  orderPda: PublicKey;
  vaultPda: PublicKey;
  storkFeedPda: PublicKey;
};

describe("order_executor (surfpool stork triggers)", function () {
  this.timeout(60_000);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const resolvedProgramId = resolveOrderExecutorProgramId(provider.connection.rpcEndpoint);
  const program = new Program({ ...idl, address: resolvedProgramId.toBase58() }, provider);

  let surfpoolAvailable = false;

  before(async function () {
    surfpoolAvailable = await hasSurfpoolCheatcodes(provider.connection);
    if (!surfpoolAvailable) {
      // Make skips obvious in CI/local runs instead of silently showing only "pending".
      // eslint-disable-next-line no-console
      console.warn(
        "Skipping Surfpool Stork tests: Surfpool cheatcode RPC methods were not detected at ANCHOR_PROVIDER_URL",
      );
      this.skip();
      return;
    }

    await airdropAndConfirm(provider, provider.wallet.publicKey, 5_000_000_000);
  });

  it("executes PriceBelowStork when feed value is below threshold", async () => {
    const feedId = Buffer.alloc(32, 0x11);
    const created = await createStorkOrder({
      provider,
      program,
      triggerKind: "below",
      feedId,
      thresholdQ: 600_000n,
      maxAgeSec: 3_600n,
    });

    const nowNs = await getSurfnetUnixTimestampNs(provider.connection);
    await seedStorkFeed(provider, created.storkFeedPda, feedId, {
      timestampNs: nowNs,
      quantizedValue: 550_000n,
    });

    await executeStorkOrder(provider, program, created, created.storkFeedPda);

    const orderAccount = await (program.account as any).order.fetch(created.orderPda);
    expect(orderAccount.executed).to.equal(true);

    const recipientAccount = await provider.connection.getAccountInfo(created.recipient.publicKey);
    expect(recipientAccount).to.not.equal(null);
    expect(BigInt(recipientAccount!.lamports)).to.equal(TRANSFER_LAMPORTS);
  });

  it("fails PriceBelowStork when feed value is above threshold", async () => {
    const feedId = Buffer.alloc(32, 0x12);
    const created = await createStorkOrder({
      provider,
      program,
      triggerKind: "below",
      feedId,
      thresholdQ: 500_000n,
      maxAgeSec: 3_600n,
    });

    const nowNs = await getSurfnetUnixTimestampNs(provider.connection);
    await seedStorkFeed(provider, created.storkFeedPda, feedId, {
      timestampNs: nowNs,
      quantizedValue: 800_000n,
    });

    await expectRpcFailure(
      () => executeStorkOrder(provider, program, created, created.storkFeedPda),
      "TriggerConditionNotMet",
    );
  });

  it("executes PriceAboveStork when feed value is above threshold", async () => {
    const feedId = Buffer.alloc(32, 0x13);
    const created = await createStorkOrder({
      provider,
      program,
      triggerKind: "above",
      feedId,
      thresholdQ: 700_000n,
      maxAgeSec: 3_600n,
    });

    const nowNs = await getSurfnetUnixTimestampNs(provider.connection);
    await seedStorkFeed(provider, created.storkFeedPda, feedId, {
      timestampNs: nowNs,
      quantizedValue: 750_000n,
    });

    await executeStorkOrder(provider, program, created, created.storkFeedPda);

    const orderAccount = await (program.account as any).order.fetch(created.orderPda);
    expect(orderAccount.executed).to.equal(true);
  });

  it("fails PriceAboveStork when feed value is below threshold", async () => {
    const feedId = Buffer.alloc(32, 0x14);
    const created = await createStorkOrder({
      provider,
      program,
      triggerKind: "above",
      feedId,
      thresholdQ: 700_000n,
      maxAgeSec: 3_600n,
    });

    const nowNs = await getSurfnetUnixTimestampNs(provider.connection);
    await seedStorkFeed(provider, created.storkFeedPda, feedId, {
      timestampNs: nowNs,
      quantizedValue: 650_000n,
    });

    await expectRpcFailure(
      () => executeStorkOrder(provider, program, created, created.storkFeedPda),
      "TriggerConditionNotMet",
    );
  });

  it("executes StorkOutcomeEquals for matching numeric outcome and fails on mismatch", async () => {
    const feedId = Buffer.alloc(32, 0x15);
    const createdSuccess = await createStorkOrder({
      provider,
      program,
      triggerKind: "outcome",
      feedId,
      thresholdQ: 1n,
      maxAgeSec: 3_600n,
    });

    const nowNs = await getSurfnetUnixTimestampNs(provider.connection);
    await seedStorkFeed(provider, createdSuccess.storkFeedPda, feedId, {
      timestampNs: nowNs,
      quantizedValue: 1n,
    });

    await executeStorkOrder(provider, program, createdSuccess, createdSuccess.storkFeedPda);

    const feedIdMismatch = Buffer.alloc(32, 0x16);
    const createdFail = await createStorkOrder({
      provider,
      program,
      triggerKind: "outcome",
      feedId: feedIdMismatch,
      thresholdQ: 1n,
      maxAgeSec: 3_600n,
    });
    await seedStorkFeed(provider, createdFail.storkFeedPda, feedIdMismatch, {
      timestampNs: nowNs,
      quantizedValue: 0n,
    });

    await expectRpcFailure(
      () => executeStorkOrder(provider, program, createdFail, createdFail.storkFeedPda),
      "TriggerConditionNotMet",
    );
  });

  it("fails when the Stork price is stale", async () => {
    const feedId = Buffer.alloc(32, 0x17);
    const created = await createStorkOrder({
      provider,
      program,
      triggerKind: "below",
      feedId,
      thresholdQ: 600_000n,
      maxAgeSec: 1n,
    });

    const nowNs = await getSurfnetUnixTimestampNs(provider.connection);
    await seedStorkFeed(provider, created.storkFeedPda, feedId, {
      timestampNs: nowNs,
      quantizedValue: 550_000n,
    });
    await advanceSurfnetClockSeconds(provider.connection, 5);

    await expectRpcFailure(
      () => executeStorkOrder(provider, program, created, created.storkFeedPda),
      "StaleOraclePrice",
    );
  });

  it("fails when provided stork feed account does not match the trigger feed id", async () => {
    const expectedFeedId = Buffer.alloc(32, 0x18);
    const wrongFeedId = Buffer.alloc(32, 0x19);

    const created = await createStorkOrder({
      provider,
      program,
      triggerKind: "below",
      feedId: expectedFeedId,
      thresholdQ: 600_000n,
      maxAgeSec: 3_600n,
    });

    const wrongFeedPda = deriveStorkFeedPda(wrongFeedId);
    const nowNs = await getSurfnetUnixTimestampNs(provider.connection);
    await seedStorkFeed(provider, created.storkFeedPda, expectedFeedId, {
      timestampNs: nowNs,
      quantizedValue: 550_000n,
    });
    await seedStorkFeed(provider, wrongFeedPda, wrongFeedId, {
      timestampNs: nowNs,
      quantizedValue: 550_000n,
    });

    await expectRpcFailure(
      () => executeStorkOrder(provider, program, created, wrongFeedPda),
      "InvalidOracleAccount",
    );
  });
});

async function airdropAndConfirm(
  provider: anchor.AnchorProvider,
  pubkey: PublicKey,
  lamports: number,
): Promise<void> {
  const latest = await provider.connection.getLatestBlockhash();
  const signature = await provider.connection.requestAirdrop(pubkey, lamports);
  await provider.connection.confirmTransaction({
    signature,
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  });
}

function deriveOrderCounterPda(programId: PublicKey, user: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("order_counter"), user.toBuffer()],
    programId,
  )[0];
}

function deriveOrderPda(programId: PublicKey, user: PublicKey, orderId: bigint): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("order"), user.toBuffer(), encodeU64Le(orderId)],
    programId,
  )[0];
}

function deriveVaultPda(programId: PublicKey, user: PublicKey, orderId: bigint): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), user.toBuffer(), encodeU64Le(orderId)],
    programId,
  )[0];
}

function deriveStorkFeedPda(feedId: Buffer): PublicKey {
  return PublicKey.findProgramAddressSync([STORK_FEED_SEED, feedId], STORK_PROGRAM_ID)[0];
}

async function createStorkOrder(input: CreateStorkOrderInput): Promise<CreatedStorkOrder> {
  const user = Keypair.generate();
  const recipient = Keypair.generate();
  const orderId = 0n;
  const orderCounterPda = deriveOrderCounterPda(input.program.programId, user.publicKey);
  const orderPda = deriveOrderPda(input.program.programId, user.publicKey, orderId);
  const vaultPda = deriveVaultPda(input.program.programId, user.publicKey, orderId);
  const storkFeedPda = deriveStorkFeedPda(input.feedId);

  await airdropAndConfirm(input.provider, user.publicKey, Number(3n * ORDER_INPUT_LAMPORTS));

  await input.program.methods
    .initUserCounter()
    .accounts({
      user: user.publicKey,
      orderCounter: orderCounterPda,
      systemProgram: SystemProgram.programId,
    })
    .signers([user])
    .rpc();

  const transferIx = SystemProgram.transfer({
    fromPubkey: vaultPda,
    toPubkey: recipient.publicKey,
    lamports: Number(TRANSFER_LAMPORTS),
  });

  const trigger =
    input.triggerKind === "below"
      ? {
          priceBelowStork: {
            feedId: Array.from(input.feedId),
            maxPriceQ: new BN(input.thresholdQ.toString()),
            maxAgeSec: new BN(input.maxAgeSec.toString()),
          },
        }
      : input.triggerKind === "above"
        ? {
            priceAboveStork: {
              feedId: Array.from(input.feedId),
              minPriceQ: new BN(input.thresholdQ.toString()),
              maxAgeSec: new BN(input.maxAgeSec.toString()),
            },
          }
        : {
            storkOutcomeEquals: {
              feedId: Array.from(input.feedId),
              expectedOutcomeQ: new BN(input.thresholdQ.toString()),
              maxAgeSec: new BN(input.maxAgeSec.toString()),
            },
          };

  const action = {
    cpi: {
      programId: SystemProgram.programId,
      accounts: [
        { pubkey: vaultPda, isWritable: true },
        { pubkey: recipient.publicKey, isWritable: true },
      ],
      data: Buffer.from(transferIx.data),
    },
  };

  await input.program.methods
    .createOrder(
      new BN(ORDER_INPUT_LAMPORTS.toString()),
      trigger,
      action,
      null,
      new BN(0),
    )
    .accounts({
      user: user.publicKey,
      orderCounter: orderCounterPda,
      order: orderPda,
      vault: vaultPda,
      systemProgram: SystemProgram.programId,
    })
    .signers([user])
    .rpc();

  return {
    user,
    recipient,
    orderCounterPda,
    orderPda,
    vaultPda,
    storkFeedPda,
  };
}

async function executeStorkOrder(
  provider: anchor.AnchorProvider,
  program: Program,
  created: CreatedStorkOrder,
  storkFeed: PublicKey,
): Promise<string> {
  return program.methods
    .executeOrderIfReadyStork(null)
    .accounts({
      order: created.orderPda,
      vault: created.vaultPda,
      storkFeed,
      user: created.user.publicKey,
      keeper: provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts([
      { pubkey: created.vaultPda, isWritable: true, isSigner: false },
      { pubkey: created.recipient.publicKey, isWritable: true, isSigner: false },
      { pubkey: SystemProgram.programId, isWritable: false, isSigner: false },
    ])
    .rpc();
}

async function seedStorkFeed(
  provider: anchor.AnchorProvider,
  storkFeedPda: PublicKey,
  feedId: Buffer,
  value: { timestampNs: bigint; quantizedValue: bigint },
): Promise<void> {
  const data = encodeTemporalNumericValueFeedAccount(feedId, value.timestampNs, value.quantizedValue);
  const lamports = await provider.connection.getMinimumBalanceForRentExemption(data.length);
  await surfnetSetAccount(provider.connection, {
    pubkey: storkFeedPda,
    lamports,
    owner: STORK_PROGRAM_ID,
    executable: false,
    rentEpoch: 0,
    data,
  });
}

function encodeTemporalNumericValueFeedAccount(
  feedId: Buffer,
  timestampNs: bigint,
  quantizedValue: bigint,
): Buffer {
  if (feedId.length !== 32) {
    throw new Error(`feedId must be 32 bytes, got ${feedId.length}`);
  }

  // Anchor discriminator + TemporalNumericValueFeed::LEN (112 bytes).
  const data = Buffer.alloc(8 + 112, 0);
  let offset = 0;

  accountDiscriminator("TemporalNumericValueFeed").copy(data, offset);
  offset += 8;

  feedId.copy(data, offset);
  offset += 32;

  encodeU64Le(timestampNs).copy(data, offset);
  offset += 8;

  encodeI128Le(quantizedValue).copy(data, offset);

  return data;
}

function accountDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
}

function encodeU64Le(value: bigint): Buffer {
  if (value < 0n || value > (1n << 64n) - 1n) {
    throw new Error(`u64 out of range: ${value}`);
  }
  const buffer = Buffer.alloc(8);
  let x = value;
  for (let i = 0; i < 8; i += 1) {
    buffer[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return buffer;
}

function encodeI128Le(value: bigint): Buffer {
  const min = -(1n << 127n);
  const max = (1n << 127n) - 1n;
  if (value < min || value > max) {
    throw new Error(`i128 out of range: ${value}`);
  }

  let x = value;
  if (x < 0n) {
    x = (1n << 128n) + x;
  }

  const buffer = Buffer.alloc(16);
  for (let i = 0; i < 16; i += 1) {
    buffer[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return buffer;
}

async function expectRpcFailure(run: () => Promise<unknown>, codeFragment: string): Promise<void> {
  try {
    await run();
    throw new Error(`Expected failure containing ${codeFragment}`);
  } catch (error) {
    const text = stringifyError(error);
    expect(text).to.include(codeFragment);
  }
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    const anyError = error as any;
    return [
      error.message,
      anyError?.error?.errorCode?.code,
      anyError?.logs ? JSON.stringify(anyError.logs) : undefined,
      safeJson(error),
    ]
      .filter(Boolean)
      .join("\n");
  }
  return safeJson(error);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function resolveOrderExecutorProgramId(rpcEndpoint: string): PublicKey {
  const anchorToml = fs.readFileSync(anchorTomlPath, "utf8");
  const targetSection = /127\.0\.0\.1|localhost/.test(rpcEndpoint) ? "localnet" : "devnet";
  const sectionMatch = anchorToml.match(
    new RegExp(
      String.raw`\[programs\.${targetSection}\][\s\S]*?order_executor\s*=\s*"([^"]+)"`,
      "m",
    ),
  );

  const fallback = (idl.address as string | undefined) ?? (idl.metadata?.address as string);
  const address = sectionMatch?.[1] ?? fallback;
  if (!address) {
    throw new Error("Could not resolve order_executor program id from Anchor.toml or IDL");
  }
  return new PublicKey(address);
}
