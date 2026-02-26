import {
	Connection,
	PublicKey,
	SystemProgram,
	TransactionInstruction,
	type AccountInfo
} from '@solana/web3.js';
import { ORDER_EXECUTOR_PROGRAM_ID } from '$lib/config';

const INIT_USER_COUNTER_DISCRIMINATOR = hexToBytes('6f96eeea46766025');
const CREATE_ORDER_DISCRIMINATOR = hexToBytes('8d3625cfedd2fad7');
const USER_COUNTER_ACCOUNT_DISCRIMINATOR = hexToBytes('509b0cbc4209e4d4');
const TEXT_ENCODER = new TextEncoder();

export const SPL_TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

export type CounterState = {
	exists: boolean;
	pda: PublicKey;
	nextOrderId: bigint;
	openOrderCount: bigint;
};

export type TriggerInput =
	| { kind: 'time_after'; slot: bigint }
	| { kind: 'pda_value_equals'; account: PublicKey; expectedValue: bigint }
	| { kind: 'price_below_stork'; feedId: Uint8Array; maxPriceQ: bigint; maxAgeSec: bigint }
	| { kind: 'price_above_stork'; feedId: Uint8Array; minPriceQ: bigint; maxAgeSec: bigint }
	| {
			kind: 'stork_outcome_equals';
			feedId: Uint8Array;
			expectedOutcomeQ: bigint;
			maxAgeSec: bigint;
	  };

export type CpiActionInput = {
	programId: PublicKey;
	accounts: Array<{ pubkey: PublicKey; isWritable: boolean }>;
	data: Uint8Array;
};

export type CreateOrderInstructionInput = {
	user: PublicKey;
	nextOrderId: bigint;
	inputAmountLamports: bigint;
	trigger: TriggerInput;
	action: CpiActionInput;
	expiresSlot: bigint | null;
	executionBountyLamports: bigint;
	programId?: PublicKey;
};

export type CreateOrderInstructionBuild = {
	instruction: TransactionInstruction;
	orderCounterPda: PublicKey;
	orderPda: PublicKey;
	vaultPda: PublicKey;
};

export function getOrderExecutorProgramId(): PublicKey {
	return new PublicKey(ORDER_EXECUTOR_PROGRAM_ID);
}

export function isWhitelistedProgram(programId: PublicKey): boolean {
	return programId.equals(SystemProgram.programId) || programId.equals(SPL_TOKEN_PROGRAM_ID);
}

export function deriveUserOrderCounterPda(
	user: PublicKey,
	programId = getOrderExecutorProgramId()
): [PublicKey, number] {
	return PublicKey.findProgramAddressSync([TEXT_ENCODER.encode('order_counter'), user.toBuffer()], programId);
}

export function deriveOrderPda(
	user: PublicKey,
	orderId: bigint,
	programId = getOrderExecutorProgramId()
): [PublicKey, number] {
	return PublicKey.findProgramAddressSync(
		[TEXT_ENCODER.encode('order'), user.toBuffer(), u64ToBytes(orderId)],
		programId
	);
}

export function deriveVaultPda(
	user: PublicKey,
	orderId: bigint,
	programId = getOrderExecutorProgramId()
): [PublicKey, number] {
	return PublicKey.findProgramAddressSync(
		[TEXT_ENCODER.encode('vault'), user.toBuffer(), u64ToBytes(orderId)],
		programId
	);
}

export async function fetchUserOrderCounterState(
	connection: Connection,
	user: PublicKey,
	programId = getOrderExecutorProgramId()
): Promise<CounterState> {
	const [pda] = deriveUserOrderCounterPda(user, programId);
	const account = await connection.getAccountInfo(pda);

	if (!account) {
		return { exists: false, pda, nextOrderId: 0n, openOrderCount: 0n };
	}

	validateUserCounterAccount(account, user, programId);

	return {
		exists: true,
		pda,
		nextOrderId: readU64(account.data, 40),
		openOrderCount: readU64(account.data, 48)
	};
}

