<script lang="ts">
	import './layout.css';
	import '../app.css';
	import 'remixicon/fonts/remixicon.css';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { writable } from 'svelte/store';
	import { fetchOpenOrders, type OpenOrder } from '$lib/api';
	import { cn } from '$lib/utils';
	import { setOrderAppContext } from '$lib/order-app-context';
	import * as Alert from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import * as NavigationMenu from '$lib/components/ui/navigation-menu';
	import { navigationMenuTriggerStyle } from '$lib/components/ui/navigation-menu/navigation-menu-trigger.svelte';

	const walletAddress = writable('');
	const connectError = writable('');
	const openOrders = writable<OpenOrder[]>([]);
	const loadError = writable('');
	const loadingOrders = writable(false);

	function getWalletProvider() {
		return browser ? window.solana : undefined;
	}

	async function connectWallet(): Promise<void> {
		connectError.set('');
		const provider = getWalletProvider();
		if (!provider) {
			connectError.set(
				'No injected wallet found. Install Phantom (or another wallet extension) and refresh.'
			);
			return;
		}

		try {
			await provider.connect();
			walletAddress.set(provider.publicKey?.toBase58() || '');
			await refreshOpenOrders();
		} catch (err) {
			connectError.set(err instanceof Error ? err.message : 'Wallet connection failed');
		}
	}

	async function tryReconnectTrustedWallet(): Promise<void> {
		const provider = getWalletProvider();
		if (!provider) return;

		try {
			await provider.connect({ onlyIfTrusted: true });
			walletAddress.set(provider.publicKey?.toBase58() || '');
		} catch {
			// no-op
		}
	}

	async function disconnectWallet(): Promise<void> {
		const provider = getWalletProvider();
		if (!provider) return;
		try {
			await provider.disconnect();
		} finally {
			walletAddress.set('');
		}
	}

	async function refreshOpenOrders(): Promise<void> {
		loadError.set('');
		loadingOrders.set(true);
		try {
			openOrders.set(await fetchOpenOrders());
		} catch (err) {
			loadError.set(err instanceof Error ? err.message : 'Failed to load open orders');
		} finally {
			loadingOrders.set(false);
		}
	}

	setOrderAppContext({
		walletAddress,
		connectError,
		openOrders,
		loadError,
		loadingOrders,
		connectWallet,
		disconnectWallet,
		refreshOpenOrders
	});

	let activeTab: 'create-order' | 'orders' = 'create-order';
	let walletButtonHover = false;
	$: activeTab = $page.url.pathname.startsWith('/orders') ? 'orders' : 'create-order';

	onMount(() => {
		void tryReconnectTrustedWallet();
	});
</script>

<div>
	<nav class="sticky top-0 z-40 w-full border-b border-white/10 bg-black text-slate-100">
		<div class="mx-auto grid w-full max-w-7xl grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-4 py-2">
			<div class="min-w-0 justify-self-start">
				<div class="shrink-0 text-sm font-semibold tracking-tight text-white">Order Executor</div>
			</div>

			<div class="min-w-0 justify-self-center">
				<NavigationMenu.Root viewport={false} class="flex-none justify-center">
					<NavigationMenu.List class="justify-center gap-1">
						<NavigationMenu.Item>
							<NavigationMenu.Link>
								{#snippet child()}
									<a
										href="/create-order"
										aria-current={activeTab === 'create-order' ? 'page' : undefined}
										class={cn(
											navigationMenuTriggerStyle(),
											'bg-transparent text-slate-200 hover:bg-white/15 hover:text-white focus:bg-white/15 focus:text-white focus-visible:ring-white/20',
											activeTab === 'create-order' && 'bg-white/15 text-white ring-1 ring-white/10'
										)}
									>
										Create Order
									</a>
								{/snippet}
							</NavigationMenu.Link>
						</NavigationMenu.Item>
						<NavigationMenu.Item>
							<NavigationMenu.Link>
								{#snippet child()}
									<a
										href="/orders"
										aria-current={activeTab === 'orders' ? 'page' : undefined}
										class={cn(
											navigationMenuTriggerStyle(),
											'bg-transparent text-slate-200 hover:bg-white/15 hover:text-white focus:bg-white/15 focus:text-white focus-visible:ring-white/20',
											activeTab === 'orders' && 'bg-white/15 text-white ring-1 ring-white/10'
										)}
									>
										Open Orders
									</a>
								{/snippet}
							</NavigationMenu.Link>
						</NavigationMenu.Item>
					</NavigationMenu.List>
				</NavigationMenu.Root>
			</div>

			<div class="min-w-0 justify-self-end">
				{#if $walletAddress}
					<Button
						variant="outline"
						class="h-9 border-white/10 bg-transparent text-slate-100 hover:bg-white/15 hover:text-white"
						onclick={disconnectWallet}
						onmouseenter={() => (walletButtonHover = true)}
						onmouseleave={() => (walletButtonHover = false)}
					>
						<i class="ri-wallet-line text-base" aria-hidden="true"></i>
						{walletButtonHover ? 'Disconnect' : `${$walletAddress.slice(0, 4)}...${$walletAddress.slice(-4)}`}
					</Button>
				{:else}
					<Button
						variant="outline"
						class="h-9 border-white/10 bg-transparent text-slate-100 hover:bg-white/15 hover:text-white"
						onclick={connectWallet}
					>
						<i class="ri-wallet-3-line text-base" aria-hidden="true"></i>
						Connect Wallet
					</Button>
				{/if}
			</div>
		</div>
	</nav>

	<div class="mx-auto w-full max-w-7xl px-4 py-6">
		{#if $connectError}
			<Alert.Root variant="destructive">
				<Alert.Title>Wallet Error</Alert.Title>
				<Alert.Description>{$connectError}</Alert.Description>
			</Alert.Root>
		{/if}

		<slot />
	</div>
</div>
