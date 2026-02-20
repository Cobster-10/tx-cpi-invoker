use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

#[cfg(test)]
mod tests;

declare_id!("2f2ph1Sgi14dAfKwYXNb5XPuAhuokWCW5WNLyfiQXKc2");

use stork_solana_sdk::{pda::STORK_FEED_SEED, temporal_numeric_value::TemporalNumericValueFeed};

#[program]
pub mod order_executor {
    use super::*;

    pub fn init_user_counter(ctx: Context<InitUserCounter>) -> Result<()> {
        let counter = &mut ctx.accounts.order_counter;
        counter.user = ctx.accounts.user.key();
        counter.next_order_id = 0;
        counter.open_order_count = 0;
        Ok(())
    }

    pub fn create_order(
        ctx: Context<CreateOrder>,
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

        require!(action.accounts.len() <= 32, OrderError::TooManyAccounts);

        let counter = &mut ctx.accounts.order_counter;
        require!(
            counter.user == ctx.accounts.user.key(),
            OrderError::Unauthorized
        );

        let order_id = counter.next_order_id;
        counter.next_order_id = counter
            .next_order_id
            .checked_add(1)
            .ok_or(OrderError::OrderIdOverflow)?;
        counter.open_order_count = counter
            .open_order_count
            .checked_add(1)
            .ok_or(OrderError::OrderCountOverflow)?;

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
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            input_amount,
        )?;

        Ok(())
    }

    pub fn execute_order_if_ready(ctx: Context<ExecuteOrder>) -> Result<()> {
        let clock = Clock::get()?;
        validate_order_ready(&ctx.accounts.order, &clock)?;
        evaluate_trigger_base(&ctx.accounts.order.trigger, &clock, &ctx.accounts.pda_account)?;

        let order_pda = ctx.accounts.order.key();
        let vault_pda = ctx.accounts.vault.key();
        execute_order_action(
            order_pda,
            vault_pda,
            &ctx.accounts.order,
            ctx.program_id,
            ctx.remaining_accounts,
        )?;
        settle_execution(
            &mut ctx.accounts.order,
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.keeper,
            &ctx.accounts.system_program,
            ctx.program_id,
        )
    }

    pub fn execute_order_if_ready_stork(
        ctx: Context<ExecuteOrderStork>,
        feed_id: [u8; 32],
    ) -> Result<()> {
        let clock = Clock::get()?;
        validate_order_ready(&ctx.accounts.order, &clock)?;
        evaluate_trigger_stork(
            &ctx.accounts.order.trigger,
            &clock,
            &ctx.accounts.stork_feed,
            &feed_id,
        )?;

        let order_pda = ctx.accounts.order.key();
        let vault_pda = ctx.accounts.vault.key();
        execute_order_action(
            order_pda,
            vault_pda,
            &ctx.accounts.order,
            ctx.program_id,
            ctx.remaining_accounts,
        )?;
        settle_execution(
            &mut ctx.accounts.order,
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.keeper,
            &ctx.accounts.system_program,
            ctx.program_id,
        )
    }

    pub fn cancel_order(ctx: Context<CancelOrder>, order_id: u64) -> Result<()> {
        let order = &ctx.accounts.order;

        require!(!order.executed, OrderError::OrderAlreadyExecuted);
        require!(!order.canceled, OrderError::OrderAlreadyCanceled);
        require!(order.order_id == order_id, OrderError::InvalidOrderId);

        let refund_amount = ctx.accounts.vault.to_account_info().lamports();
        require!(refund_amount > 0, OrderError::InsufficientEscrowBalance);

        let vault_seeds: &[&[&[u8]]] = &[&[
            b"vault",
            order.user.as_ref(),
            &order_id.to_le_bytes(),
            &[ctx.bumps.vault],
        ]];

        transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.user.to_account_info(),
                },
                vault_seeds,
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
        require!(order.order_id == order_id, OrderError::InvalidOrderId);

        let remaining_lamports = ctx.accounts.vault.to_account_info().lamports();
        if remaining_lamports > 0 {
            let vault_seeds: &[&[&[u8]]] = &[&[
                b"vault",
                order.user.as_ref(),
                &order_id.to_le_bytes(),
                &[ctx.bumps.vault],
            ]];

            transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.user.to_account_info(),
                    },
                    vault_seeds,
                ),
                remaining_lamports,
            )?;
        }

        let counter = &mut ctx.accounts.order_counter;
        counter.open_order_count = counter
            .open_order_count
            .checked_sub(1)
            .ok_or(OrderError::OrderCountUnderflow)?;

        Ok(())
    }
}