export function buildInitUserCounterInstruction(
	user: PublicKey,
	programId = getOrderExecutorProgramId()
): { instruction: TransactionInstruction; orderCounterPda: PublicKey } {
	const [orderCounterPda] = deriveUserOrderCounterPda(user, programId);

	const instruction = new TransactionInstruction({
		programId,
		keys: [
			{ pubkey: user, isSigner: true, isWritable: true },
			{ pubkey: orderCounterPda, isSigner: false, isWritable: true },
			{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
		],
		data: Uint8Array.from(INIT_USER_COUNTER_DISCRIMINATOR) as unknown as Buffer
	});

	return { instruction, orderCounterPda };
}

export function buildCreateOrderInstruction(
	input: CreateOrderInstructionInput
): CreateOrderInstructionBuild {
	const programId = input.programId ?? getOrderExecutorProgramId();
	const [orderCounterPda] = deriveUserOrderCounterPda(input.user, programId);
	const [orderPda] = deriveOrderPda(input.user, input.nextOrderId, programId);
	const [vaultPda] = deriveVaultPda(input.user, input.nextOrderId, programId);

	const data = concatBytes(CREATE_ORDER_DISCRIMINATOR, encodeCreateOrderArgs(input));

	const instruction = new TransactionInstruction({
		programId,
		keys: [
			{ pubkey: input.user, isSigner: true, isWritable: true },
			{ pubkey: orderCounterPda, isSigner: false, isWritable: true },
			{ pubkey: orderPda, isSigner: false, isWritable: true },
			{ pubkey: vaultPda, isSigner: false, isWritable: true },
			{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
		],
		data: data as unknown as Buffer
	});

	return { instruction, orderCounterPda, orderPda, vaultPda };
}

export function buildSystemTransferAction(args: {
	user: PublicKey;
	orderId: bigint;
	recipient: PublicKey;
	lamports: bigint;
	programId?: PublicKey;
}): CpiActionInput {
	if (args.lamports < 0n || args.lamports > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new Error('System transfer lamports must fit in a JS number');
	}

	const [vaultPda] = deriveVaultPda(args.user, args.orderId, args.programId ?? getOrderExecutorProgramId());
	const ix = SystemProgram.transfer({
		fromPubkey: vaultPda,
		toPubkey: args.recipient,
		lamports: Number(args.lamports)
	});

	return {
		programId: SystemProgram.programId,
		accounts: [
			{ pubkey: vaultPda, isWritable: true },
			{ pubkey: args.recipient, isWritable: true }
		],
		data: ix.data
	};
}

function validateUserCounterAccount(
	account: AccountInfo<Uint8Array>,
	user: PublicKey,
	programId: PublicKey
): void {
	if (!account.owner.equals(programId)) throw new Error('order_counter account owner mismatch');
	if (account.data.length < 56) throw new Error('order_counter account data too small');
	if (!bytesEqual(account.data.subarray(0, 8), USER_COUNTER_ACCOUNT_DISCRIMINATOR)) {
		throw new Error('order_counter discriminator mismatch');
	}

	const storedUser = new PublicKey(account.data.subarray(8, 40));
	if (!storedUser.equals(user)) throw new Error('order_counter user mismatch');
}

function encodeCreateOrderArgs(input: CreateOrderInstructionInput): Uint8Array {
	return concatBytes(
		u64ToBytes(input.inputAmountLamports),
		encodeTrigger(input.trigger),
		encodeCpiAction(input.action),
		encodeOptionU64(input.expiresSlot),
		u64ToBytes(input.executionBountyLamports)
	);
}

function encodeTrigger(trigger: TriggerInput): Uint8Array {
	switch (trigger.kind) {
		case 'time_after':
			return concatBytes(Uint8Array.of(0), u64ToBytes(trigger.slot));
		case 'pda_value_equals':
			return concatBytes(Uint8Array.of(1), trigger.account.toBytes(), u64ToBytes(trigger.expectedValue));
		case 'price_below_stork':
			return concatBytes(
				Uint8Array.of(2),
				assertFeedId(trigger.feedId),
				i128ToBytes(trigger.maxPriceQ),
				u64ToBytes(trigger.maxAgeSec)
			);
		case 'price_above_stork':
			return concatBytes(
				Uint8Array.of(3),
				assertFeedId(trigger.feedId),
				i128ToBytes(trigger.minPriceQ),
				u64ToBytes(trigger.maxAgeSec)
			);
		case 'stork_outcome_equals':
			return concatBytes(
				Uint8Array.of(4),
				assertFeedId(trigger.feedId),
				i128ToBytes(trigger.expectedOutcomeQ),
				u64ToBytes(trigger.maxAgeSec)
			);
	}
}

function encodeCpiAction(action: CpiActionInput): Uint8Array {
	if (action.accounts.length > 32) throw new Error('CPI action supports at most 32 accounts');
	if (action.data.length > 512) throw new Error('CPI action data exceeds 512 bytes');

	return concatBytes(
		action.programId.toBytes(),
		encodeVec(
			action.accounts.map((account) =>
				concatBytes(account.pubkey.toBytes(), Uint8Array.of(account.isWritable ? 1 : 0))
			)
		),
		encodeVec([Uint8Array.from(action.data)], true)
	);
}

function encodeVec(items: Uint8Array[], rawBytes = false): Uint8Array {
	if (rawBytes) {
		const bytes = items[0] ?? new Uint8Array();
		return concatBytes(u32ToBytes(bytes.length), bytes);
	}

	return concatBytes(u32ToBytes(items.length), ...items);
}

function encodeOptionU64(value: bigint | null): Uint8Array {
	return value == null ? Uint8Array.of(0) : concatBytes(Uint8Array.of(1), u64ToBytes(value));
}

function readU64(buffer: Uint8Array, offset: number): bigint {
	let value = 0n;
	for (let i = 0; i < 8; i += 1) value |= BigInt(buffer[offset + i] ?? 0) << BigInt(8 * i);
	return value;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i += 1) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

function assertFeedId(feedId: Uint8Array): Uint8Array {
	if (feedId.length !== 32) throw new Error('Stork feed id must be 32 bytes');
	return feedId;
}

function u32ToBytes(value: number): Uint8Array {
	if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
		throw new Error('u32 out of range');
	}
	const out = new Uint8Array(4);
	let n = value >>> 0;
	for (let i = 0; i < 4; i += 1) {
		out[i] = n & 0xff;
		n >>>= 8;
	}
	return out;
}

function u64ToBytes(value: bigint): Uint8Array {
	const max = (1n << 64n) - 1n;
	if (value < 0n || value > max) throw new Error('u64 out of range');
	const out = new Uint8Array(8);
	let n = value;
	for (let i = 0; i < 8; i += 1) {
		out[i] = Number(n & 0xffn);
		n >>= 8n;
	}
	return out;
}

function i128ToBytes(value: bigint): Uint8Array {
	const min = -(1n << 127n);
	const max = (1n << 127n) - 1n;
	if (value < min || value > max) throw new Error('i128 out of range');

	let n = value;
	if (n < 0n) n = (1n << 128n) + n;

	const out = new Uint8Array(16);
	for (let i = 0; i < 16; i += 1) {
		out[i] = Number(n & 0xffn);
		n >>= 8n;
	}
	return out;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

function hexToBytes(hex: string): Uint8Array {
	const normalized = hex.trim().toLowerCase().replace(/^0x/, '');
	if (normalized.length % 2 !== 0) throw new Error('Invalid hex length');
	const out = new Uint8Array(normalized.length / 2);
	for (let i = 0; i < out.length; i += 1) {
		const byte = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
		if (Number.isNaN(byte)) throw new Error('Invalid hex');
		out[i] = byte;
	}
	return out;
}
