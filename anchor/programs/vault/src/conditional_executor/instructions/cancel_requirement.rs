// T036: CancelRequirement instruction

use anchor_lang::prelude::*;

use crate::conditional_executor::state::RequirementState;
use crate::conditional_executor::validate::require_active;
use crate::CancelRequirementCtx;

/// Handler for canceling a Requirement
///
/// Only the authority can cancel. Once canceled, the requirement cannot be executed.
pub fn handler(ctx: Context<CancelRequirementCtx>) -> Result<()> {
    let requirement = &mut ctx.accounts.requirement;

    // Verify requirement is active
    require_active(requirement.state)?;

    // Mark as canceled
    requirement.state = RequirementState::Canceled;

    msg!("Canceled requirement");

    Ok(())
}