fn validate_order_ready(order: &Order, clock: &Clock) -> Result<()> {
    require!(!order.executed, OrderError::OrderAlreadyExecuted);
    require!(!order.canceled, OrderError::OrderAlreadyCanceled);

    if let Some(expires) = order.expires_slot {
        require!(clock.slot <= expires, OrderError::OrderExpired);
    }

    Ok(())
}

fn evaluate_trigger_base(
    trigger: &Trigger,
    clock: &Clock,
    pda_account: &Option<AccountInfo>,
) -> Result<()> {
    let trigger_met = match trigger {
        Trigger::TimeAfter { slot } => clock.slot >= *slot,
        Trigger::PdaValueEquals {
            account,
            expected_value,
        } => {
            let pda_account = pda_account
                .as_ref()
                .ok_or(OrderError::InvalidPdaAccount)?;
            require!(pda_account.key() == *account, OrderError::InvalidPdaAccount);
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
        Trigger::PriceBelowStork { .. } | Trigger::StorkOutcomeEquals { .. } => {
            return Err(OrderError::StorkTriggerRequiresStorkInstruction.into());
        }
    };
    require!(trigger_met, OrderError::TriggerConditionNotMet);
    Ok(())
}

fn evaluate_trigger_stork(
    trigger: &Trigger,
    clock: &Clock,
    stork_feed: &Account<TemporalNumericValueFeed>,
    feed_id: &[u8; 32],
) -> Result<()> {
    let trigger_met = match trigger {
        Trigger::PriceBelowStork {
            feed_id: expected_feed_id,
            max_price_q,
            max_age_sec,
        } => {
            require!(*feed_id == *expected_feed_id, OrderError::InvalidOracleAccount);

            let latest = stork_feed
                .get_latest_canonical_temporal_numeric_value_unchecked(feed_id)?;

            let now_ns = u64::try_from(clock.unix_timestamp)
                .map_err(|_| OrderError::InvalidClock)?
                .saturating_mul(1_000_000_000);

            let max_age_ns = max_age_sec.saturating_mul(1_000_000_000);
            require!(
                now_ns.saturating_sub(latest.timestamp_ns) <= max_age_ns,
                OrderError::StaleOraclePrice
            );

            latest.quantized_value <= *max_price_q
        }
        Trigger::StorkOutcomeEquals {
            feed_id: expected_feed_id,
            expected_outcome_q,
            max_age_sec,
        } => {
            require!(*feed_id == *expected_feed_id, OrderError::InvalidOracleAccount);

            let latest = stork_feed
                .get_latest_canonical_temporal_numeric_value_unchecked(feed_id)?;

            let now_ns = u64::try_from(clock.unix_timestamp)
                .map_err(|_| OrderError::InvalidClock)?
                .saturating_mul(1_000_000_000);

            let max_age_ns = max_age_sec.saturating_mul(1_000_000_000);
            require!(
                now_ns.saturating_sub(latest.timestamp_ns) <= max_age_ns,
                OrderError::StaleOraclePrice
            );

            latest.quantized_value == *expected_outcome_q
        }
        _ => return Err(OrderError::NonStorkTriggerRequiresBaseInstruction.into()),
    };
    require!(trigger_met, OrderError::TriggerConditionNotMet);
    Ok(())
}

/// Validates remaining_accounts against the stored CpiAction, builds the CPI
/// instruction, and invokes it with Order/Vault PDA signer seeds.
///
/// remaining_accounts layout: [cpi_account_0, ..., cpi_account_n, target_program]
fn execute_order_action<'info>(
    order_pda: Pubkey,
    vault_pda: Pubkey,
    order: &Order,
    program_id: &Pubkey,
    remaining_accounts: &[AccountInfo<'info>],
) -> Result<()> {
    let action = &order.action;

    require!(
        is_whitelisted_program(action.program_id),
        OrderError::ProgramNotWhitelisted
    );

    let expected_len = action.accounts.len() + 1; // +1 for the target program
    require!(
        remaining_accounts.len() >= expected_len,
        OrderError::InsufficientAccounts
    );

    let order_user = order.user;
    let order_id_bytes = order.order_id.to_le_bytes();
    let (_, bump) = Pubkey::find_program_address(
        &[b"order", order_user.as_ref(), &order_id_bytes],
        program_id,
    );
    let order_seeds: &[&[u8]] = &[b"order", order_user.as_ref(), &order_id_bytes, &[bump]];
    let (_, vault_bump) = Pubkey::find_program_address(
        &[b"vault", order_user.as_ref(), &order_id_bytes],
        program_id,
    );
    let vault_seeds: &[&[u8]] = &[b"vault", order_user.as_ref(), &order_id_bytes, &[vault_bump]];

    for (i, expected_account) in action.accounts.iter().enumerate() {
        let provided_account = &remaining_accounts[i];

        require!(
            provided_account.key() == expected_account.pubkey,
            OrderError::AccountMismatch
        );

        require!(
            !expected_account.is_writable || provided_account.is_writable,
            OrderError::WritableEscalation
        );

    }

    // The target program AccountInfo is the last remaining account after CPI accounts
    let target_program_info = &remaining_accounts[action.accounts.len()];
    require!(
        target_program_info.key() == action.program_id,
        OrderError::AccountMismatch
    );
    require!(
        target_program_info.executable,
        OrderError::ProgramNotWhitelisted
    );

    let instruction = anchor_lang::solana_program::instruction::Instruction {
        program_id: action.program_id,
        accounts: action
            .accounts
            .iter()
            .map(|a| anchor_lang::solana_program::instruction::AccountMeta {
                pubkey: a.pubkey,
                is_writable: a.is_writable,
                is_signer: a.pubkey == order_pda || a.pubkey == vault_pda,
            })
            .collect(),
        data: action.data.clone(),
    };

    // Collect CPI account infos + the target program info
    let mut account_infos: Vec<AccountInfo> = remaining_accounts
        .iter()
        .take(action.accounts.len())
        .cloned()
        .collect();
    account_infos.push(target_program_info.clone());

    anchor_lang::solana_program::program::invoke_signed(
        &instruction,
        &account_infos,
        &[order_seeds, vault_seeds],
    )?;

    Ok(())
}

fn settle_execution<'info>(
    order: &mut Account<'info, Order>,
    vault: &AccountInfo<'info>,
    keeper: &Signer<'info>,
    system_program: &Program<'info, System>,
    program_id: &Pubkey,
) -> Result<()> {
    if order.execution_bounty > 0 {
        let vault_lamports = vault.lamports();
        require!(
            vault_lamports >= order.execution_bounty,
            OrderError::InsufficientEscrowBalance
        );
        let order_id_bytes = order.order_id.to_le_bytes();
        let (_, vault_bump) = Pubkey::find_program_address(
            &[b"vault", order.user.as_ref(), &order_id_bytes],
            program_id,
        );
        let vault_seeds: &[&[&[u8]]] = &[&[
            b"vault",
            order.user.as_ref(),
            &order_id_bytes,
            &[vault_bump],
        ]];

        transfer(
            CpiContext::new_with_signer(
                system_program.to_account_info(),
                Transfer {
                    from: vault.clone(),
                    to: keeper.to_account_info(),
                },
                vault_seeds,
            ),
            order.execution_bounty,
        )?;
    }
    order.executed = true;
    Ok(())
}

