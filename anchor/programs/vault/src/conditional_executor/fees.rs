// T031: Keeper fee enforcement + transfer

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

use crate::conditional_executor::error::ExecutorError;
use crate::conditional_executor::state::Requirement;

/// Validate and transfer keeper fee
///
/// Transfers `fee_lamports` from `payer` to `recipient`.
/// Fails if fee exceeds the requirement's max_keeper_fee_lamports.
pub fn transfer_keeper_fee<'info>(
    requirement: &Requirement,
    fee_lamports: u64,
    payer: &AccountInfo<'info>,
    recipient: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
) -> Result<()> {
    // Validate fee doesn't exceed max
    if fee_lamports > requirement.max_keeper_fee_lamports {
        return Err(ExecutorError::KeeperFeeExceedsMax.into());
    }

    // Skip transfer if fee is zero
    if fee_lamports == 0 {
        return Ok(());
    }

    // Check payer has sufficient funds
    if payer.lamports() < fee_lamports {
        return Err(ExecutorError::InsufficientFundsForFee.into());
    }

    // Transfer fee
    transfer(
        CpiContext::new(
            system_program.clone(),
            Transfer {
                from: payer.clone(),
                to: recipient.clone(),
            },
        ),
        fee_lamports,
    )?;

    Ok(())
}

/// Transfer keeper fee from Requirement PDA (signed)
///
/// Uses the Requirement PDA as the payer, requires signer seeds.
pub fn transfer_keeper_fee_from_pda<'info>(
    requirement: &Requirement,
    fee_lamports: u64,
    requirement_pda: &AccountInfo<'info>,
    recipient: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    signer_seeds: &[&[u8]],
) -> Result<()> {
    // Validate fee doesn't exceed max
    if fee_lamports > requirement.max_keeper_fee_lamports {
        return Err(ExecutorError::KeeperFeeExceedsMax.into());
    }

    // Skip transfer if fee is zero
    if fee_lamports == 0 {
        return Ok(());
    }

    // Check PDA has sufficient funds
    if requirement_pda.lamports() < fee_lamports {
        return Err(ExecutorError::InsufficientFundsForFee.into());
    }

    // Transfer fee using PDA signature
    transfer(
        CpiContext::new_with_signer(
            system_program.clone(),
            Transfer {
                from: requirement_pda.clone(),
                to: recipient.clone(),
            },
            &[signer_seeds],
        ),
        fee_lamports,
    )?;

    Ok(())
}
