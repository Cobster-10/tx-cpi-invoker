<script lang="ts">
	import { browser } from '$app/environment';
	import { get } from 'svelte/store';
	import {
		Connection,
		LAMPORTS_PER_SOL,
		PublicKey,
		SystemProgram,
		Transaction
	} from '@solana/web3.js';
	import { notifyCreateOrderSubmitted } from '$lib/api';
	import { RPC_URL } from '$lib/config';
	import { getOrderAppContext } from '$lib/order-app-context';
	import {
		SPL_TOKEN_PROGRAM_ID,
		buildCreateOrderInstruction,
		buildInitUserCounterInstruction,
		buildSystemTransferAction,
		deriveOrderPda,
		deriveUserOrderCounterPda,
		deriveVaultPda,
		fetchUserOrderCounterState,
		getOrderExecutorProgramId,
		isWhitelistedProgram,
		type CpiActionInput,
		type OrderActionInput,
		type TriggerInput
	} from '$lib/order-executor';
	import * as Alert from '$lib/components/ui/alert';
	import * as ButtonGroup from '$lib/components/ui/button-group';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import * as InputGroup from '$lib/components/ui/input-group';
	import * as NativeSelect from '$lib/components/ui/native-select';
	import { Separator } from '$lib/components/ui/separator';
	import { Switch } from '$lib/components/ui/switch';
	import * as Table from '$lib/components/ui/table';

	type TriggerKind = TriggerInput['kind'];
	type ActionTemplate = 'system_transfer' | 'spl_token_transfer' | 'raw_cpi';
	type DataEncoding = 'hex' | 'base64';
	type SplAuthorityPda = 'order_pda' | 'vault_pda';
	type RawAccountPreset = '' | 'user' | 'order_pda' | 'vault_pda' | 'system' | 'spl';

	type RawAccountRow = {
		pubkey: string;
		isWritable: boolean;
		preset: RawAccountPreset;
	};

	type CounterPreview = {
		counterExists: boolean;
		nextOrderId: bigint;
		orderCounterPda: string;
		orderPda: string;
		vaultPda: string;
	};

	type PendingOrderContext = {
		user: PublicKey;
		nextOrderId: bigint;
		orderPda: PublicKey;
		vaultPda: PublicKey;
		inputAmountLamports: bigint;
		executionBountyLamports: bigint;
	};

	type ChecklistItem = {
		label: string;
		ok: boolean;
	};

	const connection = new Connection(RPC_URL, 'confirmed');
	const orderExecutorProgramId = getOrderExecutorProgramId();
	const { walletAddress, refreshOpenOrders } = getOrderAppContext();

	const triggerOptions: Array<{ key: TriggerKind; label: string; route: 'base' | 'stork' }> = [
		{ key: 'time_after', label: 'Slot After', route: 'base' },
		{ key: 'pda_value_equals', label: 'PDA Value Equals', route: 'base' },
		{ key: 'price_below_stork', label: 'Stork Price Below', route: 'stork' },
		{ key: 'price_above_stork', label: 'Stork Price Above', route: 'stork' },
		{ key: 'stork_outcome_equals', label: 'Stork Outcome Equals', route: 'stork' }
	];

	const actionTemplateOptions: Array<{ key: ActionTemplate; label: string }> = [
		{ key: 'system_transfer', label: 'System Transfer' },
		{ key: 'spl_token_transfer', label: 'SPL Token Transfer' },
		{ key: 'raw_cpi', label: 'Raw CPI' }
	];

	let busy = false;
	let previewBusy = false;
	let createError = '';
	let createMessage = '';
	let previewError = '';
	let counterPreview: CounterPreview | null = null;
	let autoPreviewWallet = '';

	let inputAmountSol = '0.01';
	let executionBountySol = '0.001';
	let expiresSlot = '';

	let triggerKind: TriggerKind = 'time_after';
	let triggerTimeAfterSlot = '';
	let triggerPdaAccount = '';
	let triggerPdaExpectedValue = '';
	let triggerStorkFeedIdHex = '';
	let triggerStorkThresholdQ = '';
	let triggerStorkMaxAgeSec = '30';

	let actionTemplate: ActionTemplate = 'system_transfer';

	let systemRecipient = '';
	let systemTransferAmountMode: 'escrow_minus_bounty' | 'custom' = 'escrow_minus_bounty';
	let systemTransferLamports = '';

	let splSourceTokenAccount = '';
	let splDestinationTokenAccount = '';
	let splAuthorityPda: SplAuthorityPda = 'vault_pda';
	let splTransferAmountRaw = '';

	let rawProgramId = '';
	let rawDataEncoding: DataEncoding = 'hex';
	let rawInstructionData = '';
	let rawAccounts: RawAccountRow[] = [{ pubkey: '', isWritable: true, preset: '' }];
	let checklistItems: ChecklistItem[] = [];
	let checklistComplete = false;

	function getWalletProvider() {
		return browser ? window.solana : undefined;
	}

	function pushBlankRawAccount(): void {
		rawAccounts = [...rawAccounts, { pubkey: '', isWritable: false, preset: '' }];
	}

	function removeRawAccount(index: number): void {
		rawAccounts = rawAccounts.filter((_, i) => i !== index);
		if (rawAccounts.length === 0) rawAccounts = [{ pubkey: '', isWritable: true, preset: '' }];
	}

	function fillRawAccount(index: number, preset: Exclude<RawAccountPreset, ''>): void {
		const next = [...rawAccounts];
		if (!next[index]) return;

		if (preset === 'user') {
			next[index].pubkey = get(walletAddress);
		} else if (preset === 'order_pda') {
			next[index].pubkey = counterPreview?.orderPda ?? '';
		} else if (preset === 'vault_pda') {
			next[index].pubkey = counterPreview?.vaultPda ?? '';
		} else if (preset === 'system') {
			next[index].pubkey = SystemProgram.programId.toBase58();
		} else if (preset === 'spl') {
			next[index].pubkey = SPL_TOKEN_PROGRAM_ID.toBase58();
		}

		rawAccounts = next;
	}

	function setRawAccountPreset(index: number, preset: RawAccountPreset): void {
		const next = [...rawAccounts];
		if (!next[index]) return;
		next[index].preset = preset;
		rawAccounts = next;
		if (preset) fillRawAccount(index, preset);
	}

	function parsePubkey(input: string, field: string): PublicKey {
		const value = input.trim();
		if (!value) throw new Error(`${field} is required.`);
		try {
			return new PublicKey(value);
		} catch {
			throw new Error(`${field} must be a valid Solana public key.`);
		}
	}

	function parseU64(input: string, field: string, options?: { allowEmpty?: boolean; allowZero?: boolean }): bigint | null {
		const value = input.trim();
		if (!value) {
			if (options?.allowEmpty) return null;
			throw new Error(`${field} is required.`);
		}
		if (!/^\d+$/.test(value)) throw new Error(`${field} must be an unsigned integer.`);
		const parsed = BigInt(value);
		const max = (1n << 64n) - 1n;
		if (parsed > max) throw new Error(`${field} exceeds u64 range.`);
		if (!options?.allowZero && parsed === 0n) throw new Error(`${field} must be greater than 0.`);
		return parsed;
	}

	function parseI128(input: string, field: string): bigint {
		const value = input.trim();
		if (!value) throw new Error(`${field} is required.`);
		if (!/^-?\d+$/.test(value)) throw new Error(`${field} must be an integer.`);
		const parsed = BigInt(value);
		const min = -(1n << 127n);
		const max = (1n << 127n) - 1n;
		if (parsed < min || parsed > max) throw new Error(`${field} exceeds i128 range.`);
		return parsed;
	}

	function parseSolToLamports(
		input: string,
		field: string,
		options?: { allowZero?: boolean }
	): bigint {
		const value = input.trim();
		if (!value) throw new Error(`${field} is required.`);
		const match = value.match(/^(\d+)(?:\.(\d{0,9}))?$/);
		if (!match) {
			throw new Error(`${field} must be a valid SOL amount (up to 9 decimals).`);
		}
		const whole = BigInt(match[1]);
		const fractionalText = (match[2] ?? '').padEnd(9, '0');
		const fractional = fractionalText ? BigInt(fractionalText) : 0n;
		const lamports = whole * BigInt(LAMPORTS_PER_SOL) + fractional;
		if (!options?.allowZero && lamports <= 0n) throw new Error(`${field} must be greater than 0.`);
		if (options?.allowZero && lamports < 0n) throw new Error(`${field} must be >= 0.`);
		return lamports;
	}

	function hexToBytes(input: string, field: string): Uint8Array {
		const normalized = input.trim().replace(/^0x/i, '').replace(/\s+/g, '');
		if (normalized.length === 0) return new Uint8Array();
		if (normalized.length % 2 !== 0) throw new Error(`${field} must be even-length hex.`);
		const out = new Uint8Array(normalized.length / 2);
		for (let i = 0; i < out.length; i += 1) {
			const byte = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
			if (Number.isNaN(byte)) throw new Error(`${field} contains invalid hex.`);
			out[i] = byte;
		}
		return out;
	}

	function base64ToBytes(input: string, field: string): Uint8Array {
		const value = input.trim();
		if (!value) return new Uint8Array();
		if (!browser) throw new Error(`${field} can only be parsed in the browser.`);
		try {
			const binary = window.atob(value);
			const out = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
			return out;
		} catch {
			throw new Error(`${field} must be valid base64.`);
		}
	}

	function parseFeedId32(input: string): Uint8Array {
		const bytes = hexToBytes(input, 'Stork feed id');
		if (bytes.length !== 32) throw new Error('Stork feed id must be exactly 32 bytes (64 hex chars).');
		return bytes;
	}

	function u64ToLeBytes(value: bigint): Uint8Array {
		const out = new Uint8Array(8);
		let n = value;
		for (let i = 0; i < 8; i += 1) {
			out[i] = Number(n & 0xffn);
			n >>= 8n;
		}
		return out;
	}

	function buildSplTokenTransferInstructionData(amount: bigint): Uint8Array {
		const out = new Uint8Array(9);
		out[0] = 3; // TokenInstruction::Transfer
		out.set(u64ToLeBytes(amount), 1);
		return out;
	}

	function getRawProgramId(): PublicKey {
		return parsePubkey(rawProgramId, 'Program id');
	}

	function passes(check: () => void): boolean {
		try {
			check();
			return true;
		} catch {
			return false;
		}
	}

	function hasWallet(): boolean {
		return Boolean(get(walletAddress));
	}

	function hasValidFundingInputs(): boolean {
		return passes(() => {
			const escrow = parseSolToLamports(inputAmountSol, 'Escrow amount (SOL)');
			const bounty = parseSolToLamports(executionBountySol, 'Execution bounty (SOL)', { allowZero: true });
			if (bounty >= escrow) throw new Error('bounty >= escrow');
		});
	}

	function hasValidExpiryInput(): boolean {
		return passes(() => {
			parseU64(expiresSlot, 'Expires slot', { allowEmpty: true, allowZero: false });
		});
	}

	function hasValidTriggerInputs(): boolean {
		return passes(() => {
			if (triggerKind === 'time_after') {
				parseU64(triggerTimeAfterSlot, 'Trigger slot', { allowEmpty: true });
				return;
			}

			if (triggerKind === 'pda_value_equals') {
				parsePubkey(triggerPdaAccount, 'Trigger account');
				parseU64(triggerPdaExpectedValue, 'Expected value (u64)');
				return;
			}

			parseFeedId32(triggerStorkFeedIdHex);
			parseI128(triggerStorkThresholdQ, 'Threshold');
			parseU64(triggerStorkMaxAgeSec, 'Max age (seconds)');
		});
	}

	function hasValidActionInputs(): boolean {
		return passes(() => {
			if (actionTemplate === 'system_transfer') {
				parsePubkey(systemRecipient, 'Recipient');
				if (systemTransferAmountMode === 'custom') {
					parseU64(systemTransferLamports, 'Transfer lamports');
				}
				return;
			}

			if (actionTemplate === 'spl_token_transfer') {
				parsePubkey(splSourceTokenAccount, 'Source token account');
				parsePubkey(splDestinationTokenAccount, 'Destination token account');
				parseU64(splTransferAmountRaw, 'SPL transfer amount (raw)');
				return;
			}

			const programId = getRawProgramId();
			if (!isWhitelistedProgram(programId)) throw new Error('Program not whitelisted');

			for (const account of rawAccounts) {
				if (!account.pubkey.trim()) continue;
				parsePubkey(account.pubkey, 'CPI account');
			}

			if (rawDataEncoding === 'hex') {
				hexToBytes(rawInstructionData, 'Instruction data');
			} else {
				base64ToBytes(rawInstructionData, 'Instruction data');
			}
		});
	}

	function buildCounterPreview(user: PublicKey, nextOrderId: bigint, counterExists: boolean): CounterPreview {
		const [orderCounterPda] = deriveUserOrderCounterPda(user, orderExecutorProgramId);
		const [orderPda] = deriveOrderPda(user, nextOrderId, orderExecutorProgramId);
		const [vaultPda] = deriveVaultPda(user, nextOrderId, orderExecutorProgramId);
		return {
			counterExists,
			nextOrderId,
			orderCounterPda: orderCounterPda.toBase58(),
			orderPda: orderPda.toBase58(),
			vaultPda: vaultPda.toBase58()
		};
	}

	async function refreshCounterPreview(): Promise<void> {
		previewError = '';
		const wallet = get(walletAddress);
		if (!wallet) {
			counterPreview = null;
			return;
		}

		previewBusy = true;
		try {
			const user = new PublicKey(wallet);
			const counter = await fetchUserOrderCounterState(connection, user, orderExecutorProgramId);
			counterPreview = buildCounterPreview(user, counter.nextOrderId, counter.exists);
		} catch (err) {
			counterPreview = null;
			previewError = err instanceof Error ? err.message : 'Failed to load counter preview';
		} finally {
			previewBusy = false;
		}
	}

	async function buildTriggerInputFromForm(): Promise<TriggerInput> {
		switch (triggerKind) {
			case 'time_after': {
				const explicitSlot = parseU64(triggerTimeAfterSlot, 'Trigger slot', { allowEmpty: true });
				const slot = explicitSlot ?? BigInt(await connection.getSlot('confirmed'));
				return { kind: 'time_after', slot };
			}
			case 'pda_value_equals':
				return {
					kind: 'pda_value_equals',
					account: parsePubkey(triggerPdaAccount, 'Trigger account'),
					expectedValue: parseU64(triggerPdaExpectedValue, 'Expected value (u64)') as bigint
				};
			case 'price_below_stork':
				return {
					kind: 'price_below_stork',
					feedId: parseFeedId32(triggerStorkFeedIdHex),
					maxPriceQ: parseI128(triggerStorkThresholdQ, 'Max price Q'),
					maxAgeSec: parseU64(triggerStorkMaxAgeSec, 'Max age (seconds)') as bigint
				};
			case 'price_above_stork':
				return {
					kind: 'price_above_stork',
					feedId: parseFeedId32(triggerStorkFeedIdHex),
					minPriceQ: parseI128(triggerStorkThresholdQ, 'Min price Q'),
					maxAgeSec: parseU64(triggerStorkMaxAgeSec, 'Max age (seconds)') as bigint
				};
			case 'stork_outcome_equals':
				return {
					kind: 'stork_outcome_equals',
					feedId: parseFeedId32(triggerStorkFeedIdHex),
					expectedOutcomeQ: parseI128(triggerStorkThresholdQ, 'Expected outcome Q'),
					maxAgeSec: parseU64(triggerStorkMaxAgeSec, 'Max age (seconds)') as bigint
				};
		}
	}

	function buildSystemTransferActionInput(ctx: PendingOrderContext): CpiActionInput {
		const recipient = parsePubkey(systemRecipient, 'Recipient');
		let lamports: bigint;

		if (systemTransferAmountMode === 'escrow_minus_bounty') {
			lamports = ctx.inputAmountLamports - ctx.executionBountyLamports;
			if (lamports <= 0n) {
				throw new Error('Escrow minus bounty must be greater than 0 for a system transfer action.');
			}
		} else {
			lamports = parseU64(systemTransferLamports, 'Transfer lamports') as bigint;
		}

		return buildSystemTransferAction({
			user: ctx.user,
			orderId: ctx.nextOrderId,
			recipient,
			lamports,
			programId: orderExecutorProgramId
		});
	}

	function buildSplTokenTransferActionInput(ctx: PendingOrderContext): CpiActionInput {
		const source = parsePubkey(splSourceTokenAccount, 'Source token account');
		const destination = parsePubkey(splDestinationTokenAccount, 'Destination token account');
		const amount = parseU64(splTransferAmountRaw, 'SPL transfer amount (raw)') as bigint;
		const authority = splAuthorityPda === 'order_pda' ? ctx.orderPda : ctx.vaultPda;

		return {
			programId: SPL_TOKEN_PROGRAM_ID,
			accounts: [
				{ pubkey: source, isWritable: true },
				{ pubkey: destination, isWritable: true },
				{ pubkey: authority, isWritable: false }
			],
			data: buildSplTokenTransferInstructionData(amount)
		};
	}

	function buildRawCpiActionInput(): CpiActionInput {
		const programId = getRawProgramId();
		if (!isWhitelistedProgram(programId)) {
			throw new Error(
				'Program is not whitelisted on-chain. Current whitelist supports only System Program and SPL Token Program.'
			);
		}

		const accounts = rawAccounts
			.map((account) => ({ ...account, pubkey: account.pubkey.trim() }))
			.filter((account) => account.pubkey.length > 0)
			.map((account, index) => ({
				pubkey: parsePubkey(account.pubkey, `CPI account #${index + 1}`),
				isWritable: account.isWritable
			}));

		const data = rawDataEncoding === 'hex'
			? hexToBytes(rawInstructionData, 'Instruction data')
			: base64ToBytes(rawInstructionData, 'Instruction data');

		return { programId, accounts, data };
	}

	function buildActionInputFromForm(ctx: PendingOrderContext): OrderActionInput {
		switch (actionTemplate) {
			case 'system_transfer':
				return { kind: 'cpi', action: buildSystemTransferActionInput(ctx) };
			case 'spl_token_transfer':
				return { kind: 'cpi', action: buildSplTokenTransferActionInput(ctx) };
			case 'raw_cpi':
				return { kind: 'cpi', action: buildRawCpiActionInput() };
		}
	}

	async function createOrder(): Promise<void> {
		createError = '';
		createMessage = '';

		const wallet = get(walletAddress);
		if (!wallet) {
			createError = 'Connect a wallet from the nav bar first.';
			return;
		}

		const provider = getWalletProvider();
		if (!provider) {
			createError = 'Wallet provider is not available in the browser.';
			return;
		}

		busy = true;
		try {
			const user = new PublicKey(wallet);
			const inputAmountLamports = parseSolToLamports(inputAmountSol, 'Escrow amount (SOL)');
			const executionBountyLamports = parseSolToLamports(executionBountySol, 'Execution bounty (SOL)', {
				allowZero: true
			});
			if (executionBountyLamports >= inputAmountLamports) {
				throw new Error('Execution bounty must be less than the escrow amount.');
			}

			const expiresSlotParsed = parseU64(expiresSlot, 'Expires slot', {
				allowEmpty: true,
				allowZero: false
			});
			const expiresSlotValue = expiresSlotParsed ?? null;

			const counter = await fetchUserOrderCounterState(connection, user, orderExecutorProgramId);
			const nextOrderId = counter.nextOrderId;
			const [orderPda] = deriveOrderPda(user, nextOrderId, orderExecutorProgramId);
			const [vaultPda] = deriveVaultPda(user, nextOrderId, orderExecutorProgramId);

			const pendingCtx: PendingOrderContext = {
				user,
				nextOrderId,
				orderPda,
				vaultPda,
				inputAmountLamports,
				executionBountyLamports
			};

			const trigger = await buildTriggerInputFromForm();
			const action = buildActionInputFromForm(pendingCtx);

			const tx = new Transaction();
			if (!counter.exists) {
				tx.add(buildInitUserCounterInstruction(user, orderExecutorProgramId).instruction);
			}

			const createIx = buildCreateOrderInstruction({
				user,
				nextOrderId,
				inputAmountLamports,
				trigger,
				action,
				expiresSlot: expiresSlotValue,
				executionBountyLamports,
				programId: orderExecutorProgramId
			});
			tx.add(createIx.instruction);

			const latest = await connection.getLatestBlockhash('confirmed');
			tx.feePayer = user;
			tx.recentBlockhash = latest.blockhash;

			const signed = await provider.signTransaction(tx);
			const signature = await connection.sendRawTransaction(signed.serialize());
			await connection.confirmTransaction(
				{
					signature,
					blockhash: latest.blockhash,
					lastValidBlockHeight: latest.lastValidBlockHeight
				},
				'confirmed'
			);

			createMessage = `Submitted create_order tx ${signature} (order ${nextOrderId.toString()}).`;
			counterPreview = buildCounterPreview(user, nextOrderId + 1n, true);

			try {
				await notifyCreateOrderSubmitted(signature);
			} catch {
				// backend notifier is optional for direct-create flow
			}

			await refreshOpenOrders();
			void refreshCounterPreview();
		} catch (err) {
			createError = err instanceof Error ? err.message : 'Create order failed';
		} finally {
			busy = false;
		}
	}

	$: checklistItems = [
		{ label: 'Wallet connected', ok: Boolean($walletAddress) },
		{ label: 'Funding valid', ok: hasValidFundingInputs() },
		{ label: 'Expiry slot valid', ok: hasValidExpiryInput() },
		{ label: 'Trigger configured', ok: hasValidTriggerInputs() },
		{ label: 'CPI action configured', ok: hasValidActionInputs() }
	];
	$: checklistComplete = checklistItems.every((item) => item.ok);

	$: if ($walletAddress && $walletAddress !== autoPreviewWallet) {
		autoPreviewWallet = $walletAddress;
		void refreshCounterPreview();
	}

	$: if (!$walletAddress && autoPreviewWallet) {
		autoPreviewWallet = '';
		counterPreview = null;
		previewError = '';
	}