fn is_whitelisted_program(program_id: Pubkey) -> bool {
    matches!(
        program_id,
        anchor_lang::system_program::ID | anchor_spl::token::ID
    )
}

#[account]
pub struct UserOrderCounter {
    pub user: Pubkey,
    pub next_order_id: u64,
    pub open_order_count: u64,
}

impl UserOrderCounter {
    pub const LEN: usize = 8 + 32 + 8 + 8; // discriminator + fields
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum Trigger {
    TimeAfter {
        slot: u64,
    },
    PdaValueEquals {
        account: Pubkey,
        expected_value: u64,
    },
    PriceBelowStork {
        feed_id: [u8; 32],
        max_price_q: i128,
        max_age_sec: u64,
    },
    StorkOutcomeEquals {
        feed_id: [u8; 32],
        expected_outcome_q: i128,
        max_age_sec: u64,
    },
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
    const MAX_TRIGGER_SIZE: usize = 1 + 32 + 16 + 8;
    const MAX_CPI_ACCOUNTS: usize = 32;
    const MAX_CPI_DATA_LEN: usize = 512;
    const MAX_CPI_ACTION_SIZE: usize =
        32 + 4 + (Self::MAX_CPI_ACCOUNTS * (32 + 1)) + 4 + Self::MAX_CPI_DATA_LEN;

    pub const LEN: usize = 8
        + 32
        + 8
        + 8
        + Self::MAX_TRIGGER_SIZE
        + Self::MAX_CPI_ACTION_SIZE
        + 8
        + (1 + 8)
        + 1
        + 1
        + 8;
}

#[derive(Accounts)]
pub struct InitUserCounter<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init,
        payer = user,
        space = UserOrderCounter::LEN,
        seeds = [b"order_counter", user.key().as_ref()],
        bump
    )]
    pub order_counter: Account<'info, UserOrderCounter>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateOrder<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"order_counter", user.key().as_ref()],
        bump,
        has_one = user @ OrderError::Unauthorized
    )]
    pub order_counter: Account<'info, UserOrderCounter>,

    #[account(
        init,
        payer = user,
        space = Order::LEN,
        seeds = [b"order", user.key().as_ref(), &order_counter.next_order_id.to_le_bytes()],
        bump
    )]
    pub order: Account<'info, Order>,

    #[account(
        init,
        payer = user,
        space = 0,
        owner = anchor_lang::system_program::ID,
        seeds = [b"vault", user.key().as_ref(), &order_counter.next_order_id.to_le_bytes()],
        bump
    )]
    /// CHECK: System-owned vault PDA (0 data); owner+seeds enforced by constraints.
    pub vault: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteOrder<'info> {
    #[account(mut, has_one = user @ OrderError::Unauthorized)]
    pub order: Account<'info, Order>,
    
    #[account(
        mut,
        owner = anchor_lang::system_program::ID,
        seeds = [b"vault", order.user.as_ref(), &order.order_id.to_le_bytes()],
        bump
    )]
    /// CHECK: System-owned vault PDA; owner+seeds enforced by constraints.
    pub vault: AccountInfo<'info>,

    /// CHECK: Read-only user pubkey; validated via has_one on order.
    pub user: AccountInfo<'info>,
    #[account(mut)]
    pub keeper: Signer<'info>,
    /// CHECK: Optional PDA for PdaValueEquals trigger; validated in evaluate_trigger_base.
    pub pda_account: Option<AccountInfo<'info>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(feed_id: [u8; 32])]
