<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import type { OpenOrder } from '$lib/api';
	import { getOrderAppContext } from '$lib/order-app-context';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Empty from '$lib/components/ui/empty';
	import * as Table from '$lib/components/ui/table';
	import * as Tabs from '$lib/components/ui/tabs';

	type OrdersTab = 'all' | 'mine';

	const { walletAddress, openOrders, loadError, loadingOrders, refreshOpenOrders } = getOrderAppContext();

	let ordersTab: OrdersTab = 'all';
	let myOrders: OpenOrder[] = [];
	let currentOrders: OpenOrder[] = [];
	let filteredOrders: OpenOrder[] = [];
	let intervalHandle: ReturnType<typeof setInterval> | null = null;

	function asRecord(value: unknown): Record<string, unknown> | null {
		return value && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: null;
	}

	function orderStatus(order: OpenOrder): 'open' | 'processed' | 'canceled' {
		if (order.canceled) return 'canceled';
		if (order.executed) return 'processed';
		return 'open';
	}

	function orderType(order: OpenOrder): 'transfer' | 'cpi' | 'unknown' {
		const trigger = asRecord(order.trigger);
		if (!trigger) return 'unknown';
		const text = JSON.stringify(trigger).toLowerCase();
		if (text.includes('cpi')) return 'cpi';
		if (text.includes('transfer')) return 'transfer';
		return 'unknown';
	}

	function triggerSummary(trigger: unknown): string {
		const record = asRecord(trigger);
		if (!record) return 'Unknown trigger format';

		const slot = record.slot ?? record.triggerSlot;
		if (slot != null) return `Slot >= ${String(slot)}`;
		const ts = record.timestamp ?? record.unixTimestamp;
		if (ts != null) return `Timestamp >= ${String(ts)}`;
		const price = record.price ?? record.targetPrice;
		if (price != null) return `Price trigger ${String(price)}`;
		const topic = record.topic ?? record.webhookTopic;
		if (topic != null) return `Webhook topic ${String(topic)}`;
		return JSON.stringify(record);
	}

	function prettyJson(value: unknown): string {
		try {
			return JSON.stringify(value, null, 2);
		} catch {
			return String(value);
		}
	}

	function shortKey(value: string, size = 8): string {
		if (value.length <= size * 2 + 1) return value;
		return `${value.slice(0, size)}...${value.slice(-size)}`;
	}

	function titleCaseWord(value: string): string {
		return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
	}

	async function refreshOrdersView(): Promise<void> {
		await refreshOpenOrders();
	}

	function stopPolling(): void {
		if (intervalHandle) {
			clearInterval(intervalHandle);
			intervalHandle = null;
		}
	}

	function syncPolling(): void {
		if (!browser) return;
		stopPolling();
		intervalHandle = setInterval(() => {
			void refreshOrdersView();
		}, 5000);
	}

	$: myOrders = $walletAddress
		? $openOrders.filter((order) => order.user.toLowerCase() === $walletAddress.toLowerCase())
		: [];
	$: currentOrders = ordersTab === 'all' ? $openOrders : myOrders;
	$: filteredOrders = currentOrders;
	$: if (browser) {
		syncPolling();
	}

	onMount(() => {
		void refreshOrdersView();
		return () => stopPolling();
	});
</script>

<div class="min-w-0 space-y-6 pb-16">
	<header class="flex flex-wrap items-center justify-between gap-2">
		<h1 class="text-xl font-semibold tracking-tight">Open Orders</h1>
		<Button variant="outline" disabled={$loadingOrders} onclick={refreshOrdersView}>
			<i class="ri-refresh-line text-base" aria-hidden="true"></i>
			{$loadingOrders ? 'Refreshing...' : 'Refresh'}
		</Button>
	</header>

	<section class="space-y-3">
		<Tabs.Root bind:value={ordersTab} class="space-y-3">
			<Tabs.List>
				<Tabs.Trigger value="all">All Orders ({$openOrders.length})</Tabs.Trigger>
				<Tabs.Trigger value="mine">My Orders ({myOrders.length})</Tabs.Trigger>
			</Tabs.List>
		</Tabs.Root>

		<div class="rounded-md border">
			<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Order ID</Table.Head>
					<Table.Head>Order</Table.Head>
					<Table.Head>User</Table.Head>
					<Table.Head>Status</Table.Head>
					<Table.Head>Type</Table.Head>
					<Table.Head>Trigger</Table.Head>
					<Table.Head class="text-right">Details</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#if filteredOrders.length === 0}
					<Table.Row>
						<Table.Cell colspan={7} class="py-4">
							<Empty.Root class="min-h-0 border-0 p-6 md:p-8">
								<Empty.Header>
									<Empty.Title>
										{#if $loadError}
											Unable to Load Orders
										{:else if ordersTab === 'mine' && !$walletAddress}
											Wallet Not Connected
										{:else}
											No Open Orders
										{/if}
									</Empty.Title>
									<Empty.Description>
										{$loadError
											? $loadError
											: ordersTab === 'mine' && !$walletAddress
											? 'Connect your wallet to view My Orders.'
											: 'No open orders match the current tab.'}
									</Empty.Description>
								</Empty.Header>
							</Empty.Root>
						</Table.Cell>
					</Table.Row>
				{:else}
					{#each filteredOrders as order}
						<Table.Row>
							<Table.Cell class="font-medium">#{order.orderId}</Table.Cell>
							<Table.Cell class="font-mono text-xs">{shortKey(order.orderPubkey)}</Table.Cell>
							<Table.Cell class="font-mono text-xs">{shortKey(order.user)}</Table.Cell>
							<Table.Cell>
								<Badge
									variant={orderStatus(order) === 'canceled'
										? 'destructive'
										: orderStatus(order) === 'processed'
											? 'secondary'
											: 'outline'}
								>
									{titleCaseWord(orderStatus(order))}
								</Badge>
							</Table.Cell>
							<Table.Cell>
								<Badge variant="outline">{titleCaseWord(orderType(order))}</Badge>
							</Table.Cell>
							<Table.Cell class="max-w-[22rem] whitespace-normal text-sm text-muted-foreground">
								{triggerSummary(order.trigger)}
							</Table.Cell>
							<Table.Cell class="text-right">
								<details class="inline-block text-left">
									<summary class="cursor-pointer text-sm text-muted-foreground">JSON</summary>
									<pre class="mt-2 max-h-48 w-[20rem] overflow-auto rounded-md border p-2 text-xs">
{prettyJson(order.trigger)}</pre
									>
								</details>
							</Table.Cell>
						</Table.Row>
					{/each}
				{/if}
			</Table.Body>
			</Table.Root>
		</div>
	</section>
</div>
