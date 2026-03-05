import { z } from 'zod';
import type { CreateOrderFormState, CreateOrderParsedInput, CreateOrderValidationSections } from './types';

const rawAccountPresetSchema = z.enum(['', 'user', 'order_pda', 'vault_pda', 'system', 'spl']);
const triggerKindSchema = z.enum([
	'time_after',
	'pda_value_equals',
	'price_below_stork',
	'price_above_stork',
	'stork_outcome_equals'
]);
const actionTemplateSchema = z.enum(['system_transfer', 'spl_token_transfer', 'raw_cpi']);
const dataEncodingSchema = z.enum(['hex', 'base64']);
const splAuthorityPdaSchema = z.enum(['order_pda', 'vault_pda']);
const systemTransferAmountModeSchema = z.enum(['escrow_minus_bounty', 'custom']);

export const rawAccountRowSchema = z.object({
	pubkey: z.string(),
	isWritable: z.boolean(),
	preset: rawAccountPresetSchema
});

export const CreateOrderFormSchema: z.ZodType<CreateOrderFormState> = z
	.object({
		inputAmountSol: z.string(),
		executionBountySol: z.string(),
		expiresSlot: z.string(),
		triggerKind: triggerKindSchema,
		triggerTimeAfterSlot: z.string(),
		triggerPdaAccount: z.string(),
		triggerPdaExpectedValue: z.string(),
		triggerStorkFeedIdHex: z.string(),
		triggerStorkThresholdQ: z.string(),
		triggerStorkMaxAgeSec: z.string(),
		actionTemplate: actionTemplateSchema,
		systemRecipient: z.string(),
		systemTransferAmountMode: systemTransferAmountModeSchema,
		systemTransferLamports: z.string(),
		splSourceTokenAccount: z.string(),
		splDestinationTokenAccount: z.string(),
		splAuthorityPda: splAuthorityPdaSchema,
		splTransferAmountRaw: z.string(),
		rawProgramId: z.string(),
		rawDataEncoding: dataEncodingSchema,
		rawInstructionData: z.string(),
		rawAccounts: z.array(rawAccountRowSchema).max(32)
	})
	.superRefine((value, ctx) => {
		if (value.rawAccounts.length === 0) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['rawAccounts'],
				message: 'At least one raw CPI account row is required.'
			});
		}
	});

export const u64StringSchema = z
	.string()
	.trim()
	.min(1, 'Required')
	.regex(/^\d+$/, 'Must be an unsigned integer');

export const optionalU64StringSchema = z
	.string()
	.trim()
	.refine((v) => v === '' || /^\d+$/.test(v), 'Must be an unsigned integer');

export const i128StringSchema = z
	.string()
	.trim()
	.min(1, 'Required')
	.regex(/^-?\d+$/, 'Must be an integer');

export const solAmountStringSchema = z
	.string()
	.trim()
	.min(1, 'Required')
	.regex(/^(\d+)(?:\.(\d{0,9}))?$/, 'Must be a SOL amount with up to 9 decimals');

export const pubkeyStringSchema = z.string().trim().min(1, 'Required');

export const feedIdHexSchema = z
	.string()
	.trim()
	.min(1, 'Required')
	.refine((value) => {
		const normalized = value.replace(/^0x/i, '').replace(/\s+/g, '');
		return normalized.length === 64 && /^[0-9a-fA-F]+$/.test(normalized);
	}, 'Must be exactly 32 bytes (64 hex chars)');

const parsedTriggerSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('time_after'), slot: z.bigint().nullable() }),
	z.object({
		kind: z.literal('pda_value_equals'),
		account: z.string(),
		expectedValue: z.bigint()
	}),
	z.object({
		kind: z.literal('price_below_stork'),
		feedId: z.instanceof(Uint8Array),
		maxPriceQ: z.bigint(),
		maxAgeSec: z.bigint()
	}),
	z.object({
		kind: z.literal('price_above_stork'),
		feedId: z.instanceof(Uint8Array),
		minPriceQ: z.bigint(),
		maxAgeSec: z.bigint()
	}),
	z.object({
		kind: z.literal('stork_outcome_equals'),
		feedId: z.instanceof(Uint8Array),
		expectedOutcomeQ: z.bigint(),
		maxAgeSec: z.bigint()
	})
]);

const parsedActionSchema = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('system_transfer'),
		recipient: z.string(),
		amountMode: systemTransferAmountModeSchema,
		customLamports: z.bigint().nullable()
	}),
	z.object({
		kind: z.literal('spl_token_transfer'),
		sourceTokenAccount: z.string(),
		destinationTokenAccount: z.string(),
		authorityPda: splAuthorityPdaSchema,
		amountRaw: z.bigint()
	}),
	z.object({
		kind: z.literal('raw_cpi'),
		programId: z.string(),
		dataEncoding: dataEncodingSchema,
		data: z.instanceof(Uint8Array),
		accounts: z
			.array(z.object({ pubkey: z.string(), isWritable: z.boolean() }))
			.max(32)
	})
]);

export const CreateOrderParsedSchema: z.ZodType<CreateOrderParsedInput> = z
	.object({
		inputAmountLamports: z.bigint(),
		executionBountyLamports: z.bigint(),
		expiresSlot: z.bigint().nullable(),
		trigger: parsedTriggerSchema,
		action: parsedActionSchema
	})
	.superRefine((value, ctx) => {
		if (value.inputAmountLamports <= 0n) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['inputAmountLamports'],
				message: 'Escrow amount must be greater than 0.'
			});
		}
		if (value.executionBountyLamports < 0n) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['executionBountyLamports'],
				message: 'Execution bounty must be >= 0.'
			});
		}
		if (value.executionBountyLamports >= value.inputAmountLamports) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['executionBountyLamports'],
				message: 'Execution bounty must be less than escrow amount.'
			});
		}
		if (value.expiresSlot !== null && value.expiresSlot <= 0n) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['expiresSlot'],
				message: 'Expires slot must be greater than 0.'
			});
		}
		if (value.action.kind === 'system_transfer' && value.action.amountMode === 'custom') {
			if (value.action.customLamports === null) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['action', 'customLamports'],
					message: 'Transfer lamports is required for custom amount mode.'
				});
			}
		}
		if (value.action.kind === 'raw_cpi' && value.action.data.length > 512) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['action', 'data'],
				message: 'Instruction data exceeds 512 bytes.'
			});
		}
	});

export const defaultValidationSections = (): CreateOrderValidationSections => ({
	funding: false,
	expiry: false,
	trigger: false,
	action: false
});

