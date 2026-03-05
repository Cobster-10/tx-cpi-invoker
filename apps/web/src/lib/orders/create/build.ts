import { Connection, PublicKey } from '@solana/web3.js';
import {
	SPL_TOKEN_PROGRAM_ID,
	buildSystemTransferAction,
	isWhitelistedProgram,
	type CpiActionInput,
	type TriggerInput
} from '$lib/order-executor';
import type { CreateOrderParsedInput, PendingOrderContext } from './types';

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
	out[0] = 3;
	out.set(u64ToLeBytes(amount), 1);
	return out;
}

export async function buildTriggerInput(
	connection: Connection,
	parsed: CreateOrderParsedInput
): Promise<TriggerInput> {
	switch (parsed.trigger.kind) {
		case 'time_after': {
			const slot = parsed.trigger.slot ?? BigInt(await connection.getSlot('confirmed'));
			return { kind: 'time_after', slot };
		}
		case 'pda_value_equals':
			return {
				kind: 'pda_value_equals',
				account: new PublicKey(parsed.trigger.account),
				expectedValue: parsed.trigger.expectedValue
			};
		case 'price_below_stork':
			return {
				kind: 'price_below_stork',
				feedId: parsed.trigger.feedId,
				maxPriceQ: parsed.trigger.maxPriceQ,
				maxAgeSec: parsed.trigger.maxAgeSec
			};
		case 'price_above_stork':
			return {
				kind: 'price_above_stork',
				feedId: parsed.trigger.feedId,
				minPriceQ: parsed.trigger.minPriceQ,
				maxAgeSec: parsed.trigger.maxAgeSec
			};
		case 'stork_outcome_equals':
			return {
				kind: 'stork_outcome_equals',
				feedId: parsed.trigger.feedId,
				expectedOutcomeQ: parsed.trigger.expectedOutcomeQ,
				maxAgeSec: parsed.trigger.maxAgeSec
			};
	}
}

export function buildActionInput(
	parsed: CreateOrderParsedInput,
	ctx: PendingOrderContext,
	programId: PublicKey
): CpiActionInput {
	switch (parsed.action.kind) {
		case 'system_transfer': {
			const recipient = new PublicKey(parsed.action.recipient);
			let lamports: bigint;

			if (parsed.action.amountMode === 'escrow_minus_bounty') {
				lamports = ctx.inputAmountLamports - ctx.executionBountyLamports;
				if (lamports <= 0n) {
					throw new Error('Escrow minus bounty must be greater than 0 for a system transfer action.');
				}
			} else {
				if (parsed.action.customLamports === null) {
					throw new Error('Transfer lamports is required.');
				}
				lamports = parsed.action.customLamports;
			}

			return buildSystemTransferAction({
				user: ctx.user,
				orderId: ctx.nextOrderId,
				recipient,
				lamports,
				programId
			});
		}

		case 'spl_token_transfer': {
			const source = new PublicKey(parsed.action.sourceTokenAccount);
			const destination = new PublicKey(parsed.action.destinationTokenAccount);
			const authority = parsed.action.authorityPda === 'order_pda' ? ctx.orderPda : ctx.vaultPda;

			return {
				programId: SPL_TOKEN_PROGRAM_ID,
				accounts: [
					{ pubkey: source, isWritable: true },
					{ pubkey: destination, isWritable: true },
					{ pubkey: authority, isWritable: false }
				],
				data: buildSplTokenTransferInstructionData(parsed.action.amountRaw)
			};
		}

		case 'raw_cpi': {
			const rawProgram = new PublicKey(parsed.action.programId);
			if (!isWhitelistedProgram(rawProgram)) {
				throw new Error(
					'Program is not whitelisted on-chain. Current whitelist supports only System Program and SPL Token Program.'
				);
			}

			return {
				programId: rawProgram,
				accounts: parsed.action.accounts.map((account) => ({
					pubkey: new PublicKey(account.pubkey),
					isWritable: account.isWritable
				})),
				data: parsed.action.data
			};
		}
	}
}
