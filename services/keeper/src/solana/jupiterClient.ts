import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const NATIVE_SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
import type { SwapInstruction } from "./orderExecutorClient.js";

type JupiterIx = {
  programId: string;
  accounts: Array<{
    pubkey: string;
    isSigner?: boolean;
    isWritable?: boolean;
  }>;
  data: string;
};

export type JupiterSwapResult = {
  swapInstruction: SwapInstruction;
  setupInstructions: TransactionInstruction[];
  computeBudgetInstructions: TransactionInstruction[];
};

function jupiterIxToTransactionInstruction(ix: JupiterIx): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((a) => ({
      pubkey: new PublicKey(a.pubkey),
      isSigner: a.isSigner ?? false,
      isWritable: a.isWritable ?? true,
    })),
    data: Buffer.from(ix.data, "base64"),
  });
}

const JUPITER_API_BASE = "https://api.jup.ag";

export type GetSwapInstructionParams = {
  vaultPda: PublicKey;
  inputMint: PublicKey;
  outputMint: PublicKey;
  amountLamports: number;
  slippageBps: number;
  /** Payer for setup (ATA creation, etc.). Must be a signer. Defaults to vaultPda if omitted. */
  payer?: PublicKey;
};

/**
 * Fetches a fresh Jupiter quote and builds the swap instruction plus setup instructions.
 * setupInstructions create required token accounts (WSOL, USDC ATAs) - include before execute.
 * Requires JUPITER_API_KEY env var.
 */
export async function getSwapInstruction(
  params: GetSwapInstructionParams
): Promise<JupiterSwapResult | null> {
  const apiKey = process.env.JUPITER_API_KEY;
  if (!apiKey) {
    return null;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
  };

  try {
    const base = `inputMint=${params.inputMint.toBase58()}&outputMint=${params.outputMint.toBase58()}&amount=${params.amountLamports}&slippageBps=${params.slippageBps}`;
    const quoteUrls = [
      `${base}&onlyDirectRoutes=true&maxAccounts=20`,
      `${base}&maxAccounts=25`,
      base,
    ];

    let quote: Record<string, unknown> | null = null;
    for (const url of quoteUrls) {
      const res = await fetch(`${JUPITER_API_BASE}/swap/v1/quote?${url}`, {
        headers,
      });
      const q = await res.json();
      if (q && !(q as { error?: unknown }).error) {
        quote = q as Record<string, unknown>;
        break;
      }
    }

    if (!quote) return null;

    const swapRes = await fetch(`${JUPITER_API_BASE}/swap/v1/swap-instructions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: params.vaultPda.toBase58(),
        wrapAndUnwrapSol: true,
        ...(params.payer && { payer: params.payer.toBase58() }),
      }),
    });
    const swap = (await swapRes.json()) as {
      swapInstruction?: JupiterIx;
      setupInstructions?: JupiterIx[];
      computeBudgetInstructions?: JupiterIx[];
    };

    if (!swap?.swapInstruction) return null;

    let setupInstructions = (swap.setupInstructions ?? []).map((ix) => {
      const txIx = jupiterIxToTransactionInstruction(ix);
      if (!params.payer) return txIx;
      const vaultB58 = params.vaultPda.toBase58();
      const keys = txIx.keys.map((k) =>
        k.pubkey.toBase58() === vaultB58 && k.isSigner
          ? { ...k, pubkey: params.payer!, isSigner: true }
          : k
      );
      return new TransactionInstruction({
        programId: txIx.programId,
        keys,
        data: txIx.data,
      });
    });

    // When swapping native SOL, the order_executor program does the transfer and sync_native
    // (vault funds the wrap). Filter out those setup instructions so keeper doesn't pay.
    if (params.inputMint.equals(NATIVE_SOL_MINT)) {
      setupInstructions = setupInstructions.filter((ix) => {
        const data = ix.data;
        if (ix.programId.equals(SystemProgram.programId)) {
          // System Program Transfer = instruction 2 (u32 LE)
          if (data.length >= 4 && data[0] === 2 && data[1] === 0 && data[2] === 0 && data[3] === 0) {
            return false;
          }
        }
        if (ix.programId.equals(TOKEN_PROGRAM_ID)) {
          // SPL Token SyncNative = instruction 17
          if (data.length >= 1 && data[0] === 17) {
            return false;
          }
        }
        return true;
      });
    }
    const computeBudgetInstructions = (
      swap.computeBudgetInstructions ?? []
    ).map(jupiterIxToTransactionInstruction);

    const { programId, accounts, data } = swap.swapInstruction;
    const swapInstruction: SwapInstruction = {
      programId: new PublicKey(programId),
      accounts: accounts.map((a) => ({
        pubkey: new PublicKey(a.pubkey),
        isWritable: a.isWritable ?? true,
      })),
      data: Buffer.from(data, "base64"),
    };

    return {
      swapInstruction,
      setupInstructions,
      computeBudgetInstructions,
    };
  } catch {
    return null;
  }
}