</script>


<div class="grid gap-6 pb-32 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:pb-16">
	<div class="min-w-0 space-y-6">
		<header class="flex flex-wrap items-start justify-between gap-2">
			<h1 class="text-xl font-semibold tracking-tight">Create Order</h1>
		</header>

		<section class="space-y-3">
			<h2 class="text-base font-semibold tracking-tight">1. Funding</h2>
			<div class="grid gap-4 md:grid-cols-3">
				<Field.Field>
					<Field.Content>
						<Field.Label for="escrow-sol">Escrow Amount</Field.Label>
						<InputGroup.Root>
							<InputGroup.Input id="escrow-sol" bind:value={inputAmountSol} placeholder="0.01" />
							<InputGroup.Addon align="inline-end">
								<InputGroup.Text>SOL</InputGroup.Text>
							</InputGroup.Addon>
						</InputGroup.Root>
					</Field.Content>
				</Field.Field>
				<Field.Field>
					<Field.Content>
						<Field.Label for="bounty-sol">Execution Bounty</Field.Label>
						<InputGroup.Root>
							<InputGroup.Input id="bounty-sol" bind:value={executionBountySol} placeholder="0.001" />
							<InputGroup.Addon align="inline-end">
								<InputGroup.Text>SOL</InputGroup.Text>
							</InputGroup.Addon>
						</InputGroup.Root>
					</Field.Content>
				</Field.Field>
				<Field.Field>
					<Field.Content>
						<Field.Label for="expires-slot">Expires Slot</Field.Label>
						<InputGroup.Root>
							<InputGroup.Input
								id="expires-slot"
								bind:value={expiresSlot}
								placeholder="Leave empty for no expiry"
							/>
							<InputGroup.Addon align="inline-end">
								<InputGroup.Text>slot</InputGroup.Text>
							</InputGroup.Addon>
						</InputGroup.Root>
					</Field.Content>
				</Field.Field>
			</div>
		</section>

		<Separator />

		<section class="space-y-3">
			<div class="flex flex-wrap items-start justify-between gap-2">
				<h2 class="text-base font-semibold tracking-tight">2. Counter + PDA Preview</h2>
				<Button variant="outline" disabled={previewBusy || !$walletAddress} onclick={refreshCounterPreview}>
					<i class="ri-refresh-line text-base" aria-hidden="true"></i>
					{previewBusy ? 'Loading...' : 'Refresh Preview'}
				</Button>
			</div>

			{#if previewError}
				<Alert.Root variant="destructive">
					<Alert.Title>Preview Error</Alert.Title>
					<Alert.Description>{previewError}</Alert.Description>
				</Alert.Root>
			{/if}

			{#if counterPreview}
				<div class="space-y-3">
					<div class="text-sm text-muted-foreground">
						Counter {counterPreview.counterExists ? 'exists' : 'missing (init_user_counter will be added)'}.
						Next order id: {counterPreview.nextOrderId.toString()}
					</div>
					<div class="overflow-x-auto rounded-md border">
						<Table.Root>
							<Table.Header>
								<Table.Row>
									<Table.Head class="w-[14rem]">Derived PDA</Table.Head>
									<Table.Head>Address</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								<Table.Row>
									<Table.Cell>Order Counter PDA</Table.Cell>
									<Table.Cell class="font-mono text-xs break-all">{counterPreview.orderCounterPda}</Table.Cell>
								</Table.Row>
								<Table.Row>
									<Table.Cell>Order PDA (next)</Table.Cell>
									<Table.Cell class="font-mono text-xs break-all">{counterPreview.orderPda}</Table.Cell>
								</Table.Row>
								<Table.Row>
									<Table.Cell>Vault PDA (next)</Table.Cell>
									<Table.Cell class="font-mono text-xs break-all">{counterPreview.vaultPda}</Table.Cell>
								</Table.Row>
							</Table.Body>
						</Table.Root>
					</div>
				</div>
			{/if}
		</section>

		<Separator />

		<section class="space-y-3">
			<h2 class="text-base font-semibold tracking-tight">3. Trigger</h2>

			<div class="overflow-x-auto">
				<ButtonGroup.Root class="min-w-max">
					{#each triggerOptions as option}
						<Button
							variant={triggerKind === option.key ? 'default' : 'outline'}
							onclick={() => (triggerKind = option.key)}
						>
							{option.label}
						</Button>
					{/each}
				</ButtonGroup.Root>
			</div>

			{#if triggerKind === 'time_after'}
				<Field.Field>
					<Field.Content>
						<Field.Label for="trigger-time-after-slot">Trigger Slot</Field.Label>
						<InputGroup.Root>
							<InputGroup.Input
								id="trigger-time-after-slot"
								bind:value={triggerTimeAfterSlot}
								placeholder="Leave empty to use current slot at submit"
							/>
							<InputGroup.Addon align="inline-end">
								<InputGroup.Text>slot</InputGroup.Text>
							</InputGroup.Addon>
						</InputGroup.Root>
					</Field.Content>
				</Field.Field>
			{:else if triggerKind === 'pda_value_equals'}
				<div class="grid gap-4 md:grid-cols-2">
					<Field.Field>
						<Field.Content>
							<Field.Label for="trigger-pda-account">Account Pubkey</Field.Label>
							<Input
								id="trigger-pda-account"
								bind:value={triggerPdaAccount}
								placeholder="Keeper reads first 8 bytes as u64 (LE)"
							/>
						</Field.Content>
					</Field.Field>
					<Field.Field>
						<Field.Content>
							<Field.Label for="trigger-pda-expected">Expected Value</Field.Label>
							<InputGroup.Root>
								<InputGroup.Input id="trigger-pda-expected" bind:value={triggerPdaExpectedValue} placeholder="123" />
								<InputGroup.Addon align="inline-end">
									<InputGroup.Text>u64</InputGroup.Text>
								</InputGroup.Addon>
							</InputGroup.Root>
						</Field.Content>
					</Field.Field>
				</div>
			{:else}
				<div class="grid gap-4 md:grid-cols-3">
					<Field.Field class="md:col-span-3">
						<Field.Content>
							<Field.Label for="trigger-stork-feed">Stork Feed Id (32-byte hex)</Field.Label>
							<Input
								id="trigger-stork-feed"
								bind:value={triggerStorkFeedIdHex}
								placeholder="64 hex chars (optionally 0x-prefixed)"
							/>
						</Field.Content>
					</Field.Field>
					<Field.Field class="md:col-span-2">
						<Field.Content>
							<Field.Label for="trigger-stork-threshold">
							{triggerKind === 'price_below_stork'
								? 'Max Price Q (i128)'
								: triggerKind === 'price_above_stork'
									? 'Min Price Q (i128)'
									: 'Expected Outcome Q (i128)'}
							</Field.Label>
							<Input id="trigger-stork-threshold" bind:value={triggerStorkThresholdQ} placeholder="Quantized i128 value" />
						</Field.Content>
					</Field.Field>
					<Field.Field>
						<Field.Content>
							<Field.Label for="trigger-stork-max-age">Max Age</Field.Label>
							<InputGroup.Root>
								<InputGroup.Input id="trigger-stork-max-age" bind:value={triggerStorkMaxAgeSec} placeholder="30" />
								<InputGroup.Addon align="inline-end">
									<InputGroup.Text>sec</InputGroup.Text>
								</InputGroup.Addon>
							</InputGroup.Root>
						</Field.Content>
					</Field.Field>
				</div>
			{/if}
		</section>

		<Separator />

		<section class="space-y-3">
			<h2 class="text-base font-semibold tracking-tight">4. CPI Action</h2>

			<div class="overflow-x-auto">
				<ButtonGroup.Root class="min-w-max">
					{#each actionTemplateOptions as option}
						<Button
							variant={actionTemplate === option.key ? 'default' : 'outline'}
							onclick={() => (actionTemplate = option.key)}
						>
							{option.label}
						</Button>
					{/each}
				</ButtonGroup.Root>
			</div>

			{#if actionTemplate === 'system_transfer'}
				<div class="grid gap-4 md:grid-cols-3">
					<Field.Field class="md:col-span-2">
						<Field.Content>
							<Field.Label for="system-recipient">Recipient Pubkey</Field.Label>
							<Input id="system-recipient" bind:value={systemRecipient} placeholder="Destination wallet" />
						</Field.Content>
					</Field.Field>
					<Field.Field>
						<Field.Content>
							<Field.Label for="system-transfer-mode">Transfer Amount Source</Field.Label>
							<NativeSelect.Root id="system-transfer-mode" bind:value={systemTransferAmountMode}>
								<NativeSelect.Option value="escrow_minus_bounty">Escrow - Bounty</NativeSelect.Option>
								<NativeSelect.Option value="custom">Custom Lamports</NativeSelect.Option>
							</NativeSelect.Root>
						</Field.Content>
					</Field.Field>
					{#if systemTransferAmountMode === 'custom'}
						<Field.Field class="md:col-span-3">
							<Field.Content>
								<Field.Label for="system-transfer-lamports">Transfer Lamports</Field.Label>
								<InputGroup.Root>
									<InputGroup.Input
										id="system-transfer-lamports"
										bind:value={systemTransferLamports}
										placeholder="1000000"
									/>
									<InputGroup.Addon align="inline-end">
										<InputGroup.Text>lamports</InputGroup.Text>
									</InputGroup.Addon>
								</InputGroup.Root>
							</Field.Content>
						</Field.Field>
					{/if}
				</div>
			{:else if actionTemplate === 'spl_token_transfer'}
				<div class="space-y-4">
					<div class="grid gap-4 md:grid-cols-2">
						<Field.Field>
							<Field.Content>
								<Field.Label for="spl-source">Source Token Account</Field.Label>
								<Input id="spl-source" bind:value={splSourceTokenAccount} placeholder="Token account to debit" />
							</Field.Content>
						</Field.Field>
						<Field.Field>
							<Field.Content>
								<Field.Label for="spl-destination">Destination Token Account</Field.Label>
								<Input
									id="spl-destination"
									bind:value={splDestinationTokenAccount}
									placeholder="Token account to credit"
								/>
							</Field.Content>
						</Field.Field>
						<Field.Field>
							<Field.Content>
								<Field.Label for="spl-authority-pda">Authority PDA</Field.Label>
								<NativeSelect.Root id="spl-authority-pda" bind:value={splAuthorityPda}>
									<NativeSelect.Option value="vault_pda">Vault PDA signer</NativeSelect.Option>
									<NativeSelect.Option value="order_pda">Order PDA signer</NativeSelect.Option>
								</NativeSelect.Root>
							</Field.Content>
						</Field.Field>
						<Field.Field>
							<Field.Content>
								<Field.Label for="spl-amount-raw">Token Amount</Field.Label>
								<InputGroup.Root>
									<InputGroup.Input id="spl-amount-raw" bind:value={splTransferAmountRaw} placeholder="1000000" />
									<InputGroup.Addon align="inline-end">
										<InputGroup.Text>raw u64</InputGroup.Text>
									</InputGroup.Addon>
								</InputGroup.Root>
							</Field.Content>
						</Field.Field>
					</div>
				</div>
			{:else}
				<div class="space-y-4">
					<div class="grid gap-4 md:grid-cols-3">
						<Field.Field>
							<Field.Content>
								<Field.Label for="raw-program-id">Program Id</Field.Label>
								<Input id="raw-program-id" bind:value={rawProgramId} placeholder="Whitelisted program id" />
							</Field.Content>
						</Field.Field>
						<Field.Field>
							<Field.Content>
								<Field.Label for="raw-data-encoding">Instruction Data Encoding</Field.Label>
								<NativeSelect.Root id="raw-data-encoding" bind:value={rawDataEncoding}>
									<NativeSelect.Option value="hex">Hex</NativeSelect.Option>
									<NativeSelect.Option value="base64">Base64</NativeSelect.Option>
								</NativeSelect.Root>
							</Field.Content>
						</Field.Field>
						<Field.Field>
							<Field.Content>
								<Field.Label for="raw-data">Instruction Data</Field.Label>
								<Input
									id="raw-data"
									bind:value={rawInstructionData}
									placeholder={rawDataEncoding === 'hex' ? 'e.g. 0300...' : 'Base64 bytes'}
								/>
							</Field.Content>
						</Field.Field>
					</div>

					<div class="space-y-3">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<p class="text-sm font-medium">CPI Accounts</p>
							<Button size="sm" variant="outline" onclick={pushBlankRawAccount}>
								<i class="ri-add-line text-base" aria-hidden="true"></i>
								Add Account
							</Button>
						</div>

						<div class="overflow-x-auto rounded-md border">
							<Table.Root>
								<Table.Header>
									<Table.Row>
										<Table.Head class="w-[4.5rem]">#</Table.Head>
										<Table.Head class="w-[12rem]">Preset</Table.Head>
										<Table.Head>Account</Table.Head>
										<Table.Head class="w-[7rem]">Writable</Table.Head>
										<Table.Head class="w-[6rem] text-right">Remove</Table.Head>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{#each rawAccounts as account, index (index)}
										<Table.Row>
											<Table.Cell class="text-xs text-muted-foreground">#{index + 1}</Table.Cell>
											<Table.Cell>
												<NativeSelect.Root
													value={rawAccounts[index].preset}
													onchange={(event) =>
														setRawAccountPreset(
															index,
															(event.currentTarget as HTMLSelectElement).value as RawAccountPreset
														)}
												>
													<NativeSelect.Option value="">Custom</NativeSelect.Option>
													<NativeSelect.Option value="user">Wallet</NativeSelect.Option>
													<NativeSelect.Option value="order_pda" disabled={!counterPreview}>
														Order PDA
													</NativeSelect.Option>
													<NativeSelect.Option value="vault_pda" disabled={!counterPreview}>
														Vault PDA
													</NativeSelect.Option>
													<NativeSelect.Option value="system">System Program</NativeSelect.Option>
													<NativeSelect.Option value="spl">SPL Token Program</NativeSelect.Option>
												</NativeSelect.Root>
											</Table.Cell>
											<Table.Cell class="min-w-[18rem]">
												<Input
													id={`raw-account-${index}`}
													bind:value={rawAccounts[index].pubkey}
													placeholder="Pubkey"
												/>
											</Table.Cell>
											<Table.Cell>
												<div class="flex items-center">
													<Switch bind:checked={rawAccounts[index].isWritable} />
												</div>
											</Table.Cell>
											<Table.Cell class="text-right">
												<Button
													size="icon"
													variant="ghost"
													class="size-8 text-destructive hover:text-destructive"
													onclick={() => removeRawAccount(index)}
													disabled={rawAccounts.length === 1}
													aria-label={`Remove CPI account ${index + 1}`}
												>
													<i class="ri-delete-bin-line text-base" aria-hidden="true"></i>
												</Button>
											</Table.Cell>
										</Table.Row>
									{/each}
								</Table.Body>
							</Table.Root>
						</div>
					</div>
				</div>
			{/if}
		</section>
	</div>

	<aside class="lg:sticky lg:top-20">
		<div class="rounded-lg border bg-card text-card-foreground shadow-sm">
		  <div class="px-4 pt-4">
			<h3 class="mb-3 text-m font-semibold text-foreground ">Order Checklist</h3>
			<ul class="space-y-0.5">
			  {#each checklistItems as item}
				<li class="flex items-center gap-2.5 py-1.5">
				  <span class="inline-flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
					{#if item.ok}
					  <i class="ri-check-fill text-sm leading-none text-emerald-600"></i>
					{:else}
					  <i class="ri-circle-line text-sm leading-none text-muted-foreground"></i>
					{/if}
				  </span>
				  <span class="text-sm text-foreground">{item.label}</span>
				</li>
			  {/each}
			</ul>
		  </div>
	  
		  <div class="px-4 pb-4 pt-4">
			<Button class="w-full" onclick={createOrder} disabled={busy || !checklistComplete}>
			  {busy ? 'Submitting...' : 'Create Order'}
			</Button>
		  </div>
		</div>
	  
		{#if createMessage}
		  <Alert.Root class="mt-3">
			<Alert.Title>Order Submitted</Alert.Title>
			<Alert.Description>
			  <span class="break-all">{createMessage}</span>
			</Alert.Description>
		  </Alert.Root>
		{/if}
	  
		{#if createError}
		  <Alert.Root variant="destructive" class="mt-3">
			<Alert.Title>Create Order Error</Alert.Title>
			<Alert.Description>{createError}</Alert.Description>
		  </Alert.Root>
		{/if}
	  </aside>
</div>

<div class="fixed inset-x-4 bottom-4 z-20 lg:hidden">
	<div class="rounded-lg border bg-background p-3 shadow-sm">
		<Button class="w-full" onclick={createOrder} disabled={busy || !checklistComplete}>
			{busy ? 'Submitting...' : 'Create Order'}
		</Button>
	</div>
</div>
