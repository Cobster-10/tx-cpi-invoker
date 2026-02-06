use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use solana_program::instruction::{AccountMeta, Instruction};

#[cfg(test)]
mod tests;

declare_id!("HTGredcpihEqbJL9a3JBof4JQkgU5EdovAFt7xcPR2mg");

#[program]
pub mod vault {
    use super::*;

    pub fn create_order(
        ctx: Context<CreateOrder>,
        order_id: u64,
        input_amount: u64,
        trigger: Trigger,
        action: CpiAction,
        expires_slot: Option<u64>,
        execution_bounty: u64,
    ) -> Result<()> {
        require!(input_amount > 0, OrderError::InvalidAmount);
        require!(
            execution_bounty < input_amount,
            OrderError::BountyExceedsAmount
        );

        require!(
            is_whitelisted_program(action.program_id),
            OrderError::ProgramNotWhitelisted
        );

        require!(
            action.accounts.len() <= 32,
            OrderError::TooManyAccounts
        );

        let clock = Clock::get()?;
        let current_slot = clock.slot;

        if let Some(expires) = expires_slot {
            require!(expires > current_slot, OrderError::InvalidExpiration);
        }

        let order = &mut ctx.accounts.order;
        order.user = ctx.accounts.user.key();
        order.order_id = order_id;
        order.input_amount = input_amount;
        order.trigger = trigger;
        order.action = action;
        order.created_slot = current_slot;
        order.expires_slot = expires_slot;
        order.executed = false;
        order.canceled = false;
        order.execution_bounty = execution_bounty;

        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user.to_account_info(),
                    to: ctx.accounts.order.to_account_info(),
                },
            ),
            input_amount,
        )?;

        Ok(())
    }

    pub fn execute_order_if_ready(ctx: Context<ExecuteOrder>) -> Result<()> {
        let order = &ctx.accounts.order;
        let clock = Clock::get()?;

        require!(!order.executed, OrderError::OrderAlreadyExecuted);
        require!(!order.canceled, OrderError::OrderAlreadyCanceled);
        require!(
            ctx.accounts.user.key() == order.user,
            OrderError::Unauthorized
        );

        if let Some(expires) = order.expires_slot {
            require!(clock.slot <= expires, OrderError::OrderExpired);
        }

        let trigger_met = match &order.trigger {
            Trigger::TimeAfter { slot } => clock.slot >= *slot,
            Trigger::PdaValueEquals { account, expected_value } => {
                let pda_account = ctx
                    .accounts
                    .pda_account
                    .as_ref()
                    .ok_or(OrderError::InvalidPdaAccount)?;
                require!(
                    pda_account.key() == *account,
                    OrderError::InvalidPdaAccount
                );
                let account_data = pda_account.try_borrow_data()?;
                if account_data.len() < 8 {
                    return Err(OrderError::InvalidPdaAccount.into());
                }
                let value = u64::from_le_bytes(
                    account_data[0..8]
                        .try_into()
                        .map_err(|_| OrderError::InvalidPdaAccount)?,
                );
                value == *expected_value
            }
            Trigger::PriceBelow { oracle, price } => {
                let oracle_account = ctx
                    .accounts
                    .oracle_account
                    .as_ref()
                    .ok_or(OrderError::InvalidOracleAccount)?;
                require!(
                    oracle_account.key() == *oracle,
                    OrderError::InvalidOracleAccount
                );
                let oracle_data = oracle_account.try_borrow_data()?;
                if oracle_data.len() < 8 {
                    return Err(OrderError::InvalidOracleAccount.into());
                }
                let current_price = u64::from_le_bytes(
                    oracle_data[0..8]
                        .try_into()
                        .map_err(|_| OrderError::InvalidOracleAccount)?,
                );
                current_price <= *price
            }
        };

        require!(trigger_met, OrderError::TriggerConditionNotMet);

        require!(
            is_whitelisted_program(order.action.program_id),
            OrderError::ProgramNotWhitelisted
        );

        require!(
            ctx.remaining_accounts.len() >= order.action.accounts.len(),
            OrderError::InsufficientAccounts
        );

        let order_pda = ctx.accounts.order.key();
        let order_seeds: &[&[&[u8]]] = &[&[
            b"order",
            order.user.as_ref(),
            &order.order_id.to_le_bytes(),
            &[ctx.bumps.order],
        ]];

        for (i, expected_account) in order.action.accounts.iter().enumerate() {
            let provided_account = &ctx.remaining_accounts[i];

            require!(
                provided_account.key() == expected_account.pubkey,
                OrderError::AccountMismatch
            );

            require!(
                !expected_account.is_writable || provided_account.is_writable,
                OrderError::WritableEscalation
            );

            if expected_account.is_writable {
                validate_pda_authority(provided_account, &order_pda)?;
            }
        }

        let instruction = Instruction {
            program_id: order.action.program_id,
            accounts: order.action.accounts.iter().map(|a| {
                AccountMeta {
                    pubkey: a.pubkey,
                    is_writable: a.is_writable,
                    is_signer: false,
                }
            }).collect(),
            data: order.action.data.clone(),
        };

        let account_infos: Vec<AccountInfo> = ctx.remaining_accounts
            .iter()
            .take(order.action.accounts.len())
            .cloned()
            .collect();

        anchor_lang::solana_program::program::invoke_signed(
            &instruction,
            &account_infos.iter().collect::<Vec<_>>(),
            &[order_seeds],
        )?;

        if order.execution_bounty > 0 {
            **ctx.accounts.keeper.try_borrow_mut_lamports()? += order.execution_bounty;
            **ctx.accounts.order.try_borrow_mut_lamports()? -= order.execution_bounty;
        }

        let order_mut = &mut ctx.accounts.order;
        order_mut.executed = true;

        Ok(())
    }

    pub fn cancel_order(ctx: Context<CancelOrder>, order_id: u64) -> Result<()> {
        let order = &ctx.accounts.order;

        require!(!order.executed, OrderError::OrderAlreadyExecuted);
        require!(!order.canceled, OrderError::OrderAlreadyCanceled);
        require!(
            order.user == ctx.accounts.user.key(),
            OrderError::Unauthorized
        );
        require!(order.order_id == order_id, OrderError::InvalidOrderId);

        let refund_amount = ctx.accounts.order.lamports();
        require!(refund_amount > 0, OrderError::InsufficientEscrowBalance);

        let order_seeds: &[&[&[u8]]] = &[&[
            b"order",
            order.user.as_ref(),
            &order_id.to_le_bytes(),
            &[ctx.bumps.order],
        ]];

        transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.order.to_account_info(),
                    to: ctx.accounts.user.to_account_info(),
                },
                order_seeds,
            ),
            refund_amount,
        )?;

        let order_mut = &mut ctx.accounts.order;
        order_mut.canceled = true;

        Ok(())
    }

    pub fn close_order(ctx: Context<CloseOrder>, order_id: u64) -> Result<()> {
        let order = &ctx.accounts.order;

        require!(
            order.executed || order.canceled,
            OrderError::OrderNotSettled
        );
        require!(
            order.user == ctx.accounts.user.key(),
            OrderError::Unauthorized
        );
        require!(order.order_id == order_id, OrderError::InvalidOrderId);

        let remaining_lamports = ctx.accounts.order.lamports();
        if remaining_lamports > 0 {
            let order_seeds: &[&[&[u8]]] = &[&[
                b"order",
                order.user.as_ref(),
                &order_id.to_le_bytes(),
                &[ctx.bumps.order],
            ]];

            transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.order.to_account_info(),
                        to: ctx.accounts.user.to_account_info(),
                    },
                    order_seeds,
                ),
                remaining_lamports,
            )?;
        }

        Ok(())
    }
}

