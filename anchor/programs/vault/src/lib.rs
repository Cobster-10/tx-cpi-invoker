use anchor_lang::prelude::*;

#[cfg(test)]
mod tests;

// T006: Wire conditional executor module into the program
pub mod conditional_executor;

pub use conditional_executor::error::ExecutorError;
pub use conditional_executor::state::{Config, Requirement, RequirementState};
pub use conditional_executor::types::{AccountMetaInput, CreateRequirementArgs, ExecuteArgs};
pub use conditional_executor::constants::REQUIREMENT_SEED;

declare_id!("HTGredcpihEqbJL9a3JBof4JQkgU5EdovAFt7xcPR2mg");

#[program]
pub mod vault {
    use super::*;

    /// T021: Create a new conditional execution requirement
    pub fn create_requirement(
        ctx: Context<CreateRequirementCtx>,
        args: CreateRequirementArgs,
        expected_accounts: Vec<AccountMetaInput>,
    ) -> Result<()> {
        conditional_executor::instructions::create_requirement::handler(ctx, args, expected_accounts)
    }

    /// T033: Execute a requirement if all proofs match
    pub fn execute_requirement<'info>(
        ctx: Context<'_, '_, 'info, 'info, ExecuteCtx<'info>>,
        args: ExecuteArgs,
    ) -> Result<()> {
        conditional_executor::instructions::execute::handler(ctx, args)
    }

    /// T038: Cancel a requirement (authority only)
    pub fn cancel_requirement(ctx: Context<CancelRequirementCtx>) -> Result<()> {
        conditional_executor::instructions::cancel_requirement::handler(ctx)
    }

    /// T038: Withdraw and close a requirement (authority only)
    pub fn withdraw_and_close(ctx: Context<WithdrawAndCloseCtx>) -> Result<()> {
        conditional_executor::instructions::withdraw_and_close::handler(ctx)
    }

    /// Fund a requirement PDA with lamports
    pub fn fund_requirement(ctx: Context<FundRequirementCtx>, amount: u64) -> Result<()> {
        conditional_executor::instructions::fund_requirement::handler(ctx, amount)
    }
}

// Define Accounts structs at crate root for Anchor macro compatibility

/// Accounts for creating a new Requirement
#[derive(Accounts)]
#[instruction(args: CreateRequirementArgs)]
pub struct CreateRequirementCtx<'info> {
    /// User creating the requirement (becomes authority)
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The Requirement PDA to create
    #[account(
        init,
        payer = authority,
        space = 8 + Requirement::INIT_SPACE,
        seeds = [REQUIREMENT_SEED, authority.key().as_ref(), &args.nonce.to_le_bytes()],
        bump,
    )]
    pub requirement: Account<'info, Requirement>,

    pub system_program: Program<'info, System>,
}

/// Accounts for executing a Requirement
#[derive(Accounts)]
pub struct ExecuteCtx<'info> {
    /// Keeper or anyone triggering execution
    #[account(mut)]
    pub keeper: Signer<'info>,

    /// The Requirement PDA to execute
    #[account(
        mut,
        seeds = [REQUIREMENT_SEED, requirement.authority.as_ref(), &requirement.nonce.to_le_bytes()],
        bump = requirement.bump,
    )]
    pub requirement: Account<'info, Requirement>,

    /// Optional Config PDA for custom signer key
    pub config: Option<Account<'info, Config>>,

    /// Instructions sysvar for ed25519 verification
    /// CHECK: This is the instructions sysvar
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,

    /// Keeper fee recipient (if different from keeper)
    /// CHECK: Just receives lamports
    #[account(mut)]
    pub fee_recipient: Option<AccountInfo<'info>>,

    pub system_program: Program<'info, System>,
}

/// Accounts for canceling a Requirement
#[derive(Accounts)]
pub struct CancelRequirementCtx<'info> {
    /// Authority who created the requirement
    pub authority: Signer<'info>,

    /// The Requirement PDA to cancel
    #[account(
        mut,
        seeds = [REQUIREMENT_SEED, requirement.authority.as_ref(), &requirement.nonce.to_le_bytes()],
        bump = requirement.bump,
        constraint = requirement.authority == authority.key() @ ExecutorError::UnauthorizedAuthority,
    )]
    pub requirement: Account<'info, Requirement>,
}

/// Accounts for withdrawing and closing a Requirement
#[derive(Accounts)]
pub struct WithdrawAndCloseCtx<'info> {
    /// Authority who created the requirement (receives rent)
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The Requirement PDA to close
    #[account(
        mut,
        seeds = [REQUIREMENT_SEED, requirement.authority.as_ref(), &requirement.nonce.to_le_bytes()],
        bump = requirement.bump,
        constraint = requirement.authority == authority.key() @ ExecutorError::UnauthorizedAuthority,
        close = authority,
    )]
    pub requirement: Account<'info, Requirement>,
}

/// Accounts for funding a Requirement PDA
#[derive(Accounts)]
pub struct FundRequirementCtx<'info> {
    /// Anyone can fund a requirement
    #[account(mut)]
    pub funder: Signer<'info>,

    /// The Requirement PDA to fund
    #[account(
        mut,
        seeds = [REQUIREMENT_SEED, requirement.authority.as_ref(), &requirement.nonce.to_le_bytes()],
        bump = requirement.bump,
    )]
    pub requirement: Account<'info, Requirement>,

    pub system_program: Program<'info, System>,
}
