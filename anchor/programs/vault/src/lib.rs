use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

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
        expires_slot: Option<u64>,
        execution_bounty: u64,
    ) -> Result<()> {
        require!(input_amount > 0, OrderError::InvalidAmount);
        require!(
            execution_bounty < input_amount,
            OrderError::BountyExceedsAmount
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
        order.created_slot = current_slot;
        order.expires_slot = expires_slot;
        order.executed = false;
        order.canceled = false;
        order.execution_bounty = execution_bounty;

        // Transfer SOL to escrow (Order PDA)
        // Note: Anchor's init already pays rent, so we transfer the full input_amount
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

        // Check expiration
        if let Some(expires) = order.expires_slot {
            require!(clock.slot <= expires, OrderError::OrderExpired);
        }

        // Evaluate trigger condition
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
                // Read first 8 bytes as u64 (assuming little-endian)
                let value = u64::from_le_bytes(
                    account_data[0..8]
                        .try_into()
                        .map_err(|_| OrderError::InvalidPdaAccount)?,
                );
                value == *expected_value
            }
            Trigger::PriceBelow { oracle, price } => {
                // Placeholder for oracle integration
                // In production, this would read from Pyth/Switchboard oracle
                // For now, we'll require the oracle account to be provided
                // and read a simple u64 price value
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

        // Calculate amounts
        let execution_amount = order
            .input_amount
            .checked_sub(order.execution_bounty)
            .ok_or(OrderError::InvalidAmount)?;

        // Verify Order PDA has sufficient funds (input_amount + rent)
        let order_lamports = ctx.accounts.order.to_account_info().lamports();
        require!(
            order_lamports >= order.input_amount,
            OrderError::InsufficientEscrowBalance
        );

        // Pay execution bounty to keeper (executor)
        if order.execution_bounty > 0 {
            **ctx.accounts.keeper.try_borrow_mut_lamports()? += order.execution_bounty;
            **ctx.accounts.order.try_borrow_mut_lamports()? -= order.execution_bounty;
        }

        // Transfer remaining funds to user (or could be CPI to DEX in future)
        **ctx.accounts.user.try_borrow_mut_lamports()? += execution_amount;
        **ctx.accounts.order.try_borrow_mut_lamports()? -= execution_amount;

        // Mark as executed
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

        // Refund all escrowed funds to user
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

        // Mark as canceled
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

        // Close account and reclaim rent
        // Remaining lamports (if any) go to user
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

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum Trigger {
    TimeAfter { slot: u64 },
    PdaValueEquals { account: Pubkey, expected_value: u64 },
    PriceBelow { oracle: Pubkey, price: u64 },
}

#[account]
pub struct Order {
    pub user: Pubkey,
    pub order_id: u64,
    pub input_amount: u64,
    pub trigger: Trigger,
    pub created_slot: u64,
    pub expires_slot: Option<u64>,
    pub executed: bool,
    pub canceled: bool,
    pub execution_bounty: u64,
}

impl Order {
    pub const LEN: usize = 8 + // discriminator
        32 + // user
        8 + // order_id
        8 + // input_amount
        1 + 8 + // trigger variant + data (max size for PriceBelow)
        8 + // created_slot
        1 + 8 + // expires_slot (Option<u64>)
        1 + // executed
        1 + // canceled
        8; // execution_bounty
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
    /// CHECK: User account that will receive the execution amount
    #[account(mut)]
    pub user: AccountInfo<'info>,
    /// CHECK: Keeper account that will receive the bounty
    #[account(mut)]
    pub keeper: Signer<'info>,
    /// CHECK: PDA account for PdaValueEquals trigger (optional)
    pub pda_account: Option<AccountInfo<'info>>,
    /// CHECK: Oracle account for PriceBelow trigger (optional)
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
}
