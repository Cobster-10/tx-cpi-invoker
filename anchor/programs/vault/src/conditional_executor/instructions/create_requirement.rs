// T018 + T019 + T020 + T044: CreateRequirement instruction

use anchor_lang::prelude::*;

use crate::conditional_executor::constants::{
    DEFAULT_MAX_FUTURE_SKEW_SECS, DEFAULT_MAX_PROOF_AGE_SECS,
};
use crate::conditional_executor::hash::compute_accounts_hash;
use crate::conditional_executor::state::{ConditionRequirement, RequirementState};
use crate::conditional_executor::types::{AccountMetaInput, CreateRequirementArgs};
use crate::conditional_executor::validate::{validate_conditions, validate_instruction_data};
use crate::CreateRequirementCtx;

/// Handler for creating a new Requirement
///
/// T019: Stores immutable CPI intent + conditions + bounds
/// T020: Computes and persists accounts_hash from expected metas
/// T044: Persists CPI intent (target_program + ix_data + accounts_hash)
pub fn handler(
    ctx: Context<CreateRequirementCtx>,
    args: CreateRequirementArgs,
    expected_accounts: Vec<AccountMetaInput>,
) -> Result<()> {
    // Validate inputs
    validate_conditions(&args.conditions)?;
    validate_instruction_data(&args.instruction_data)?;

    // T020: Compute accounts hash
    let accounts_hash = compute_accounts_hash(&expected_accounts);

    // Get current time
    let clock = Clock::get()?;

    // Convert conditions to stored format
    let conditions: Vec<ConditionRequirement> =
        args.conditions.into_iter().map(|c| c.into()).collect();

    // Apply defaults for freshness policy
    let max_proof_age_secs = if args.max_proof_age_secs == 0 {
        DEFAULT_MAX_PROOF_AGE_SECS
    } else {
        args.max_proof_age_secs
    };

    let max_future_skew_secs = if args.max_future_skew_secs == 0 {
        DEFAULT_MAX_FUTURE_SKEW_SECS
    } else {
        args.max_future_skew_secs
    };

    // Initialize the requirement
    let requirement = &mut ctx.accounts.requirement;
    requirement.authority = ctx.accounts.authority.key();
    requirement.state = RequirementState::Active;
    requirement.created_at_unix = clock.unix_timestamp;
    requirement.executed_at_slot = None;
    requirement.bump = ctx.bumps.requirement;
    requirement.nonce = args.nonce;

    // T044: Store CPI intent
    requirement.target_program = args.target_program;
    requirement.instruction_data = args.instruction_data;
    requirement.accounts_hash = accounts_hash;

    // Store conditions
    requirement.conditions = conditions;

    // Store fee bounds
    requirement.max_keeper_fee_lamports = args.max_keeper_fee_lamports;
    requirement.keeper_fee_recipient = args.keeper_fee_recipient;

    // Store freshness policy
    requirement.max_proof_age_secs = max_proof_age_secs;
    requirement.max_future_skew_secs = max_future_skew_secs;

    msg!(
        "Created requirement with {} conditions, max fee: {} lamports",
        requirement.conditions.len(),
        requirement.max_keeper_fee_lamports
    );

    Ok(())
}
