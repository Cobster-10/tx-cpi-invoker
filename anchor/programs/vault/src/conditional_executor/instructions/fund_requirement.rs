// T041: FundRequirement instruction - add lamports to Requirement PDA

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

use crate::conditional_executor::validate::require_active;
use crate::FundRequirementCtx;

/// Handler for adding lamports to a Requirement PDA
///
/// This allows the Requirement PDA to have funds for:
/// - Keeper fee payments
/// - CPI operations that require the PDA to pay
pub fn handler(ctx: Context<FundRequirementCtx>, amount: u64) -> Result<()> {
    let requirement = &ctx.accounts.requirement;

    // Only fund active requirements
    require_active(requirement.state)?;

    // Transfer lamports to the requirement PDA
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.funder.to_account_info(),
                to: ctx.accounts.requirement.to_account_info(),
            },
        ),
        amount,
    )?;

    msg!(
        "Funded requirement with {} lamports, new balance: {}",
        amount,
        ctx.accounts.requirement.to_account_info().lamports()
    );

    Ok(())
}
