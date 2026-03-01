/**
 * Test: Create order with SwapIntent for SOL->USDC swap.
 * No Jupiter call at create time - keeper fetches fresh quote at execution.
 * Trigger: TimeAfter slot 0 (executable immediately).
 *
 * Run from services/keeper: npm run test:swap
 * Prereqs: local validator (or devnet), program deployed, .env with RPC_HTTP_URL, PROGRAM_ID.
 * After creating order, run keeper (npm run dev) to execute the swap.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env") });

// AnchorProvider.env() uses ANCHOR_PROVIDER_URL and ANCHOR_WALLET; fallback to keeper .env
if (!process.env.ANCHOR_PROVIDER_URL && process.env.RPC_HTTP_URL) {
  process.env.ANCHOR_PROVIDER_URL = process.env.RPC_HTTP_URL;
}
if (!process.env.ANCHOR_WALLET && process.env.KEEPER_KEYPAIR_PATH) {
  process.env.ANCHOR_WALLET = process.env.KEEPER_KEYPAIR_PATH;
}

const idlPath = path.join(process.cwd(), "tests/order_executor.json");
const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

const NATIVE_SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUPITER_PROGRAM_ID = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

async function runTest() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new Program(
    { ...idl, address: new PublicKey(process.env.PROGRAM_ID!) },
    provider
  );

  const user = Keypair.generate();
  const LAMPORTS_PER_SOL = 1_000_000_000n;
  const swapAmount = 100_000_000; // 0.1 SOL
  const inputAmount = swapAmount + 500_000_000; // swap + buffer for rent/fees

  // Airdrop
  const { blockhash, lastValidBlockHeight } =
    await provider.connection.getLatestBlockhash();
  const sig = await provider.connection.requestAirdrop(
    user.publicKey,
    10 * Number(LAMPORTS_PER_SOL)
  );
  await provider.connection.confirmTransaction({
    signature: sig,
    blockhash,
    lastValidBlockHeight,
  });

  // Init counter
  const [orderCounterPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("order_counter"), user.publicKey.toBuffer()],
    program.programId
  );
  const orderIdBuf = Buffer.alloc(8);
  orderIdBuf.writeBigUInt64LE(0n);
  const [orderPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("order"), user.publicKey.toBuffer(), orderIdBuf],
    program.programId
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), user.publicKey.toBuffer(), orderIdBuf],
    program.programId
  );

  await program.methods
    .initUserCounter()
    .accounts({
      user: user.publicKey,
      orderCounter: orderCounterPda,
      systemProgram: SystemProgram.programId,
    })
    .signers([user])
    .rpc();

  const trigger = {
    timeAfter: {
      slot: new BN(0),
    },
  };

  // OrderAction::SwapIntent(SwapIntent) is a tuple variant (unnamed field) - Anchor's Borsh layout
  // expects the inner struct under key "0" for tuple-style enum variants.
  const action = {
    swapIntent: {
      0: {
        swapProgram: new PublicKey(JUPITER_PROGRAM_ID),
        inputMint: new PublicKey(NATIVE_SOL_MINT),
        outputMint: new PublicKey(USDC_MINT),
        inputAmount: new BN(swapAmount.toString()),
        maxSlippageBps: 300,
      },
    },
  };

  await program.methods
    .createOrder(
      new BN(inputAmount.toString()),
      trigger,
      action,
      null,
      new BN(10_000_000)
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

  console.log(
    "SwapIntent order created (no Jupiter at create): order",
    orderPda.toBase58(),
    "vault",
    vaultPda.toBase58()
  );
}

runTest().catch(console.error);
