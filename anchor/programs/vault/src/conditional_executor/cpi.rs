// T042 + T043: CPI invocation via invoke_signed + accounts hash binding

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;

use crate::conditional_executor::constants::REQUIREMENT_SEED;
use crate::conditional_executor::error::ExecutorError;
use crate::conditional_executor::hash::verify_accounts_hash;
use crate::conditional_executor::state::Requirement;

/// Execute the delegated CPI using the Requirement PDA as signer
///
/// This verifies the remaining accounts match the stored accounts_hash,
/// then invokes the target program with the stored instruction data.
pub fn execute_delegated_cpi<'info>(
    requirement: &Requirement,
    requirement_pda: &AccountInfo<'info>,
    remaining_accounts: &[AccountInfo<'info>],
    authority: &Pubkey,
    nonce: u64,
    bump: u8,
) -> Result<()> {
    // T043: Verify remaining accounts match stored hash
    if !verify_accounts_hash(remaining_accounts, &requirement.accounts_hash) {
        return Err(ExecutorError::AccountsHashMismatch.into());
    }

    // Build account metas for the CPI
    // The Requirement PDA signs, so we need to mark accounts appropriately
    let mut account_metas: Vec<AccountMeta> = Vec::with_capacity(remaining_accounts.len());

    for acc in remaining_accounts.iter() {
        // Check if this account should be marked as signer
        // The Requirement PDA is the signer for delegated authority
        let is_signer = *acc.key == requirement_pda.key();

        if acc.is_writable {
            account_metas.push(AccountMeta::new(*acc.key, is_signer));
        } else {
            account_metas.push(AccountMeta::new_readonly(*acc.key, is_signer));
        }
    }

    // Build the instruction
    let ix = Instruction {
        program_id: requirement.target_program,
        accounts: account_metas,
        data: requirement.instruction_data.clone(),
    };

    // Build signer seeds for the Requirement PDA
    let nonce_bytes = nonce.to_le_bytes();
    let bump_bytes = [bump];
    let signer_seeds: &[&[u8]] = &[
        REQUIREMENT_SEED,
        authority.as_ref(),
        &nonce_bytes,
        &bump_bytes,
    ];

    // Collect account infos for invoke_signed
    let account_infos: Vec<AccountInfo> = remaining_accounts.to_vec();

    // Execute the CPI
    invoke_signed(&ix, &account_infos, &[signer_seeds])
        .map_err(|_| ExecutorError::CpiInvocationFailed)?;

    Ok(())
}

/// Execute CPI without PDA signing (for testing or special cases)
pub fn execute_cpi_unsigned<'info>(
    target_program: &Pubkey,
    instruction_data: &[u8],
    accounts: &[AccountInfo<'info>],
) -> Result<()> {
    let account_metas: Vec<AccountMeta> = accounts
        .iter()
        .map(|acc| {
            if acc.is_writable {
                AccountMeta::new(*acc.key, acc.is_signer)
            } else {
                AccountMeta::new_readonly(*acc.key, acc.is_signer)
            }
        })
        .collect();

    let ix = Instruction {
        program_id: *target_program,
        accounts: account_metas,
        data: instruction_data.to_vec(),
    };

    anchor_lang::solana_program::program::invoke(&ix, accounts)
        .map_err(|_| ExecutorError::CpiInvocationFailed)?;

    Ok(())
}
