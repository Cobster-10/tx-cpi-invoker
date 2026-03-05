import { PublicKey } from '@solana/web3.js';
import {
	CreateOrderFormSchema,
	CreateOrderParsedSchema,
	feedIdHexSchema,
	i128StringSchema,
	optionalU64StringSchema,
	pubkeyStringSchema,
	solAmountStringSchema,
	u64StringSchema,
	defaultValidationSections
} from './schemas';
import type {
	CreateOrderFieldErrors,
	CreateOrderFormState,
	CreateOrderParsedInput,
	CreateOrderValidationSections,
	ParsedResult,
	ValidationResult
} from './types';
import { isWhitelistedProgram } from '$lib/order-executor';

const U64_MAX = (1n << 64n) - 1n;
const I128_MIN = -(1n << 127n);
const I128_MAX = (1n << 127n) - 1n;
const LAMPORTS_PER_SOL = 1_000_000_000n;

type ParseDeps = {
	currentSlot?: bigint;
};

function addError(errors: CreateOrderFieldErrors, key: string, message: string): void {
	if (!errors[key]) errors[key] = [];
	if (!errors[key].includes(message)) errors[key].push(message);
}

function pathToKey(path: PropertyKey[]): string {
	if (path.length === 0) return 'form';
	return path
		.map((segment) => (typeof segment === 'number' ? String(segment) : String(segment)))
		.join('.');
}

function appendZodErrors(
	errors: CreateOrderFieldErrors,
	issueSource: { issues: Array<{ path: PropertyKey[]; message: string }> }
): void {
	for (const issue of issueSource.issues) {
		addError(errors, pathToKey(issue.path), issue.message);
	}
}

function parseU64(value: string, key: string, errors: CreateOrderFieldErrors, options?: { allowEmpty?: boolean; allowZero?: boolean }): bigint | null {
	const trimmed = value.trim();
	const check = options?.allowEmpty ? optionalU64StringSchema.safeParse(trimmed) : u64StringSchema.safeParse(trimmed);
	if (!check.success) {
		addError(errors, key, check.error.issues[0]?.message ?? 'Invalid unsigned integer.');
		return null;
	}
	if (trimmed === '') return null;
	const parsed = BigInt(trimmed);
	if (parsed > U64_MAX) {
		addError(errors, key, 'Value exceeds u64 range.');
		return null;
	}
	if (!options?.allowZero && parsed === 0n) {
		addError(errors, key, 'Value must be greater than 0.');
		return null;
	}
	return parsed;
}

function parseI128(value: string, key: string, errors: CreateOrderFieldErrors): bigint | null {
	const trimmed = value.trim();
	const check = i128StringSchema.safeParse(trimmed);
	if (!check.success) {
		addError(errors, key, check.error.issues[0]?.message ?? 'Invalid integer.');
		return null;
	}
	const parsed = BigInt(trimmed);
	if (parsed < I128_MIN || parsed > I128_MAX) {
		addError(errors, key, 'Value exceeds i128 range.');
		return null;
	}
	return parsed;
}

function parseSolToLamports(
	value: string,
	key: string,
	errors: CreateOrderFieldErrors,
	options?: { allowZero?: boolean }
): bigint | null {
	const trimmed = value.trim();
	const check = solAmountStringSchema.safeParse(trimmed);
	if (!check.success) {
		addError(errors, key, check.error.issues[0]?.message ?? 'Invalid SOL amount.');
		return null;
	}
	const match = trimmed.match(/^(\d+)(?:\.(\d{0,9}))?$/);
	if (!match) {
		addError(errors, key, 'Invalid SOL amount.');
		return null;
	}
	const whole = BigInt(match[1]);
	const fractionalText = (match[2] ?? '').padEnd(9, '0');
	const fractional = fractionalText ? BigInt(fractionalText) : 0n;
	const lamports = whole * LAMPORTS_PER_SOL + fractional;
	if (!options?.allowZero && lamports <= 0n) {
		addError(errors, key, 'Amount must be greater than 0.');
		return null;
	}
	if (options?.allowZero && lamports < 0n) {
		addError(errors, key, 'Amount must be >= 0.');
		return null;
	}
	return lamports;
}

function parsePubkeyString(value: string, key: string, errors: CreateOrderFieldErrors): string | null {
	const trimmed = value.trim();
	const base = pubkeyStringSchema.safeParse(trimmed);
	if (!base.success) {
		addError(errors, key, base.error.issues[0]?.message ?? 'Required.');
		return null;
	}
	try {
		new PublicKey(trimmed);
		return trimmed;
	} catch {
		addError(errors, key, 'Must be a valid Solana public key.');
		return null;
	}
}

