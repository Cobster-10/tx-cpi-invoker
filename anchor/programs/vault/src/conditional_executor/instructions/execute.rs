// T032: Execute instruction - verify proofs and perform CPI

use anchor_lang::prelude::*;

use crate::conditional_executor::config::get_trusted_signer;
use crate::conditional_executor::constants::REQUIREMENT_SEED;
use crate::conditional_executor::cpi::execute_delegated_cpi;
use crate::conditional_executor::ed25519::verify_ed25519_instruction;
use crate::conditional_executor::fees::transfer_keeper_fee_from_pda;
use crate::conditional_executor::state::RequirementState;
use crate::conditional_executor::types::ExecuteArgs;
use crate::conditional_executor::validate::require_active;
use crate::conditional_executor::verify::verify_proofs_match_conditions;
use crate::ExecuteCtx;

/// Handler for executing a Requirement
///
/// Verifies:
/// 1. Requirement is in Active state
/// 2. All proofs match conditions (id, outcome, freshness)
/// 3. Ed25519 signatures were verified in prior instructions
/// 4. Remaining accounts match stored accounts_hash
///
/// Then:
/// 5. Transfers keeper fee (if any)
/// 6. Executes the delegated CPI
/// 7. Marks requirement as Executed
pub fn handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, ExecuteCtx<'info>>,
    args: ExecuteArgs,
) -> Result<()> {
    let requirement = &ctx.accounts.requirement;

    // 1. Check state
    require_active(requirement.state)?;

    // Get current time for freshness checks
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp;

    // 2. Verify all proofs match conditions
    let _parsed_proofs = verify_proofs_match_conditions(requirement, &args.proofs, current_time)?;

    // 3. Verify ed25519 signatures for each proof
    let trusted_signer = get_trusted_signer(ctx.accounts.config.as_ref());

    for (i, proof) in args.proofs.iter().enumerate() {
        verify_ed25519_instruction(
            &ctx.accounts.instructions_sysvar,
            &trusted_signer,
            &proof.message,
        )
        .map_err(|e| {
            msg!("Ed25519 verification failed for proof {}: {:?}", i, e);
            e
        })?;
    }

    // 4. Verify remaining accounts match (done inside execute_delegated_cpi)
    // Get requirement data before mutable borrow
    let authority = requirement.authority;
    let nonce = requirement.nonce;
    let bump = requirement.bump;

    // 5. Transfer keeper fee if requested
    if args.keeper_fee_lamports > 0 {
        let fee_recipient = ctx
            .accounts
            .fee_recipient
            .as_ref()
            .map(|r| r.to_account_info())
            .unwrap_or_else(|| ctx.accounts.keeper.to_account_info());

        let nonce_bytes = nonce.to_le_bytes();
        let bump_bytes = [bump];
        let signer_seeds: &[&[u8]] = &[
            REQUIREMENT_SEED,
            authority.as_ref(),
            &nonce_bytes,
            &bump_bytes,
        ];

        transfer_keeper_fee_from_pda(
            requirement,
            args.keeper_fee_lamports,
            &ctx.accounts.requirement.to_account_info(),
            &fee_recipient,
            &ctx.accounts.system_program.to_account_info(),
            signer_seeds,
        )?;
    }

    // 6. Execute the delegated CPI
    execute_delegated_cpi(
        requirement,
        &ctx.accounts.requirement.to_account_info(),
        ctx.remaining_accounts,
        &authority,
        nonce,
        bump,
    )?;

    // 7. Mark as executed
    let requirement = &mut ctx.accounts.requirement;
    requirement.state = RequirementState::Executed;
    requirement.executed_at_slot = Some(clock.slot);

    msg!(
        "Executed requirement at slot {}, keeper fee: {} lamports",
        clock.slot,
        args.keeper_fee_lamports
    );

    Ok(())
}
