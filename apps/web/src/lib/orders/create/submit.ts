import { PublicKey, Transaction } from '@solana/web3.js';
import {
	buildCreateOrderInstruction,
	buildInitUserCounterInstruction,
	deriveOrderPda,
	deriveVaultPda,
	fetchUserOrderCounterState
} from '$lib/order-executor';
import { buildActionInput, buildTriggerInput } from './build';
import type {
	CreateOrderParsedInput,
	CreateOrderSubmissionResult,
	CreateOrderSubmitDependencies,
	CreateOrderSubmitError,
	CreateOrderSubmitErrorCode,
	CreateOrderSubmitProgressState,
	PendingOrderContext
} from './types';

function createSubmitError(code: CreateOrderSubmitErrorCode, message: string): CreateOrderSubmitError {
	return { code, message };
}

function asErrorMessage(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
}

function isWalletRejected(error: unknown): boolean {
	const message = asErrorMessage(error, '').toLowerCase();
	return (
		message.includes('rejected') ||
		message.includes('declined') ||
		message.includes('user denied') ||
		message.includes('user rejected')
	);
}

export async function submitCreateOrder(
	parsed: CreateOrderParsedInput,
	deps: CreateOrderSubmitDependencies
): Promise<CreateOrderSubmissionResult> {
	const { connection, programId, walletAddress, walletProvider, onProgress } = deps;

	if (!walletAddress) {
		throw createSubmitError('wallet_not_connected', 'Connect a wallet from the nav bar first.');
	}
	if (!walletProvider) {
		throw createSubmitError('wallet_provider_missing', 'Wallet provider is not available in the browser.');
	}

		const setProgress = (state: CreateOrderSubmitProgressState) => {
			onProgress?.(state);
		};

	try {
		setProgress('building');

		const user = new PublicKey(walletAddress);
		const counter = await fetchUserOrderCounterState(connection, user, programId);
		const nextOrderId = counter.nextOrderId;
		const [orderPda] = deriveOrderPda(user, nextOrderId, programId);
		const [vaultPda] = deriveVaultPda(user, nextOrderId, programId);

		const pendingCtx: PendingOrderContext = {
			user,
			nextOrderId,
			orderPda,
			vaultPda,
			inputAmountLamports: parsed.inputAmountLamports,
			executionBountyLamports: parsed.executionBountyLamports
		};

		const trigger = await buildTriggerInput(connection, parsed);
		const action = buildActionInput(parsed, pendingCtx, programId);

		const tx = new Transaction();
		if (!counter.exists) {
			tx.add(buildInitUserCounterInstruction(user, programId).instruction);
		}

		tx.add(
			buildCreateOrderInstruction({
				user,
				nextOrderId,
				inputAmountLamports: parsed.inputAmountLamports,
				trigger,
				action,
				expiresSlot: parsed.expiresSlot,
				executionBountyLamports: parsed.executionBountyLamports,
				programId
			}).instruction
		);

		const latest = await connection.getLatestBlockhash('confirmed');
		tx.feePayer = user;
		tx.recentBlockhash = latest.blockhash;

		setProgress('awaiting_wallet_signature');
		let signed: Transaction;
		try {
			signed = await walletProvider.signTransaction(tx);
		} catch (error) {
			throw createSubmitError(
				isWalletRejected(error) ? 'wallet_rejected_signature' : 'unknown_error',
				asErrorMessage(error, 'Wallet signature was rejected.')
			);
		}

		setProgress('submitting');
		let signature: string;
		try {
			signature = await connection.sendRawTransaction(signed.serialize());
		} catch (error) {
			throw createSubmitError('rpc_send_failed', asErrorMessage(error, 'Failed to submit transaction.'));
		}

		setProgress('confirming');
		try {
			await connection.confirmTransaction(
				{
					signature,
					blockhash: latest.blockhash,
					lastValidBlockHeight: latest.lastValidBlockHeight
				},
				'confirmed'
			);
		} catch (error) {
			throw createSubmitError('rpc_confirm_timeout', asErrorMessage(error, 'Transaction confirmation failed.'));
		}

		setProgress('success');
		return {
			signature,
			orderId: nextOrderId.toString(),
			orderPda: orderPda.toBase58(),
			vaultPda: vaultPda.toBase58(),
			counterWasInitialized: !counter.exists
		};
	} catch (error) {
		if (isCreateOrderSubmitError(error)) {
			setProgress('error');
			throw error;
		}
		setProgress('error');
		throw createSubmitError('program_error', asErrorMessage(error, 'Create order failed.'));
	}
}

export function isCreateOrderSubmitError(error: unknown): error is CreateOrderSubmitError {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		'message' in error
	);
}