function parseHexBytes(value: string, key: string, errors: CreateOrderFieldErrors): Uint8Array | null {
	const normalized = value.trim().replace(/^0x/i, '').replace(/\s+/g, '');
	if (normalized === '') return new Uint8Array();
	if (normalized.length % 2 !== 0) {
		addError(errors, key, 'Hex must be even length.');
		return null;
	}
	if (!/^[0-9a-fA-F]+$/.test(normalized)) {
		addError(errors, key, 'Hex contains invalid characters.');
		return null;
	}
	const out = new Uint8Array(normalized.length / 2);
	for (let i = 0; i < out.length; i += 1) {
		out[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
}

function parseBase64Bytes(value: string, key: string, errors: CreateOrderFieldErrors): Uint8Array | null {
	const trimmed = value.trim();
	if (!trimmed) return new Uint8Array();
	try {
		if (typeof atob === 'function') {
			const binary = atob(trimmed);
			const out = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
			return out;
		}
		throw new Error('base64 decoding unavailable');
	} catch {
		addError(errors, key, 'Must be valid base64.');
		return null;
	}
}

function parseFeedIdHex(value: string, key: string, errors: CreateOrderFieldErrors): Uint8Array | null {
	const check = feedIdHexSchema.safeParse(value);
	if (!check.success) {
		addError(errors, key, check.error.issues[0]?.message ?? 'Invalid feed id.');
		return null;
	}
	const bytes = parseHexBytes(value, key, errors);
	if (!bytes) return null;
	if (bytes.length !== 32) {
		addError(errors, key, 'Must be exactly 32 bytes (64 hex chars).');
		return null;
	}
	if (bytes.every((b) => b === 0)) {
		addError(errors, key, 'Feed id cannot be all zeros.');
		return null;
	}
	return bytes;
}

function classifySections(fieldErrors: CreateOrderFieldErrors): CreateOrderValidationSections {
	const sections = defaultValidationSections();
	const keys = Object.keys(fieldErrors);
	const hasGroupError = (pred: (key: string) => boolean) => keys.some(pred);

	sections.funding = !hasGroupError((key) =>
		['inputAmountSol', 'executionBountySol'].includes(key)
	);
	sections.expiry = !hasGroupError((key) => key === 'expiresSlot');
	sections.trigger = !hasGroupError((key) => key.startsWith('trigger'));
	sections.action = !hasGroupError((key) =>
		key.startsWith('system') ||
		key.startsWith('spl') ||
		key.startsWith('raw') ||
		key.startsWith('action') ||
		key.startsWith('rawAccounts')
	);

	return sections;
}

export function firstFieldError(errors: CreateOrderFieldErrors): string | undefined {
	for (const key of Object.keys(errors)) {
		const message = errors[key]?.[0];
		if (message) return message;
	}
	return undefined;
}

export function validateCreateOrderForm(form: CreateOrderFormState): ValidationResult {
	const parsed = parseCreateOrderForm(form);
	if (parsed.success) {
		return { ok: true, fieldErrors: {}, sections: { funding: true, expiry: true, trigger: true, action: true } };
	}
	return {
		ok: false,
		fieldErrors: parsed.fieldErrors,
		sections: classifySections(parsed.fieldErrors),
		message: parsed.message
	};
}

export function parseCreateOrderForm(form: CreateOrderFormState, _deps?: ParseDeps): ParsedResult {
	const fieldErrors: CreateOrderFieldErrors = {};

	const formCheck = CreateOrderFormSchema.safeParse(form);
	if (!formCheck.success) {
		appendZodErrors(fieldErrors, formCheck.error);
		return {
			success: false,
			fieldErrors,
			message: firstFieldError(fieldErrors) ?? 'Invalid form input.'
		};
	}

	const inputAmountLamports = parseSolToLamports(form.inputAmountSol, 'inputAmountSol', fieldErrors);
	const executionBountyLamports = parseSolToLamports(
		form.executionBountySol,
		'executionBountySol',
		fieldErrors,
		{ allowZero: true }
	);
	const expiresSlot = parseU64(form.expiresSlot, 'expiresSlot', fieldErrors, {
		allowEmpty: true,
		allowZero: false
	});

	let trigger: CreateOrderParsedInput['trigger'] | null = null;
	if (form.triggerKind === 'time_after') {
		const slot = parseU64(form.triggerTimeAfterSlot, 'triggerTimeAfterSlot', fieldErrors, {
			allowEmpty: true,
			allowZero: false
		});
		trigger = { kind: 'time_after', slot };
	} else if (form.triggerKind === 'pda_value_equals') {
		const account = parsePubkeyString(form.triggerPdaAccount, 'triggerPdaAccount', fieldErrors);
		const expectedValue = parseU64(form.triggerPdaExpectedValue, 'triggerPdaExpectedValue', fieldErrors);
		if (account && expectedValue !== null) {
			trigger = { kind: 'pda_value_equals', account, expectedValue };
		}
	} else {
		const feedId = parseFeedIdHex(form.triggerStorkFeedIdHex, 'triggerStorkFeedIdHex', fieldErrors);
		const threshold = parseI128(form.triggerStorkThresholdQ, 'triggerStorkThresholdQ', fieldErrors);
		const maxAgeSec = parseU64(form.triggerStorkMaxAgeSec, 'triggerStorkMaxAgeSec', fieldErrors);
		if (feedId && threshold !== null && maxAgeSec !== null) {
			if (form.triggerKind === 'price_below_stork') {
				trigger = { kind: 'price_below_stork', feedId, maxPriceQ: threshold, maxAgeSec };
			} else if (form.triggerKind === 'price_above_stork') {
				trigger = { kind: 'price_above_stork', feedId, minPriceQ: threshold, maxAgeSec };
			} else {
				trigger = { kind: 'stork_outcome_equals', feedId, expectedOutcomeQ: threshold, maxAgeSec };
			}
		}
	}

	let action: CreateOrderParsedInput['action'] | null = null;
	if (form.actionTemplate === 'system_transfer') {
		const recipient = parsePubkeyString(form.systemRecipient, 'systemRecipient', fieldErrors);
		let customLamports: bigint | null = null;
		if (form.systemTransferAmountMode === 'custom') {
			customLamports = parseU64(form.systemTransferLamports, 'systemTransferLamports', fieldErrors);
		}
		if (recipient) {
			action = {
				kind: 'system_transfer',
				recipient,
				amountMode: form.systemTransferAmountMode,
				customLamports
			};
		}
	} else if (form.actionTemplate === 'spl_token_transfer') {
		const sourceTokenAccount = parsePubkeyString(form.splSourceTokenAccount, 'splSourceTokenAccount', fieldErrors);
		const destinationTokenAccount = parsePubkeyString(
			form.splDestinationTokenAccount,
			'splDestinationTokenAccount',
			fieldErrors
		);
		const amountRaw = parseU64(form.splTransferAmountRaw, 'splTransferAmountRaw', fieldErrors);
		if (sourceTokenAccount && destinationTokenAccount && amountRaw !== null) {
			action = {
				kind: 'spl_token_transfer',
				sourceTokenAccount,
				destinationTokenAccount,
				authorityPda: form.splAuthorityPda,
				amountRaw
			};
		}
	} else {
		const programId = parsePubkeyString(form.rawProgramId, 'rawProgramId', fieldErrors);
		if (programId) {
			try {
				if (!isWhitelistedProgram(new PublicKey(programId))) {
					addError(
						fieldErrors,
						'rawProgramId',
						'Program is not whitelisted on-chain (System Program or SPL Token Program only).'
					);
				}
			} catch {
				// already covered by pubkey validation
			}
		}

		const data =
			form.rawDataEncoding === 'hex'
				? parseHexBytes(form.rawInstructionData, 'rawInstructionData', fieldErrors)
				: parseBase64Bytes(form.rawInstructionData, 'rawInstructionData', fieldErrors);

		const rawAccounts = form.rawAccounts
			.map((row, index) => {
				const trimmed = row.pubkey.trim();
				if (!trimmed) return null;
				const parsed = parsePubkeyString(trimmed, `rawAccounts.${index}.pubkey`, fieldErrors);
				if (!parsed) return null;
				return { pubkey: parsed, isWritable: row.isWritable };
			})
			.filter((row): row is { pubkey: string; isWritable: boolean } => row !== null);

		if ((data?.length ?? 0) > 512) {
			addError(fieldErrors, 'rawInstructionData', 'Instruction data exceeds 512 bytes.');
		}

		if (programId && data) {
			action = {
				kind: 'raw_cpi',
				programId,
				dataEncoding: form.rawDataEncoding,
				data,
				accounts: rawAccounts
			};
		}
	}

	if (inputAmountLamports !== null && executionBountyLamports !== null && executionBountyLamports >= inputAmountLamports) {
		addError(fieldErrors, 'executionBountySol', 'Execution bounty must be less than escrow amount.');
	}

	if (Object.keys(fieldErrors).length > 0 || !trigger || !action || inputAmountLamports === null || executionBountyLamports === null) {
		return {
			success: false,
			fieldErrors,
			message: firstFieldError(fieldErrors) ?? 'Invalid create-order inputs.'
		};
	}

	const parsedCandidate: CreateOrderParsedInput = {
		inputAmountLamports,
		executionBountyLamports,
		expiresSlot,
		trigger,
		action
	};

	const parsedCheck = CreateOrderParsedSchema.safeParse(parsedCandidate);
	if (!parsedCheck.success) {
		for (const issue of parsedCheck.error.issues) {
			const key = pathToKey(issue.path);
			switch (key) {
				case 'executionBountyLamports':
					addError(fieldErrors, 'executionBountySol', issue.message);
					break;
				case 'expiresSlot':
					addError(fieldErrors, 'expiresSlot', issue.message);
					break;
				case 'action.customLamports':
					addError(fieldErrors, 'systemTransferLamports', issue.message);
					break;
				case 'action.data':
					addError(fieldErrors, 'rawInstructionData', issue.message);
					break;
				default:
					addError(fieldErrors, key, issue.message);
			}
		}
		return {
			success: false,
			fieldErrors,
			message: firstFieldError(fieldErrors) ?? 'Invalid create-order inputs.'
		};
	}

	return { success: true, data: parsedCheck.data };
}
