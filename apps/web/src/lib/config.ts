export const BACKEND_BASE_URL =
  import.meta.env.VITE_BACKEND_BASE_URL?.toString() || 'http://localhost:8787';

export const RPC_URL =
  import.meta.env.VITE_RPC_URL?.toString() || 'https://api.devnet.solana.com';
