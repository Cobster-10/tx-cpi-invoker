import type { PublicKey } from '@solana/web3.js';

export type TriggerKind =
	| 'time_after'
	| 'pda_value_equals'
	| 'price_below_stork'
	| 'price_above_stork'
	| 'stork_outcome_equals';

export type ActionTemplate = 'system_transfer' | 'spl_token_transfer' | 'raw_cpi';
export type DataEncoding = 'hex' | 'base64';
export type SplAuthorityPda = 'order_pda' | 'vault_pda';
export type SystemTransferAmountMode = 'escrow_minus_bounty' | 'custom';
export type RawAccountPreset = '' | 'user' | 'order_pda' | 'vault_pda' | 'system' | 'spl';

export type RawAccountRow = {
	pubkey: string;
	isWritable: boolean;
	preset: RawAccountPreset;
};

export type CreateOrderFormState = {
	inputAmountSol: string;
	executionBountySol: string;
	expiresSlot: string;
	triggerKind: TriggerKind;
	triggerTimeAfterSlot: string;
	triggerPdaAccount: string;
	triggerPdaExpectedValue: string;
	triggerStorkFeedIdHex: string;
	triggerStorkThresholdQ: string;
	triggerStorkMaxAgeSec: string;
	actionTemplate: ActionTemplate;
	systemRecipient: string;
	systemTransferAmountMode: SystemTransferAmountMode;
	systemTransferLamports: string;
	splSourceTokenAccount: string;
	splDestinationTokenAccount: string;
	splAuthorityPda: SplAuthorityPda;
	splTransferAmountRaw: string;
	rawProgramId: string;
	rawDataEncoding: DataEncoding;
	rawInstructionData: string;
	rawAccounts: RawAccountRow[];
};

export type ParsedTrigger =
	| { kind: 'time_after'; slot: bigint | null }
	| { kind: 'pda_value_equals'; account: string; expectedValue: bigint }
	| { kind: 'price_below_stork'; feedId: Uint8Array; maxPriceQ: bigint; maxAgeSec: bigint }
	| { kind: 'price_above_stork'; feedId: Uint8Array; minPriceQ: bigint; maxAgeSec: bigint }
	| { kind: 'stork_outcome_equals'; feedId: Uint8Array; expectedOutcomeQ: bigint; maxAgeSec: bigint };

export type ParsedAction =
	| {
			kind: 'system_transfer';
			recipient: string;
			amountMode: SystemTransferAmountMode;
			customLamports: bigint | null;
	  }
	| {
			kind: 'spl_token_transfer';
			sourceTokenAccount: string;
			destinationTokenAccount: string;
			authorityPda: SplAuthorityPda;
			amountRaw: bigint;
	  }
	| {
			kind: 'raw_cpi';
			programId: string;
			dataEncoding: DataEncoding;
			data: Uint8Array;
			accounts: Array<{ pubkey: string; isWritable: boolean }>;
	  };

export type CreateOrderParsedInput = {
	inputAmountLamports: bigint;
	executionBountyLamports: bigint;
	expiresSlot: bigint | null;
	trigger: ParsedTrigger;
	action: ParsedAction;
};

export type CreateOrderFieldErrors = Record<string, string[]>;

export type CreateOrderValidationSections = {
	funding: boolean;
	expiry: boolean;
	trigger: boolean;
	action: boolean;
};

export type ValidationResult =
	| {
			ok: true;
			fieldErrors: CreateOrderFieldErrors;
			sections: CreateOrderValidationSections;
	  }
	| {
			ok: false;
			fieldErrors: CreateOrderFieldErrors;
			sections: CreateOrderValidationSections;
			message?: string;
	  };

export type ParsedResult =
	| { success: true; data: CreateOrderParsedInput }
	| { success: false; fieldErrors: CreateOrderFieldErrors; message?: string };

export type CreateOrderSubmitProgressState =
	| 'idle'
	| 'validating'
	| 'building'
	| 'awaiting_wallet_signature'
	| 'submitting'
	| 'confirming'
	| 'success'
	| 'error';

export type CreateOrderSubmitErrorCode =
	| 'wallet_not_connected'
	| 'wallet_provider_missing'
	| 'wallet_rejected_signature'
	| 'rpc_send_failed'
	| 'rpc_confirm_timeout'
	| 'program_error'
	| 'unknown_error';

export type CreateOrderSubmissionResult = {
	signature: string;
	orderId: string;
	orderPda: string;
	vaultPda: string;
	counterWasInitialized: boolean;
};

export type CreateOrderSubmitError = {
	code: CreateOrderSubmitErrorCode;
	message: string;
	fieldErrors?: CreateOrderFieldErrors;
};

export type CreateOrderSubmitDependencies = {
	connection: import('@solana/web3.js').Connection;
	programId: PublicKey;
	walletAddress: string;
	walletProvider: {
		signTransaction(
			tx: import('@solana/web3.js').Transaction
		): Promise<import('@solana/web3.js').Transaction>;
	};
	onProgress?: (state: CreateOrderSubmitProgressState) => void;
};

export type PendingOrderContext = {
	user: PublicKey;
	nextOrderId: bigint;
	orderPda: PublicKey;
	vaultPda: PublicKey;
	inputAmountLamports: bigint;
	executionBountyLamports: bigint;
};