pub struct ExecuteOrderStork<'info> {
    #[account(mut, has_one = user @ OrderError::Unauthorized)]
    pub order: Account<'info, Order>,
    #[account(
        mut,
        owner = anchor_lang::system_program::ID,
        seeds = [b"vault", order.user.as_ref(), &order.order_id.to_le_bytes()],
        bump
    )]
    /// CHECK: System-owned vault PDA; owner+seeds enforced by constraints.
    pub vault: AccountInfo<'info>,
    #[account(
        seeds = [STORK_FEED_SEED.as_ref(), feed_id.as_ref()],
        bump,
        seeds::program = stork_solana_sdk::ID
    )]
    pub stork_feed: Account<'info, TemporalNumericValueFeed>,
    /// CHECK: Read-only user pubkey; validated via has_one on order.
    pub user: AccountInfo<'info>,
    #[account(mut)]
    pub keeper: Signer<'info>,
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
    #[account(
        mut,
        owner = anchor_lang::system_program::ID,
        seeds = [b"vault", user.key().as_ref(), &order_id.to_le_bytes()],
        bump
    )]
    /// CHECK: System-owned vault PDA; owner+seeds enforced by constraints.
    pub vault: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct CloseOrder<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [b"order_counter", user.key().as_ref()],
        bump,
        has_one = user @ OrderError::Unauthorized
    )]
    pub order_counter: Account<'info, UserOrderCounter>,
    #[account(
        mut,
        close = user,
        seeds = [b"order", user.key().as_ref(), &order_id.to_le_bytes()],
        bump,
        has_one = user @ OrderError::Unauthorized
    )]
    pub order: Account<'info, Order>,
    #[account(
        mut,
        owner = anchor_lang::system_program::ID,
        seeds = [b"vault", user.key().as_ref(), &order_id.to_le_bytes()],
        bump
    )]
    /// CHECK: System-owned vault PDA; owner+seeds enforced by constraints.
    pub vault: AccountInfo<'info>,
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
    #[msg("Invalid clock value")]
    InvalidClock,
    #[msg("Stale oracle price")]
    StaleOraclePrice,
    #[msg("This trigger must be executed with a Stork instruction")]
    StorkTriggerRequiresStorkInstruction,
    #[msg("This trigger must be executed with the non-Stork instruction")]
    NonStorkTriggerRequiresBaseInstruction,
    #[msg("Order ID overflow")]
    OrderIdOverflow,
    #[msg("Order count overflow")]
    OrderCountOverflow,
    #[msg("Order count underflow")]
    OrderCountUnderflow,
}