fn is_whitelisted_program(program_id: Pubkey) -> bool {
    matches!(
        program_id,
        anchor_lang::system_program::ID
            | anchor_spl::token::ID
            | anchor_spl::associated_token::ID
    )
}

fn validate_pda_authority(account: &AccountInfo, order_pda: &Pubkey) -> Result<()> {
    if account.owner == &anchor_spl::token::ID {
        let account_data = account.try_borrow_data()?;
        if account_data.len() >= 64 {
            let authority = Pubkey::try_from(&account_data[32..64])
                .map_err(|_| OrderError::InvalidAccountAuthority)?;
            require!(
                authority == *order_pda,
                OrderError::InvalidAccountAuthority
            );
        }
    } else if account.owner == &anchor_lang::system_program::ID {
        require!(
            account.key() == *order_pda,
            OrderError::InvalidAccountAuthority
        );
    }

    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum Trigger {
    TimeAfter { slot: u64 },
    PdaValueEquals { account: Pubkey, expected_value: u64 },
    PriceBelow { oracle: Pubkey, price: u64 },
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CpiAction {
    pub program_id: Pubkey,
    pub accounts: Vec<CpiAccount>,
    pub data: Vec<u8>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CpiAccount {
    pub pubkey: Pubkey,
    pub is_writable: bool,
}

#[account]
pub struct Order {
    pub user: Pubkey,
    pub order_id: u64,
    pub input_amount: u64,
    pub trigger: Trigger,
    pub action: CpiAction,
    pub created_slot: u64,
    pub expires_slot: Option<u64>,
    pub executed: bool,
    pub canceled: bool,
    pub execution_bounty: u64,
}

impl Order {
    pub const LEN: usize = 8
        + 32
        + 8
        + 8
        + (1 + 4 + 32 + 8)
        + 32
        + 4 + (32 + 1) * 32
        + 4 + 512
        + 8
        + 1 + 8
        + 1
        + 1
        + 8;
}

#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct CreateOrder<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        init,
        payer = user,
        space = Order::LEN,
        seeds = [b"order", user.key().as_ref(), &order_id.to_le_bytes()],
        bump
    )]
    pub order: Account<'info, Order>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteOrder<'info> {
    #[account(mut)]
    pub order: Account<'info, Order>,
    #[account(mut)]
    pub user: AccountInfo<'info>,
    #[account(mut)]
    pub keeper: Signer<'info>,
    pub pda_account: Option<AccountInfo<'info>>,
    pub oracle_account: Option<AccountInfo<'info>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct CancelOrder<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [b"order", user.key().as_ref(), &order_id.to_le_bytes()],
        bump,
        has_one = user @ OrderError::Unauthorized
    )]
    pub order: Account<'info, Order>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct CloseOrder<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [b"order", user.key().as_ref(), &order_id.to_le_bytes()],
        bump,
        has_one = user @ OrderError::Unauthorized
    )]
    pub order: Account<'info, Order>,
    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum OrderError {
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Order already executed")]
    OrderAlreadyExecuted,
    #[msg("Order already canceled")]
    OrderAlreadyCanceled,
    #[msg("Trigger condition not met")]
    TriggerConditionNotMet,
    #[msg("Order expired")]
    OrderExpired,
    #[msg("Invalid expiration slot")]
    InvalidExpiration,
    #[msg("Invalid PDA account")]
    InvalidPdaAccount,
    #[msg("Invalid oracle account")]
    InvalidOracleAccount,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Insufficient escrow balance")]
    InsufficientEscrowBalance,
    #[msg("Order not settled (must be executed or canceled)")]
    OrderNotSettled,
    #[msg("Execution bounty exceeds input amount")]
    BountyExceedsAmount,
    #[msg("Invalid order ID")]
    InvalidOrderId,
    #[msg("Program not whitelisted")]
    ProgramNotWhitelisted,
    #[msg("Too many accounts")]
    TooManyAccounts,
    #[msg("Insufficient accounts provided")]
    InsufficientAccounts,
    #[msg("Account mismatch")]
    AccountMismatch,
    #[msg("Writable escalation not allowed")]
    WritableEscalation,
    #[msg("Invalid account authority")]
    InvalidAccountAuthority,
}
