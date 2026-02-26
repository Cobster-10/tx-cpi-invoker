import { getContext, setContext } from 'svelte';
import type { Writable } from 'svelte/store';
import type { OpenOrder } from '$lib/api';

const ORDER_APP_CONTEXT_KEY = Symbol('order-app-context');

export type OrderAppContext = {
	walletAddress: Writable<string>;
	connectError: Writable<string>;
	openOrders: Writable<OpenOrder[]>;
	loadError: Writable<string>;
	loadingOrders: Writable<boolean>;
	connectWallet: () => Promise<void>;
	disconnectWallet: () => Promise<void>;
	refreshOpenOrders: () => Promise<void>;
};

export function setOrderAppContext(value: OrderAppContext): void {
	setContext(ORDER_APP_CONTEXT_KEY, value);
}

export function getOrderAppContext(): OrderAppContext {
	const ctx = getContext<OrderAppContext>(ORDER_APP_CONTEXT_KEY);
	if (!ctx) {
		throw new Error('Order app context is not available');
	}
	return ctx;
}
