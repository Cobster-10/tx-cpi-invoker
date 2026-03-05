import { BACKEND_BASE_URL } from './config';

export type OpenOrder = {
  orderPubkey: string;
  user: string;
  orderId: string;
  executed: boolean;
  canceled: boolean;
  trigger: unknown;
};

export type CreateOrderRequest = {
  user: string;
  recipient: string;
  transferLamports: string;
  executionBountyLamports: string;
  triggerSlot: string;
  expiresSlot?: string;
};

export type BuildCreateOrderResponse = {
  unsignedTransactionBase64: string;
};

export async function fetchOpenOrders(user?: string): Promise<OpenOrder[]> {
  const url = new URL('/orders/open', BACKEND_BASE_URL);
  if (user) url.searchParams.set('user', user);

  const res = await fetch(url.toString(), { method: 'GET' });
  if (!res.ok) throw new Error(`Failed to fetch open orders: ${res.status}`);
  return (await res.json()) as OpenOrder[];
}

/** @deprecated Direct on-chain create_order is used by the create page. */
export async function requestCreateOrderTransaction(
  body: CreateOrderRequest
): Promise<BuildCreateOrderResponse> {
  const res = await fetch(new URL('/orders/create-tx', BACKEND_BASE_URL).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Failed to build create-order transaction: ${res.status}`);
  }

  return (await res.json()) as BuildCreateOrderResponse;
}

/** @deprecated Direct on-chain create_order is used by the create page. */
export async function notifyCreateOrderSubmitted(signature: string): Promise<void> {
  await fetch(new URL('/orders/create-tx/submitted', BACKEND_BASE_URL).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ signature })
  });
}
