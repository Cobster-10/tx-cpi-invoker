// T037: WithdrawAndClose instruction

use anchor_lang::prelude::*;

use crate::conditional_executor::error::ExecutorError;
use crate::conditional_executor::state::RequirementState;
use crate::WithdrawAndCloseCtx;

/// Handler for withdrawing remaining lamports and closing a Requirement
///
/// Only the authority can close. Can only close canceled or executed requirements.
/// Active requirements must be canceled first.
pub fn handler(ctx: Context<WithdrawAndCloseCtx>) -> Result<()> {
    let requirement = &ctx.accounts.requirement;

    // Can only close terminal states (Canceled or Executed)
    match requirement.state {
        RequirementState::Active => {
            return Err(ExecutorError::RequirementNotActive.into());
        }
        RequirementState::Canceled | RequirementState::Executed => {
            // OK to close
        }
    }

    msg!(
        "Closed requirement in state {:?}, returned {} lamports to authority",
        requirement.state,
        ctx.accounts.requirement.to_account_info().lamports()
    );

    // The close = authority constraint handles the actual close and lamport transfer

    Ok(())
}
