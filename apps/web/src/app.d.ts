// See https://svelte.dev/docs/kit/types#app.d.ts

declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }

  interface Window {
    solana?: {
      isPhantom?: boolean;
      publicKey?: { toBase58(): string };
      connect(opts?: { onlyIfTrusted?: boolean }): Promise<void>;
      disconnect(): Promise<void>;
      signTransaction(tx: import('@solana/web3.js').Transaction): Promise<import('@solana/web3.js').Transaction>;
    };
  }
}

export {};
