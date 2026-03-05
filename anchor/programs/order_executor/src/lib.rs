use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

use anchor_lang::solana_program::program_pack::Pack;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::spl_token::{
    instruction as token_instruction,
    state::Account as SplTokenAccount,
};

#[cfg(test)]
mod tests;

declare_id!("92qmR1awv4UumvZbncHqTUxJBmSF588t1y1hzBSQEjNS");

/// Native SOL mint (wrapped SOL) - used to detect SOL->token swaps.
const NATIVE_SOL_MINT: Pubkey = pubkey!("So11111111111111111111111111111111111111112");

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
        action: OrderAction,
        expires_slot: Option<u64>,
        execution_bounty: u64,
    ) -> Result<()> {
        require!(input_amount > 0, OrderError::InvalidAmount);
        require!(
            execution_bounty < input_amount,
            OrderError::BountyExceedsAmount
        );

        validate_trigger_on_create(&trigger)?;

        match &action {
            OrderAction::Cpi(cpi) => {
                require!(
                    is_whitelisted_program(cpi.program_id),
                    OrderError::ProgramNotWhitelisted
                );
                require!(cpi.accounts.len() <= 32, OrderError::TooManyAccounts);
            }
            OrderAction::SwapIntent(intent) => {
                require!(
                    is_whitelisted_program(intent.swap_program),
                    OrderError::ProgramNotWhitelisted
                );
                require!(intent.input_amount > 0, OrderError::InvalidAmount);
                require!(
                    input_amount >= intent.input_amount,
                    OrderError::InvalidAmount
                );
            }
        }

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

    pub fn execute_order_if_ready<'info>(
        ctx: Context<'_, '_, '_, 'info, ExecuteOrder<'info>>,
        swap_instruction_data: Option<Vec<u8>>,
    ) -> Result<()> {
        let clock = Clock::get()?;
        validate_order_ready(&ctx.accounts.order, &clock)?;
        evaluate_trigger_base(
            &ctx.accounts.order.trigger,
            &clock,
            &ctx.accounts.pda_account,
        )?;

        match &ctx.accounts.order.action {
            OrderAction::SwapIntent(_) => {
                require!(
                    swap_instruction_data.is_some(),
                    OrderError::SwapIntentRequiresInstructionData
                );
            }
            OrderAction::Cpi(_) => {
                require!(
                    swap_instruction_data.is_none(),
                    OrderError::CpiMustNotHaveSwapData
                );
            }
        }

        let order_pda = ctx.accounts.order.key();
        let vault_pda = ctx.accounts.vault.key();
        if let OrderAction::SwapIntent(intent) = &ctx.accounts.order.action {
            if intent.input_mint == NATIVE_SOL_MINT {
                let order_id_bytes = ctx.accounts.order.order_id.to_le_bytes();
                let (_, vault_bump) = Pubkey::find_program_address(
                    &[b"vault", ctx.accounts.order.user.as_ref(), &order_id_bytes],
                    ctx.program_id,
                );
                let vault_seeds: &[&[u8]] = &[
                    b"vault",
                    ctx.accounts.order.user.as_ref(),
                    &order_id_bytes,
                    &[vault_bump],
                ];
                let vault_wsol_ata =
                    get_associated_token_address(&vault_pda, &NATIVE_SOL_MINT);
                let wsol_ata_info = ctx
                    .remaining_accounts
                    .iter()
                    .find(|a| a.key() == vault_wsol_ata)
                    .ok_or(OrderError::VaultWsolAtaAccountMissing)?;
                require!(wsol_ata_info.is_writable, OrderError::VaultWsolAtaAccountMissing);
                let transfer_ix = Transfer {
                    from: ctx.accounts.vault.clone(),
                    to: wsol_ata_info.clone(),
                };
                transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.system_program.to_account_info(),
                        transfer_ix,
                        &[vault_seeds],
                    ),
                    intent.input_amount,
                )?;
                let sync_ix = token_instruction::sync_native(
                    &anchor_spl::token::ID,
                    &vault_wsol_ata,
                )
                .map_err(|_| OrderError::VaultWsolAtaAccountMissing)?;
                let sync_account_infos = [
                    wsol_ata_info.clone(),
                    ctx.accounts.token_program.to_account_info(),
                ];
                anchor_lang::solana_program::program::invoke(&sync_ix, &sync_account_infos)?;
            }
        }
        execute_order_action(
            order_pda,
            vault_pda,
            &ctx.accounts.order,
            ctx.program_id,
            ctx.remaining_accounts,
            swap_instruction_data.as_deref(),
        )?;
        settle_execution(
            &mut ctx.accounts.order,
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.keeper,
            &ctx.accounts.system_program,
            ctx.program_id,
        )
    }

    pub fn execute_order_if_ready_stork<'info>(
        ctx: Context<'_, '_, '_, 'info, ExecuteOrderStork<'info>>,
        swap_instruction_data: Option<Vec<u8>>,
    ) -> Result<()> {
        let clock = Clock::get()?;
        validate_order_ready(&ctx.accounts.order, &clock)?;
        let expected_feed_id = stork_trigger_feed_id(&ctx.accounts.order.trigger)?;
        let (expected_feed_pda, _) = Pubkey::find_program_address(
            &[STORK_FEED_SEED.as_ref(), expected_feed_id.as_ref()],
            &stork_solana_sdk::ID,
        );
        require!(
            ctx.accounts.stork_feed.key() == expected_feed_pda,
            OrderError::InvalidOracleAccount
        );
        evaluate_trigger_stork(
            &ctx.accounts.order.trigger,
            &clock,
            &ctx.accounts.stork_feed,
            &expected_feed_id,
        )?;

        match &ctx.accounts.order.action {
            OrderAction::SwapIntent(_) => {
                require!(
                    swap_instruction_data.is_some(),
                    OrderError::SwapIntentRequiresInstructionData
                );
            }
            OrderAction::Cpi(_) => {
                require!(
                    swap_instruction_data.is_none(),
                    OrderError::CpiMustNotHaveSwapData
                );
            }
        }

        let order_pda = ctx.accounts.order.key();
        let vault_pda = ctx.accounts.vault.key();
        if let OrderAction::SwapIntent(intent) = &ctx.accounts.order.action {
            if intent.input_mint == NATIVE_SOL_MINT {
                let order_id_bytes = ctx.accounts.order.order_id.to_le_bytes();
                let (_, vault_bump) = Pubkey::find_program_address(
                    &[b"vault", ctx.accounts.order.user.as_ref(), &order_id_bytes],
                    ctx.program_id,
                );
                let vault_seeds: &[&[u8]] = &[
                    b"vault",
                    ctx.accounts.order.user.as_ref(),
                    &order_id_bytes,
                    &[vault_bump],
                ];
                let vault_wsol_ata =
                    get_associated_token_address(&vault_pda, &NATIVE_SOL_MINT);
                let wsol_ata_info = ctx
                    .remaining_accounts
                    .iter()
                    .find(|a| a.key() == vault_wsol_ata)
                    .ok_or(OrderError::VaultWsolAtaAccountMissing)?;
                require!(wsol_ata_info.is_writable, OrderError::VaultWsolAtaAccountMissing);
                let transfer_ix = Transfer {
                    from: ctx.accounts.vault.clone(),
                    to: wsol_ata_info.clone(),
                };
                transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.system_program.to_account_info(),
                        transfer_ix,
                        &[vault_seeds],
                    ),
                    intent.input_amount,
                )?;
                let sync_ix = token_instruction::sync_native(
                    &anchor_spl::token::ID,
                    &vault_wsol_ata,
                )
                .map_err(|_| OrderError::VaultWsolAtaAccountMissing)?;
                let sync_account_infos = [
                    wsol_ata_info.clone(),
                    ctx.accounts.token_program.to_account_info(),
                ];
                anchor_lang::solana_program::program::invoke(&sync_ix, &sync_account_infos)?;
            }
        }
        execute_order_action(
            order_pda,
            vault_pda,
            &ctx.accounts.order,
            ctx.program_id,
            ctx.remaining_accounts,
            swap_instruction_data.as_deref(),
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

    pub fn close_order<'info>(
        ctx: Context<'_, '_, '_, 'info, CloseOrder<'info>>,
        order_id: u64,
    ) -> Result<()> {
        let order = &ctx.accounts.order;

        require!(
            order.executed || order.canceled,
            OrderError::OrderNotSettled
        );
        require!(order.order_id == order_id, OrderError::InvalidOrderId);

        let vault_pda = ctx.accounts.vault.key();
        let user_pubkey = ctx.accounts.user.key();
        let vault_seeds: &[&[&[u8]]] = &[&[
            b"vault",
            order.user.as_ref(),
            &order_id.to_le_bytes(),
            &[ctx.bumps.vault],
        ]];

        let remaining_lamports = ctx.accounts.vault.to_account_info().lamports();
        if remaining_lamports > 0 {
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

        // Drain vault token accounts: remaining_accounts are pairs (vault_token_account, user_token_account)
        if !ctx.remaining_accounts.is_empty() {
            require!(
                ctx.remaining_accounts.len() % 2 == 0,
                OrderError::InvalidTokenAccountPairs
            );
            let vault_info = ctx.accounts.vault.to_account_info();
            for chunk in ctx.remaining_accounts.chunks(2) {
                let vault_token_account = &chunk[0];
                let user_token_account = &chunk[1];

                let vault_data = vault_token_account.try_borrow_data()?;
                let vault_token =
                    SplTokenAccount::unpack(&vault_data).map_err(|_| OrderError::InvalidTokenAccount)?;

                require!(
                    vault_token.owner == vault_pda,
                    OrderError::InvalidTokenAccount
                );

                let user_data = user_token_account.try_borrow_data()?;
                let user_token =
                    SplTokenAccount::unpack(&user_data).map_err(|_| OrderError::InvalidTokenAccount)?;

                require!(user_token.owner == user_pubkey, OrderError::InvalidTokenAccount);
                require!(
                    vault_token.mint == user_token.mint,
                    OrderError::InvalidTokenAccount
                );

                let amount = vault_token.amount;
                drop(vault_data);
                drop(user_data);

                if amount > 0 {
                    let transfer_ix = token_instruction::transfer(
                        ctx.accounts.token_program.key,
                        vault_token_account.key,
                        user_token_account.key,
                        &vault_pda,
                        &[],
                        amount,
                    )
                    .map_err(|_| OrderError::InvalidTokenAccount)?;

                    let account_infos = [
                        vault_token_account.clone(),
                        user_token_account.clone(),
                        vault_info.clone(),
                    ];

                    anchor_lang::solana_program::program::invoke_signed(
                        &transfer_ix,
                        &account_infos,
                        vault_seeds,
                    )?;
                }
            }
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

fn validate_trigger_on_create(trigger: &Trigger) -> Result<()> {
    if let Trigger::PriceBelowStork { feed_id, .. }
    | Trigger::PriceAboveStork { feed_id, .. }
    | Trigger::StorkOutcomeEquals { feed_id, .. } = trigger
    {
        require!(*feed_id != [0u8; 32], OrderError::InvalidOracleAccount);
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
            let pda_account = pda_account.as_ref().ok_or(OrderError::InvalidPdaAccount)?;
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
        Trigger::PriceBelowStork { .. }
        | Trigger::PriceAboveStork { .. }
        | Trigger::StorkOutcomeEquals { .. } => {
            return Err(OrderError::StorkTriggerRequiresStorkInstruction.into());
        }
    };
    require!(trigger_met, OrderError::TriggerConditionNotMet);
    Ok(())
}

fn stork_trigger_feed_id(trigger: &Trigger) -> Result<[u8; 32]> {
    match trigger {
        Trigger::PriceBelowStork { feed_id, .. }
        | Trigger::PriceAboveStork { feed_id, .. }
        | Trigger::StorkOutcomeEquals { feed_id, .. } => Ok(*feed_id),
        _ => Err(OrderError::NonStorkTriggerRequiresBaseInstruction.into()),
    }
}

fn require_stork_value_fresh(clock: &Clock, timestamp_ns: u64, max_age_sec: u64) -> Result<()> {
    let now_ns = u64::try_from(clock.unix_timestamp)
        .map_err(|_| OrderError::InvalidClock)?
        .saturating_mul(1_000_000_000);

    let max_age_ns = max_age_sec.saturating_mul(1_000_000_000);
    require!(
        now_ns.saturating_sub(timestamp_ns) <= max_age_ns,
        OrderError::StaleOraclePrice
    );
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
            require!(
                *feed_id == *expected_feed_id,
                OrderError::InvalidOracleAccount
            );

            let latest =
                stork_feed.get_latest_canonical_temporal_numeric_value_unchecked(feed_id)?;

            require_stork_value_fresh(clock, latest.timestamp_ns, *max_age_sec)?;

            latest.quantized_value <= *max_price_q
        }
        Trigger::PriceAboveStork {
            feed_id: expected_feed_id,
            min_price_q,
            max_age_sec,
        } => {
            require!(
                *feed_id == *expected_feed_id,
                OrderError::InvalidOracleAccount
            );

            let latest =
                stork_feed.get_latest_canonical_temporal_numeric_value_unchecked(feed_id)?;

            require_stork_value_fresh(clock, latest.timestamp_ns, *max_age_sec)?;

            latest.quantized_value >= *min_price_q
        }
        Trigger::StorkOutcomeEquals {
            feed_id: expected_feed_id,
            expected_outcome_q,
            max_age_sec,
        } => {
            require!(
                *feed_id == *expected_feed_id,
                OrderError::InvalidOracleAccount
            );

            let latest =
                stork_feed.get_latest_canonical_temporal_numeric_value_unchecked(feed_id)?;

            require_stork_value_fresh(clock, latest.timestamp_ns, *max_age_sec)?;

            latest.quantized_value == *expected_outcome_q
        }
        _ => return Err(OrderError::NonStorkTriggerRequiresBaseInstruction.into()),
    };
    require!(trigger_met, OrderError::TriggerConditionNotMet);
    Ok(())
}

/// Validates remaining_accounts, builds the CPI instruction, and invokes it with
/// Order/Vault PDA signer seeds.
///
/// Cpi: remaining_accounts layout [cpi_account_0, ..., cpi_account_n, target_program]
/// SwapIntent: remaining_accounts layout [swap_account_0, ..., swap_account_n, target_program];
///             vault must be writable in remaining_accounts.
///             When input_mint is native SOL, the program transfers SOL from vault to vault's
///             WSOL ATA and syncs native before invoking the swap (vault funds the swap).
fn execute_order_action<'info>(
    order_pda: Pubkey,
    vault_pda: Pubkey,
    order: &Order,
    program_id: &Pubkey,
    remaining_accounts: &[AccountInfo<'info>],
    swap_instruction_data: Option<&[u8]>,
) -> Result<()> {
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
    let vault_seeds: &[&[u8]] = &[
        b"vault",
        order_user.as_ref(),
        &order_id_bytes,
        &[vault_bump],
    ];

    match &order.action {
        OrderAction::Cpi(action) => {
            require!(
                is_whitelisted_program(action.program_id),
                OrderError::ProgramNotWhitelisted
            );

            let expected_len = action.accounts.len() + 1;
            require!(
                remaining_accounts.len() >= expected_len,
                OrderError::InsufficientAccounts
            );

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
        }
        OrderAction::SwapIntent(intent) => {
            let swap_data = swap_instruction_data.ok_or(OrderError::SwapIntentRequiresInstructionData)?;

            require!(
                is_whitelisted_program(intent.swap_program),
                OrderError::ProgramNotWhitelisted
            );

            require!(
                remaining_accounts.len() >= 2,
                OrderError::InsufficientAccounts
            );

            let vault_in_accounts = remaining_accounts
                .iter()
                .take(remaining_accounts.len() - 1)
                .any(|a| a.key() == vault_pda && a.is_writable);
            require!(
                vault_in_accounts,
                OrderError::VaultMustBeInSwapAccounts
            );

            let target_program_info = remaining_accounts.last().unwrap();
            require!(
                target_program_info.key() == intent.swap_program,
                OrderError::AccountMismatch
            );
            require!(
                target_program_info.executable,
                OrderError::ProgramNotWhitelisted
            );

            let cpi_account_metas: Vec<anchor_lang::solana_program::instruction::AccountMeta> =
                remaining_accounts
                    .iter()
                    .take(remaining_accounts.len() - 1)
                    .map(|a| anchor_lang::solana_program::instruction::AccountMeta {
                        pubkey: a.key(),
                        is_writable: a.is_writable,
                        is_signer: a.key() == order_pda || a.key() == vault_pda,
                    })
                    .collect();

            let instruction = anchor_lang::solana_program::instruction::Instruction {
                program_id: intent.swap_program,
                accounts: cpi_account_metas,
                data: swap_data.to_vec(),
            };

            let account_infos: Vec<AccountInfo> = remaining_accounts.iter().cloned().collect();

            anchor_lang::solana_program::program::invoke_signed(
                &instruction,
                &account_infos,
                &[order_seeds, vault_seeds],
            )?;
        }
    }

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

/// Swap program IDs (Jupiter, Raydium, Orca) for CPI whitelist.
pub mod swap_programs {
    use anchor_lang::prelude::*;

    pub const JUPITER: Pubkey = pubkey!("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
    pub const RAYDIUM_AMM: Pubkey = pubkey!("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8");
    pub const RAYDIUM_CLMM: Pubkey = pubkey!("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");
    pub const ORCA_WHIRLPOOLS: Pubkey = pubkey!("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
}

fn is_whitelisted_program(program_id: Pubkey) -> bool {
    use swap_programs;
    matches!(
        program_id,
        anchor_lang::system_program::ID
            | anchor_spl::token::ID
            | swap_programs::JUPITER
            | swap_programs::RAYDIUM_AMM
            | swap_programs::RAYDIUM_CLMM
            | swap_programs::ORCA_WHIRLPOOLS
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
    PriceAboveStork {
        feed_id: [u8; 32],
        min_price_q: i128,
        max_age_sec: u64,
    },
    StorkOutcomeEquals {
        feed_id: [u8; 32],
        expected_outcome_q: i128,
        max_age_sec: u64,
    },
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SwapIntent {
    pub swap_program: Pubkey,
    pub input_mint: Pubkey,
    pub output_mint: Pubkey,
    pub input_amount: u64,
    pub max_slippage_bps: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum OrderAction {
    Cpi(CpiAction),
    SwapIntent(SwapIntent),
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
    pub action: OrderAction,
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
    /// OrderAction = 1 byte discriminator + max(CpiAction, SwapIntent)
    const MAX_ORDER_ACTION_SIZE: usize = 1 + Self::MAX_CPI_ACTION_SIZE;

    pub const LEN: usize = 8
        + 32
        + 8
        + 8
        + Self::MAX_TRIGGER_SIZE
        + Self::MAX_ORDER_ACTION_SIZE
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
    pub token_program: Program<'info, anchor_spl::token::Token>,
}

#[derive(Accounts)]
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
    pub stork_feed: Account<'info, TemporalNumericValueFeed>,
    /// CHECK: Read-only user pubkey; validated via has_one on order.
    pub user: AccountInfo<'info>,
    #[account(mut)]
    pub keeper: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, anchor_spl::token::Token>,
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
    pub token_program: Program<'info, anchor_spl::token::Token>,
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
    #[msg("Invalid token account or ownership")]
    InvalidTokenAccount,
    #[msg("Token accounts must be passed as vault/user pairs")]
    InvalidTokenAccountPairs,
    #[msg("SwapIntent order requires swap_instruction_data")]
    SwapIntentRequiresInstructionData,
    #[msg("Vault must be writable in swap CPI accounts")]
    VaultMustBeInSwapAccounts,
    #[msg("Vault WSOL ATA must be in swap accounts for SOL input")]
    VaultWsolAtaAccountMissing,
    #[msg("Cpi order must not have swap_instruction_data")]
    CpiMustNotHaveSwapData,
}
