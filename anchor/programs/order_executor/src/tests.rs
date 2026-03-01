#[cfg(test)]
mod tests {
    use crate::{CpiAction, Order, OrderAction, SwapIntent, Trigger, UserOrderCounter, ID as PROGRAM_ID};

    use anchor_lang::{AccountDeserialize, AnchorSerialize};
    use anchor_spl::token::spl_token::{
        instruction as token_instruction,
        solana_program::program_pack::Pack,
        state::{Account as SplTokenAccount, Mint},
    };

    use litesvm::LiteSVM;
    use sha2::{Digest, Sha256};
    use solana_sdk::{
        instruction::{AccountMeta, Instruction},
        pubkey::Pubkey,
        signature::Keypair,
        signer::Signer,
        system_instruction, system_program,
        transaction::Transaction,
    };

    const LAMPORTS_PER_SOL: u64 = 1_000_000_000;

    fn ix_discriminator(ix_name: &str) -> [u8; 8] {
        let mut hasher = Sha256::new();
        hasher.update(b"global:");
        hasher.update(ix_name.as_bytes());
        let hash = hasher.finalize();
        let mut disc = [0u8; 8];
        disc.copy_from_slice(&hash[..8]);
        disc
    }

    fn get_order_counter_pda(user: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"order_counter", user.as_ref()], &PROGRAM_ID)
    }

    fn get_order_pda(user: &Pubkey, order_id: u64) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[b"order", user.as_ref(), &order_id.to_le_bytes()],
            &PROGRAM_ID,
        )
    }

    fn get_vault_pda(user: &Pubkey, order_id: u64) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[b"vault", user.as_ref(), &order_id.to_le_bytes()],
            &PROGRAM_ID,
        )
    }

    fn init_user_counter_ix(user: &Pubkey, order_counter_pda: &Pubkey) -> Instruction {
        let data = ix_discriminator("init_user_counter").to_vec();

        Instruction {
            program_id: PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(*user, true),
                AccountMeta::new(*order_counter_pda, false),
                AccountMeta::new_readonly(system_program::ID, false),
            ],
            data,
        }
    }

    fn create_order_ix(
        user: &Pubkey,
        order_counter_pda: &Pubkey,
        order_pda: &Pubkey,
        vault_pda: &Pubkey,
        input_amount: u64,
        trigger: Trigger,
        action: OrderAction,
        expires_slot: Option<u64>,
        execution_bounty: u64,
    ) -> Instruction {
        let mut data = ix_discriminator("create_order").to_vec();
        input_amount.serialize(&mut data).unwrap();
        trigger.serialize(&mut data).unwrap();
        action.serialize(&mut data).unwrap();
        expires_slot.serialize(&mut data).unwrap();
        execution_bounty.serialize(&mut data).unwrap();

        Instruction {
            program_id: PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(*user, true),
                AccountMeta::new(*order_counter_pda, false),
                AccountMeta::new(*order_pda, false),
                AccountMeta::new(*vault_pda, false),
                AccountMeta::new_readonly(system_program::ID, false),
            ],
            data,
        }
    }

    fn execute_order_if_ready_ix(
        order: &Pubkey,
        vault: &Pubkey,
        user: &Pubkey,
        keeper: &Pubkey,
        pda_account: &Pubkey,
        cpi_accounts_and_program: Vec<AccountMeta>,
        swap_instruction_data: Option<Vec<u8>>,
    ) -> Instruction {
        let mut data = ix_discriminator("execute_order_if_ready").to_vec();
        swap_instruction_data.serialize(&mut data).unwrap();

        let mut accounts = vec![
            AccountMeta::new(*order, false),
            AccountMeta::new(*vault, false),
            AccountMeta::new_readonly(*user, false),
            AccountMeta::new(*keeper, true),
            AccountMeta::new_readonly(*pda_account, false),
            AccountMeta::new_readonly(system_program::ID, false),
            AccountMeta::new_readonly(anchor_spl::token::ID, false),
        ];
        accounts.extend(cpi_accounts_and_program);

        Instruction {
            program_id: PROGRAM_ID,
            accounts,
            data,
        }
    }

    fn cancel_order_ix(
        user: &Pubkey,
        order: &Pubkey,
        vault: &Pubkey,
        order_id: u64,
    ) -> Instruction {
        let mut data = ix_discriminator("cancel_order").to_vec();
        order_id.serialize(&mut data).unwrap();

        Instruction {
            program_id: PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(*user, true),
                AccountMeta::new(*order, false),
                AccountMeta::new(*vault, false),
                AccountMeta::new_readonly(system_program::ID, false),
            ],
            data,
        }
    }

    fn close_order_ix(
        user: &Pubkey,
        order_counter: &Pubkey,
        order: &Pubkey,
        vault: &Pubkey,
        token_program: &Pubkey,
        order_id: u64,
        remaining_accounts: Vec<AccountMeta>,
    ) -> Instruction {
        let mut data = ix_discriminator("close_order").to_vec();
        order_id.serialize(&mut data).unwrap();

        let mut accounts = vec![
            AccountMeta::new(*user, true),
            AccountMeta::new(*order_counter, false),
            AccountMeta::new(*order, false),
            AccountMeta::new(*vault, false),
            AccountMeta::new_readonly(*token_program, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ];
        accounts.extend(remaining_accounts);

        Instruction {
            program_id: PROGRAM_ID,
            accounts,
            data,
        }
    }

    fn create_and_init_token_accounts(
        svm: &mut LiteSVM,
        payer: &Keypair,
        source_owner: &Pubkey,
        destination_owner: &Pubkey,
        mint_authority: &Keypair,
        initial_source_amount: u64,
    ) -> (Pubkey, Pubkey, Pubkey) {
        let mint = Keypair::new();
        let source = Keypair::new();
        let destination = Keypair::new();

        let mint_rent = svm.minimum_balance_for_rent_exemption(Mint::LEN);
        let token_rent = svm.minimum_balance_for_rent_exemption(SplTokenAccount::LEN);

        let create_mint_ix = system_instruction::create_account(
            &payer.pubkey(),
            &mint.pubkey(),
            mint_rent,
            Mint::LEN as u64,
            &anchor_spl::token::ID,
        );
        let init_mint_ix = token_instruction::initialize_mint2(
            &anchor_spl::token::ID,
            &mint.pubkey(),
            &mint_authority.pubkey(),
            None,
            0,
        )
        .expect("init mint ix");

        let create_source_ix = system_instruction::create_account(
            &payer.pubkey(),
            &source.pubkey(),
            token_rent,
            SplTokenAccount::LEN as u64,
            &anchor_spl::token::ID,
        );
        let init_source_ix = token_instruction::initialize_account3(
            &anchor_spl::token::ID,
            &source.pubkey(),
            &mint.pubkey(),
            source_owner,
        )
        .expect("init source token account ix");

        let create_destination_ix = system_instruction::create_account(
            &payer.pubkey(),
            &destination.pubkey(),
            token_rent,
            SplTokenAccount::LEN as u64,
            &anchor_spl::token::ID,
        );
        let init_destination_ix = token_instruction::initialize_account3(
            &anchor_spl::token::ID,
            &destination.pubkey(),
            &mint.pubkey(),
            destination_owner,
        )
        .expect("init destination token account ix");

        let mint_to_ix = token_instruction::mint_to(
            &anchor_spl::token::ID,
            &mint.pubkey(),
            &source.pubkey(),
            &mint_authority.pubkey(),
            &[],
            initial_source_amount,
        )
        .expect("mint_to ix");

        let tx = Transaction::new_signed_with_payer(
            &[
                create_mint_ix,
                init_mint_ix,
                create_source_ix,
                init_source_ix,
                create_destination_ix,
                init_destination_ix,
                mint_to_ix,
            ],
            Some(&payer.pubkey()),
            &[payer, &mint, &source, &destination, mint_authority],
            svm.latest_blockhash(),
        );
        svm.send_transaction(tx)
            .expect("token account/mint setup should succeed");

        (mint.pubkey(), source.pubkey(), destination.pubkey())
    }

    fn token_amount(svm: &LiteSVM, token_account: &Pubkey) -> u64 {
        let account = svm
            .get_account(token_account)
            .expect("token account missing in svm");
        let parsed = SplTokenAccount::unpack(&account.data).expect("unpack token account");
        parsed.amount
    }

    #[test]
    fn test_create_order_initializes_order_and_counter() {
        let mut svm = LiteSVM::new();
        let program_bytes = include_bytes!("../../../target/deploy/order_executor.so");
        svm.add_program(PROGRAM_ID, program_bytes)
            .expect("load order_executor program");

        let user = Keypair::new();
        svm.airdrop(&user.pubkey(), 10 * LAMPORTS_PER_SOL).unwrap();

        let (order_counter_pda, _) = get_order_counter_pda(&user.pubkey());
        let (order_pda, _) = get_order_pda(&user.pubkey(), 0);
        let (vault_pda, _) = get_vault_pda(&user.pubkey(), 0);

        let trigger = Trigger::TimeAfter { slot: 0 };
        let action = OrderAction::Cpi(CpiAction {
            program_id: system_program::ID,
            accounts: vec![],
            data: vec![],
        });

        let input_amount = LAMPORTS_PER_SOL;
        let execution_bounty = 10_000_000;

        // First: initialize the user counter
        let init_ix = init_user_counter_ix(&user.pubkey(), &order_counter_pda);
        let init_tx = Transaction::new_signed_with_payer(
            &[init_ix],
            Some(&user.pubkey()),
            &[&user],
            svm.latest_blockhash(),
        );
        let init_res = svm.send_transaction(init_tx);
        assert!(init_res.is_ok(), "init_user_counter should succeed");

        // Then: create the order
        let ix = create_order_ix(
            &user.pubkey(),
            &order_counter_pda,
            &order_pda,
            &vault_pda,
            input_amount,
            trigger,
            action,
            None,
            execution_bounty,
        );

        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&user.pubkey()),
            &[&user],
            svm.latest_blockhash(),
        );

        let res = svm.send_transaction(tx);
        assert!(res.is_ok(), "create_order should succeed");

        let order_acc = svm.get_account(&order_pda).expect("order account missing");
        let vault_acc = svm.get_account(&vault_pda).expect("vault account missing");
        assert!(vault_acc.lamports >= input_amount);

        let mut order_data = order_acc.data.as_slice();
        let order = Order::try_deserialize(&mut order_data).unwrap();
        assert_eq!(order.user, user.pubkey());
        assert_eq!(order.order_id, 0);
        assert_eq!(order.input_amount, input_amount);
        assert!(!order.executed);
        assert!(!order.canceled);

        let counter_acc = svm
            .get_account(&order_counter_pda)
            .expect("counter account missing");
        let mut counter_data = counter_acc.data.as_slice();
        let counter = UserOrderCounter::try_deserialize(&mut counter_data).unwrap();
        assert_eq!(counter.user, user.pubkey());
        assert_eq!(counter.next_order_id, 1);
        assert_eq!(counter.open_order_count, 1);
    }

    #[test]
    fn test_execute_order_if_ready_system_transfer_from_vault_succeeds() {
        let mut svm = LiteSVM::new();
        let program_bytes = include_bytes!("../../../target/deploy/order_executor.so");
        svm.add_program(PROGRAM_ID, program_bytes)
            .expect("load order_executor program");

        let user = Keypair::new();
        let keeper = Keypair::new();
        let recipient = Keypair::new();

        svm.airdrop(&user.pubkey(), 10 * LAMPORTS_PER_SOL).unwrap();
        svm.airdrop(&keeper.pubkey(), LAMPORTS_PER_SOL).unwrap();

        let (order_counter_pda, _) = get_order_counter_pda(&user.pubkey());
        let (order_pda, _) = get_order_pda(&user.pubkey(), 0);
        let (vault_pda, _) = get_vault_pda(&user.pubkey(), 0);

        let input_amount = LAMPORTS_PER_SOL;
        let transfer_amount = 100_000_000;
        let execution_bounty = 5_000_000;

        let transfer_ix =
            system_instruction::transfer(&vault_pda, &recipient.pubkey(), transfer_amount);
        let action = OrderAction::Cpi(CpiAction {
            program_id: system_program::ID,
            accounts: vec![
                crate::CpiAccount {
                    pubkey: vault_pda,
                    is_writable: true,
                },
                crate::CpiAccount {
                    pubkey: recipient.pubkey(),
                    is_writable: true,
                },
            ],
            data: transfer_ix.data,
        });

        let trigger = Trigger::TimeAfter { slot: 0 };

        // Init counter
        let init_ix = init_user_counter_ix(&user.pubkey(), &order_counter_pda);
        let init_tx = Transaction::new_signed_with_payer(
            &[init_ix],
            Some(&user.pubkey()),
            &[&user],
            svm.latest_blockhash(),
        );
        svm.send_transaction(init_tx)
            .expect("init_user_counter should succeed");

        // Create order
        let create_ix = create_order_ix(
            &user.pubkey(),
            &order_counter_pda,
            &order_pda,
            &vault_pda,
            input_amount,
            trigger,
            action,
            None,
            execution_bounty,
        );
        let create_tx = Transaction::new_signed_with_payer(
            &[create_ix],
            Some(&user.pubkey()),
            &[&user],
            svm.latest_blockhash(),
        );
        svm.send_transaction(create_tx)
            .expect("create_order should succeed");

        let recipient_before = svm
            .get_account(&recipient.pubkey())
            .map(|a| a.lamports)
            .unwrap_or(0);
        let keeper_before = svm
            .get_account(&keeper.pubkey())
            .expect("keeper account missing")
            .lamports;
        let vault_before = svm.get_account(&vault_pda).expect("vault missing").lamports;

        // Execute order (fixed ExecuteOrder accounts + remaining_accounts for CPI)
        let execute_ix = execute_order_if_ready_ix(
            &order_pda,
            &vault_pda,
            &user.pubkey(),
            &keeper.pubkey(),
            &order_pda, // unused for TimeAfter, but valid optional account
            vec![
                AccountMeta::new(vault_pda, false),
                AccountMeta::new(recipient.pubkey(), false),
                AccountMeta::new_readonly(system_program::ID, false),
            ],
            None,
        );
        let execute_tx = Transaction::new_signed_with_payer(
            &[execute_ix],
            Some(&user.pubkey()),
            &[&user, &keeper],
            svm.latest_blockhash(),
        );
        svm.send_transaction(execute_tx)
            .expect("execute_order_if_ready should succeed for vault transfer");

        let recipient_after = svm
            .get_account(&recipient.pubkey())
            .map(|a| a.lamports)
            .unwrap_or(0);
        let keeper_after = svm
            .get_account(&keeper.pubkey())
            .expect("keeper account missing")
            .lamports;
        let vault_after = svm.get_account(&vault_pda).expect("vault missing").lamports;

        assert_eq!(recipient_after, recipient_before + transfer_amount);
        assert_eq!(keeper_after, keeper_before + execution_bounty);
        assert_eq!(
            vault_after,
            vault_before - transfer_amount - execution_bounty
        );

        let order_acc = svm.get_account(&order_pda).expect("order account missing");
        let mut order_data = order_acc.data.as_slice();
        let order = Order::try_deserialize(&mut order_data).unwrap();
        assert!(order.executed, "order must be marked executed");
        assert!(!order.canceled, "order must not be canceled");
    }

    #[test]
    fn test_cancel_order_refunds_vault_and_marks_canceled() {
        let mut svm = LiteSVM::new();
        let program_bytes = include_bytes!("../../../target/deploy/order_executor.so");
        svm.add_program(PROGRAM_ID, program_bytes)
            .expect("load order_executor program");

        let user = Keypair::new();
        svm.airdrop(&user.pubkey(), 10 * LAMPORTS_PER_SOL).unwrap();

        let (order_counter_pda, _) = get_order_counter_pda(&user.pubkey());
        let (order_pda, _) = get_order_pda(&user.pubkey(), 0);
        let (vault_pda, _) = get_vault_pda(&user.pubkey(), 0);

        let input_amount = 500_000_000;
        let trigger = Trigger::TimeAfter { slot: u64::MAX };
        let action = OrderAction::Cpi(CpiAction {
            program_id: system_program::ID,
            accounts: vec![],
            data: vec![],
        });

        let init_ix = init_user_counter_ix(&user.pubkey(), &order_counter_pda);
        let init_tx = Transaction::new_signed_with_payer(
            &[init_ix],
            Some(&user.pubkey()),
            &[&user],
            svm.latest_blockhash(),
        );
        svm.send_transaction(init_tx)
            .expect("init_user_counter should succeed");

        let create_ix = create_order_ix(
            &user.pubkey(),
            &order_counter_pda,
            &order_pda,
            &vault_pda,
            input_amount,
            trigger,
            action,
            None,
            0,
        );
        let create_tx = Transaction::new_signed_with_payer(
            &[create_ix],
            Some(&user.pubkey()),
            &[&user],
            svm.latest_blockhash(),
        );
        svm.send_transaction(create_tx)
            .expect("create_order should succeed");

        let vault_before = svm.get_account(&vault_pda).expect("vault missing").lamports;
        assert!(vault_before >= input_amount);

        let cancel_ix = cancel_order_ix(&user.pubkey(), &order_pda, &vault_pda, 0);
        let cancel_tx = Transaction::new_signed_with_payer(
            &[cancel_ix],
            Some(&user.pubkey()),
            &[&user],
            svm.latest_blockhash(),
        );
        svm.send_transaction(cancel_tx)
            .expect("cancel_order should succeed");

        let vault_after = svm.get_account(&vault_pda).map(|a| a.lamports).unwrap_or(0);
        assert_eq!(vault_after, 0, "vault should be drained on cancel");

        let order_acc = svm.get_account(&order_pda).expect("order account missing");
        let mut order_data = order_acc.data.as_slice();
        let order = Order::try_deserialize(&mut order_data).unwrap();
        assert!(order.canceled, "order must be marked canceled");
        assert!(!order.executed, "order should remain unexecuted");
    }

    #[test]
    fn test_close_order_decrements_counter_and_closes_order_account() {
        let mut svm = LiteSVM::new();
        let program_bytes = include_bytes!("../../../target/deploy/order_executor.so");
        svm.add_program(PROGRAM_ID, program_bytes)
            .expect("load order_executor program");

        let user = Keypair::new();
        svm.airdrop(&user.pubkey(), 10 * LAMPORTS_PER_SOL).unwrap();

        let (order_counter_pda, _) = get_order_counter_pda(&user.pubkey());
        let (order_pda, _) = get_order_pda(&user.pubkey(), 0);
        let (vault_pda, _) = get_vault_pda(&user.pubkey(), 0);

        let trigger = Trigger::TimeAfter { slot: u64::MAX };
        let action = OrderAction::Cpi(CpiAction {
            program_id: system_program::ID,
            accounts: vec![],
            data: vec![],
        });

        let init_ix = init_user_counter_ix(&user.pubkey(), &order_counter_pda);
        let init_tx = Transaction::new_signed_with_payer(
            &[init_ix],
            Some(&user.pubkey()),
            &[&user],
            svm.latest_blockhash(),
        );
        svm.send_transaction(init_tx)
            .expect("init_user_counter should succeed");

        let create_ix = create_order_ix(
            &user.pubkey(),
            &order_counter_pda,
            &order_pda,
            &vault_pda,
            200_000_000,
            trigger,
            action,
            None,
            0,
        );
        let create_tx = Transaction::new_signed_with_payer(
            &[create_ix],
            Some(&user.pubkey()),
            &[&user],
            svm.latest_blockhash(),
        );
        svm.send_transaction(create_tx)
            .expect("create_order should succeed");

        let cancel_ix = cancel_order_ix(&user.pubkey(), &order_pda, &vault_pda, 0);
        let cancel_tx = Transaction::new_signed_with_payer(
            &[cancel_ix],
            Some(&user.pubkey()),
            &[&user],
            svm.latest_blockhash(),
        );
        svm.send_transaction(cancel_tx)
            .expect("cancel_order should succeed");

        let close_ix = close_order_ix(
            &user.pubkey(),
            &order_counter_pda,
            &order_pda,
            &vault_pda,
            &anchor_spl::token::ID,
            0,
            vec![],
        );
        let close_tx = Transaction::new_signed_with_payer(
            &[close_ix],
            Some(&user.pubkey()),
            &[&user],
            svm.latest_blockhash(),
        );
        svm.send_transaction(close_tx)
            .expect("close_order should succeed");

        let order_after = svm.get_account(&order_pda);
        assert!(order_after.is_none(), "order account should be closed");

        let counter_acc = svm
            .get_account(&order_counter_pda)
            .expect("counter account missing");
        let mut counter_data = counter_acc.data.as_slice();
        let counter = UserOrderCounter::try_deserialize(&mut counter_data).unwrap();
        assert_eq!(
            counter.open_order_count, 0,
            "open order count must decrement"
        );
    }

    #[test]
    fn test_execute_order_before_trigger_fails() {
        let mut svm = LiteSVM::new();
        let program_bytes = include_bytes!("../../../target/deploy/order_executor.so");
        svm.add_program(PROGRAM_ID, program_bytes)
            .expect("load order_executor program");

        let user = Keypair::new();
        let keeper = Keypair::new();
        let recipient = Keypair::new();
        svm.airdrop(&user.pubkey(), 10 * LAMPORTS_PER_SOL).unwrap();
        svm.airdrop(&keeper.pubkey(), LAMPORTS_PER_SOL).unwrap();

        let (order_counter_pda, _) = get_order_counter_pda(&user.pubkey());
        let (order_pda, _) = get_order_pda(&user.pubkey(), 0);
        let (vault_pda, _) = get_vault_pda(&user.pubkey(), 0);

        let transfer_ix = system_instruction::transfer(&vault_pda, &recipient.pubkey(), 1_000_000);
        let action = OrderAction::Cpi(CpiAction {
            program_id: system_program::ID,
            accounts: vec![
                crate::CpiAccount {
                    pubkey: vault_pda,
                    is_writable: true,
                },
                crate::CpiAccount {
                    pubkey: recipient.pubkey(),
                    is_writable: true,
                },
            ],
            data: transfer_ix.data,
        });

        let init_ix = init_user_counter_ix(&user.pubkey(), &order_counter_pda);
        let init_tx = Transaction::new_signed_with_payer(
            &[init_ix],
            Some(&user.pubkey()),
            &[&user],
            svm.latest_blockhash(),
        );
        svm.send_transaction(init_tx)
            .expect("init_user_counter should succeed");

        let create_ix = create_order_ix(
            &user.pubkey(),
            &order_counter_pda,
            &order_pda,
            &vault_pda,
            200_000_000,
            Trigger::TimeAfter { slot: u64::MAX },
            action,
            None,
            0,
        );
        let create_tx = Transaction::new_signed_with_payer(
            &[create_ix],
            Some(&user.pubkey()),
            &[&user],
            svm.latest_blockhash(),
        );
        svm.send_transaction(create_tx)
            .expect("create_order should succeed");

        let execute_ix = execute_order_if_ready_ix(
            &order_pda,
            &vault_pda,
            &user.pubkey(),
            &keeper.pubkey(),
            &order_pda,
            vec![
                AccountMeta::new(vault_pda, false),
                AccountMeta::new(recipient.pubkey(), false),
                AccountMeta::new_readonly(system_program::ID, false),
            ],
            None,
        );
        let execute_tx = Transaction::new_signed_with_payer(
            &[execute_ix],
            Some(&user.pubkey()),
            &[&user, &keeper],
            svm.latest_blockhash(),
        );
        let execute_res = svm.send_transaction(execute_tx);
        assert!(
            execute_res.is_err(),
            "execute_order_if_ready must fail before trigger slot"
        );
    }

    #[test]
    fn test_execute_order_missing_target_program_account_fails() {
        let mut svm = LiteSVM::new();
        let program_bytes = include_bytes!("../../../target/deploy/order_executor.so");
        svm.add_program(PROGRAM_ID, program_bytes)
            .expect("load order_executor program");

        let user = Keypair::new();
        let keeper = Keypair::new();
        let recipient = Keypair::new();
        svm.airdrop(&user.pubkey(), 10 * LAMPORTS_PER_SOL).unwrap();
        svm.airdrop(&keeper.pubkey(), LAMPORTS_PER_SOL).unwrap();

        let (order_counter_pda, _) = get_order_counter_pda(&user.pubkey());
        let (order_pda, _) = get_order_pda(&user.pubkey(), 0);
        let (vault_pda, _) = get_vault_pda(&user.pubkey(), 0);

        let transfer_ix = system_instruction::transfer(&vault_pda, &recipient.pubkey(), 1_000_000);
        let action = OrderAction::Cpi(CpiAction {
            program_id: system_program::ID,
            accounts: vec![
                crate::CpiAccount {
                    pubkey: vault_pda,
                    is_writable: true,
                },
                crate::CpiAccount {
                    pubkey: recipient.pubkey(),
                    is_writable: true,
                },
            ],
            data: transfer_ix.data,
        });

        let init_ix = init_user_counter_ix(&user.pubkey(), &order_counter_pda);
        let init_tx = Transaction::new_signed_with_payer(
            &[init_ix],
            Some(&user.pubkey()),
            &[&user],
            svm.latest_blockhash(),
        );
        svm.send_transaction(init_tx)
            .expect("init_user_counter should succeed");

        let create_ix = create_order_ix(
            &user.pubkey(),
            &order_counter_pda,
            &order_pda,
            &vault_pda,
            200_000_000,
            Trigger::TimeAfter { slot: 0 },
            action,
            None,
            0,
        );
        let create_tx = Transaction::new_signed_with_payer(
            &[create_ix],
            Some(&user.pubkey()),
            &[&user],
            svm.latest_blockhash(),
        );
        svm.send_transaction(create_tx)
            .expect("create_order should succeed");

        // Missing system_program here: only action.accounts are passed.
        let execute_ix = execute_order_if_ready_ix(
            &order_pda,
            &vault_pda,
            &user.pubkey(),
            &keeper.pubkey(),
            &order_pda,
            vec![
                AccountMeta::new(vault_pda, false),
                AccountMeta::new(recipient.pubkey(), false),
            ],
            None,
        );
        let execute_tx = Transaction::new_signed_with_payer(
            &[execute_ix],
            Some(&user.pubkey()),
            &[&user, &keeper],
            svm.latest_blockhash(),
        );
        let execute_res = svm.send_transaction(execute_tx);
        assert!(
            execute_res.is_err(),
            "execute_order_if_ready must fail when target program AccountInfo is missing"
        );
    }

    #[test]
    fn test_execute_order_with_wrong_cpi_account_fails() {
        let mut svm = LiteSVM::new();
        let program_bytes = include_bytes!("../../../target/deploy/order_executor.so");
        svm.add_program(PROGRAM_ID, program_bytes)
            .expect("load order_executor program");

        let user = Keypair::new();
        let keeper = Keypair::new();
        let recipient = Keypair::new();
        let wrong_recipient = Keypair::new();
        svm.airdrop(&user.pubkey(), 10 * LAMPORTS_PER_SOL).unwrap();
        svm.airdrop(&keeper.pubkey(), LAMPORTS_PER_SOL).unwrap();

        let (order_counter_pda, _) = get_order_counter_pda(&user.pubkey());
        let (order_pda, _) = get_order_pda(&user.pubkey(), 0);
        let (vault_pda, _) = get_vault_pda(&user.pubkey(), 0);

        let transfer_ix = system_instruction::transfer(&vault_pda, &recipient.pubkey(), 1_000_000);
        let action = OrderAction::Cpi(CpiAction {
            program_id: system_program::ID,
            accounts: vec![
                crate::CpiAccount {
                    pubkey: vault_pda,
                    is_writable: true,
                },
                crate::CpiAccount {
                    pubkey: recipient.pubkey(),
                    is_writable: true,
                },
            ],
            data: transfer_ix.data,
        });

        let init_ix = init_user_counter_ix(&user.pubkey(), &order_counter_pda);
        let init_tx = Transaction::new_signed_with_payer(
            &[init_ix],
            Some(&user.pubkey()),
            &[&user],
            svm.latest_blockhash(),
        );
        svm.send_transaction(init_tx)
            .expect("init_user_counter should succeed");

        let create_ix = create_order_ix(
            &user.pubkey(),
            &order_counter_pda,
            &order_pda,
            &vault_pda,
            200_000_000,
            Trigger::TimeAfter { slot: 0 },
            action,
            None,
            0,
        );
        let create_tx = Transaction::new_signed_with_payer(
            &[create_ix],
            Some(&user.pubkey()),
            &[&user],
            svm.latest_blockhash(),
        );
        svm.send_transaction(create_tx)
            .expect("create_order should succeed");

        // The stored action expects recipient, but we intentionally pass wrong_recipient.
        let execute_ix = execute_order_if_ready_ix(
            &order_pda,
            &vault_pda,
            &user.pubkey(),
            &keeper.pubkey(),
            &order_pda,
            vec![
                AccountMeta::new(vault_pda, false),
                AccountMeta::new(wrong_recipient.pubkey(), false),
                AccountMeta::new_readonly(system_program::ID, false),
            ],
            None,
        );
        let execute_tx = Transaction::new_signed_with_payer(
            &[execute_ix],
            Some(&user.pubkey()),
            &[&user, &keeper],
            svm.latest_blockhash(),
        );
        let execute_res = svm.send_transaction(execute_tx);
        assert!(
            execute_res.is_err(),
            "execute_order_if_ready must fail when remaining_accounts do not match stored action"
        );
    }

    #[test]
    fn test_cancel_order_by_non_owner_fails() {
        let mut svm = LiteSVM::new();
        let program_bytes = include_bytes!("../../../target/deploy/order_executor.so");
        svm.add_program(PROGRAM_ID, program_bytes)
            .expect("load order_executor program");

        let owner = Keypair::new();
        let attacker = Keypair::new();
        svm.airdrop(&owner.pubkey(), 10 * LAMPORTS_PER_SOL).unwrap();
        svm.airdrop(&attacker.pubkey(), LAMPORTS_PER_SOL).unwrap();

        let (order_counter_pda, _) = get_order_counter_pda(&owner.pubkey());
        let (order_pda, _) = get_order_pda(&owner.pubkey(), 0);
        let (vault_pda, _) = get_vault_pda(&owner.pubkey(), 0);

        let init_ix = init_user_counter_ix(&owner.pubkey(), &order_counter_pda);
        let init_tx = Transaction::new_signed_with_payer(
            &[init_ix],
            Some(&owner.pubkey()),
            &[&owner],
            svm.latest_blockhash(),
        );
        svm.send_transaction(init_tx)
            .expect("init_user_counter should succeed");

        let create_ix = create_order_ix(
            &owner.pubkey(),
            &order_counter_pda,
            &order_pda,
            &vault_pda,
            200_000_000,
            Trigger::TimeAfter { slot: u64::MAX },
            OrderAction::Cpi(CpiAction {
                program_id: system_program::ID,
                accounts: vec![],
                data: vec![],
            }),
            None,
            0,
        );
        let create_tx = Transaction::new_signed_with_payer(
            &[create_ix],
            Some(&owner.pubkey()),
            &[&owner],
            svm.latest_blockhash(),
        );
        svm.send_transaction(create_tx)
            .expect("create_order should succeed");

        let cancel_ix = cancel_order_ix(&attacker.pubkey(), &order_pda, &vault_pda, 0);
        let cancel_tx = Transaction::new_signed_with_payer(
            &[cancel_ix],
            Some(&attacker.pubkey()),
            &[&attacker],
            svm.latest_blockhash(),
        );
        let cancel_res = svm.send_transaction(cancel_tx);
        assert!(
            cancel_res.is_err(),
            "non-owner must not be able to cancel owner order"
        );
    }

    #[test]
    fn test_execute_order_if_ready_token_transfer_from_vault_authority_succeeds() {
        let mut svm = LiteSVM::new();
        let program_bytes = include_bytes!("../../../target/deploy/order_executor.so");
        svm.add_program(PROGRAM_ID, program_bytes)
            .expect("load order_executor program");

        let user = Keypair::new();
        let keeper = Keypair::new();
        let destination_owner = Keypair::new();
        let mint_authority = Keypair::new();

        svm.airdrop(&user.pubkey(), 10 * LAMPORTS_PER_SOL).unwrap();
        svm.airdrop(&keeper.pubkey(), LAMPORTS_PER_SOL).unwrap();

        let (order_counter_pda, _) = get_order_counter_pda(&user.pubkey());
        let (order_pda, _) = get_order_pda(&user.pubkey(), 0);
        let (vault_pda, _) = get_vault_pda(&user.pubkey(), 0);

        let init_ix = init_user_counter_ix(&user.pubkey(), &order_counter_pda);
        let init_tx = Transaction::new_signed_with_payer(
            &[init_ix],
            Some(&user.pubkey()),
            &[&user],
            svm.latest_blockhash(),
        );
        svm.send_transaction(init_tx)
            .expect("init_user_counter should succeed");

        let (_, source_token_account, destination_token_account) = create_and_init_token_accounts(
            &mut svm,
            &user,
            &vault_pda,
            &destination_owner.pubkey(),
            &mint_authority,
            1_000_000,
        );

        let transfer_amount = 150_000;
        let transfer_ix = token_instruction::transfer(
            &anchor_spl::token::ID,
            &source_token_account,
            &destination_token_account,
            &vault_pda,
            &[],
            transfer_amount,
        )
        .expect("spl token transfer ix");

        let action = OrderAction::Cpi(CpiAction {
            program_id: anchor_spl::token::ID,
            accounts: vec![
                crate::CpiAccount {
                    pubkey: source_token_account,
                    is_writable: true,
                },
                crate::CpiAccount {
                    pubkey: destination_token_account,
                    is_writable: true,
                },
                crate::CpiAccount {
                    pubkey: vault_pda,
                    is_writable: false,
                },
            ],
            data: transfer_ix.data,
        });

        let create_ix = create_order_ix(
            &user.pubkey(),
            &order_counter_pda,
            &order_pda,
            &vault_pda,
            100_000_000,
            Trigger::TimeAfter { slot: 0 },
            action,
            None,
            0,
        );
        let create_tx = Transaction::new_signed_with_payer(
            &[create_ix],
            Some(&user.pubkey()),
            &[&user],
            svm.latest_blockhash(),
        );
        svm.send_transaction(create_tx)
            .expect("create_order should succeed");

        let source_before = token_amount(&svm, &source_token_account);
        let destination_before = token_amount(&svm, &destination_token_account);

        let execute_ix = execute_order_if_ready_ix(
            &order_pda,
            &vault_pda,
            &user.pubkey(),
            &keeper.pubkey(),
            &order_pda,
            vec![
                AccountMeta::new(source_token_account, false),
                AccountMeta::new(destination_token_account, false),
                AccountMeta::new_readonly(vault_pda, false),
                AccountMeta::new_readonly(anchor_spl::token::ID, false),
            ],
            None,
        );
        let execute_tx = Transaction::new_signed_with_payer(
            &[execute_ix],
            Some(&user.pubkey()),
            &[&user, &keeper],
            svm.latest_blockhash(),
        );
        svm.send_transaction(execute_tx)
            .expect("execute_order_if_ready should succeed for spl token transfer");

        let source_after = token_amount(&svm, &source_token_account);
        let destination_after = token_amount(&svm, &destination_token_account);
        assert_eq!(source_after, source_before - transfer_amount);
        assert_eq!(destination_after, destination_before + transfer_amount);
    }

    #[test]
    fn test_execute_order_if_ready_token_transfer_wrong_authority_fails() {
        let mut svm = LiteSVM::new();
        let program_bytes = include_bytes!("../../../target/deploy/order_executor.so");
        svm.add_program(PROGRAM_ID, program_bytes)
            .expect("load order_executor program");

        let user = Keypair::new();
        let keeper = Keypair::new();
        let destination_owner = Keypair::new();
        let mint_authority = Keypair::new();
        let source_owner = Keypair::new();

        svm.airdrop(&user.pubkey(), 10 * LAMPORTS_PER_SOL).unwrap();
        svm.airdrop(&keeper.pubkey(), LAMPORTS_PER_SOL).unwrap();

        let (order_counter_pda, _) = get_order_counter_pda(&user.pubkey());
        let (order_pda, _) = get_order_pda(&user.pubkey(), 0);
        let (vault_pda, _) = get_vault_pda(&user.pubkey(), 0);

        let init_ix = init_user_counter_ix(&user.pubkey(), &order_counter_pda);
        let init_tx = Transaction::new_signed_with_payer(
            &[init_ix],
            Some(&user.pubkey()),
            &[&user],
            svm.latest_blockhash(),
        );
        svm.send_transaction(init_tx)
            .expect("init_user_counter should succeed");

        // Source token account owner is NOT the vault PDA.
        let (_, source_token_account, destination_token_account) = create_and_init_token_accounts(
            &mut svm,
            &user,
            &source_owner.pubkey(),
            &destination_owner.pubkey(),
            &mint_authority,
            1_000_000,
        );

        let transfer_ix = token_instruction::transfer(
            &anchor_spl::token::ID,
            &source_token_account,
            &destination_token_account,
            &vault_pda,
            &[],
            100_000,
        )
        .expect("spl token transfer ix");

        let action = OrderAction::Cpi(CpiAction {
            program_id: anchor_spl::token::ID,
            accounts: vec![
                crate::CpiAccount {
                    pubkey: source_token_account,
                    is_writable: true,
                },
                crate::CpiAccount {
                    pubkey: destination_token_account,
                    is_writable: true,
                },
                crate::CpiAccount {
                    pubkey: vault_pda,
                    is_writable: false,
                },
            ],
            data: transfer_ix.data,
        });

        let create_ix = create_order_ix(
            &user.pubkey(),
            &order_counter_pda,
            &order_pda,
            &vault_pda,
            100_000_000,
            Trigger::TimeAfter { slot: 0 },
            action,
            None,
            0,
        );
        let create_tx = Transaction::new_signed_with_payer(
            &[create_ix],
            Some(&user.pubkey()),
            &[&user],
            svm.latest_blockhash(),
        );
        svm.send_transaction(create_tx)
            .expect("create_order should succeed");

        let execute_ix = execute_order_if_ready_ix(
            &order_pda,
            &vault_pda,
            &user.pubkey(),
            &keeper.pubkey(),
            &order_pda,
            vec![
                AccountMeta::new(source_token_account, false),
                AccountMeta::new(destination_token_account, false),
                AccountMeta::new_readonly(vault_pda, false),
                AccountMeta::new_readonly(anchor_spl::token::ID, false),
            ],
            None,
        );
        let execute_tx = Transaction::new_signed_with_payer(
            &[execute_ix],
            Some(&user.pubkey()),
            &[&user, &keeper],
            svm.latest_blockhash(),
        );
        let execute_res = svm.send_transaction(execute_tx);
        assert!(
            execute_res.is_err(),
            "execute_order_if_ready must fail when vault PDA is not token authority"
        );
    }

    #[test]
    fn test_close_order_drains_vault_token_accounts_to_user() {
        let mut svm = LiteSVM::new();
        let program_bytes = include_bytes!("../../../target/deploy/order_executor.so");
        svm.add_program(PROGRAM_ID, program_bytes)
            .expect("load order_executor program");

        let user = Keypair::new();
        let keeper = Keypair::new();
        let recipient = Keypair::new();
        let mint_authority = Keypair::new();

        svm.airdrop(&user.pubkey(), 10 * LAMPORTS_PER_SOL).unwrap();
        svm.airdrop(&keeper.pubkey(), LAMPORTS_PER_SOL).unwrap();

        let (order_counter_pda, _) = get_order_counter_pda(&user.pubkey());
        let (order_pda, _) = get_order_pda(&user.pubkey(), 0);
        let (vault_pda, _) = get_vault_pda(&user.pubkey(), 0);

        let init_ix = init_user_counter_ix(&user.pubkey(), &order_counter_pda);
        let init_tx = Transaction::new_signed_with_payer(
            &[init_ix],
            Some(&user.pubkey()),
            &[&user],
            svm.latest_blockhash(),
        );
        svm.send_transaction(init_tx)
            .expect("init_user_counter should succeed");

        // Create vault_ata (vault-owned) and user_ata with tokens in vault
        let (_, vault_token_account, user_token_account) = create_and_init_token_accounts(
            &mut svm,
            &user,
            &vault_pda,
            &user.pubkey(),
            &mint_authority,
            500_000,
        );

        let transfer_amount = 100_000_000u64;
        let transfer_ix =
            system_instruction::transfer(&vault_pda, &recipient.pubkey(), transfer_amount);
        let action = OrderAction::Cpi(CpiAction {
            program_id: system_program::ID,
            accounts: vec![
                crate::CpiAccount {
                    pubkey: vault_pda,
                    is_writable: true,
                },
                crate::CpiAccount {
                    pubkey: recipient.pubkey(),
                    is_writable: true,
                },
            ],
            data: transfer_ix.data,
        });

        let create_ix = create_order_ix(
            &user.pubkey(),
            &order_counter_pda,
            &order_pda,
            &vault_pda,
            transfer_amount + 500_000_000,
            Trigger::TimeAfter { slot: 0 },
            action,
            None,
            0,
        );
        let create_tx = Transaction::new_signed_with_payer(
            &[create_ix],
            Some(&user.pubkey()),
            &[&user],
            svm.latest_blockhash(),
        );
        svm.send_transaction(create_tx)
            .expect("create_order should succeed");

        let execute_ix = execute_order_if_ready_ix(
            &order_pda,
            &vault_pda,
            &user.pubkey(),
            &keeper.pubkey(),
            &order_pda,
            vec![
                AccountMeta::new(vault_pda, false),
                AccountMeta::new(recipient.pubkey(), false),
                AccountMeta::new_readonly(system_program::ID, false),
            ],
            None,
        );
        let execute_tx = Transaction::new_signed_with_payer(
            &[execute_ix],
            Some(&user.pubkey()),
            &[&user, &keeper],
            svm.latest_blockhash(),
        );
        svm.send_transaction(execute_tx)
            .expect("execute_order_if_ready should succeed");

        let vault_token_before = token_amount(&svm, &vault_token_account);
        let user_token_before = token_amount(&svm, &user_token_account);
        assert_eq!(vault_token_before, 500_000, "vault should have tokens before close");
        assert_eq!(user_token_before, 0, "user should have 0 tokens before close");

        let close_ix = close_order_ix(
            &user.pubkey(),
            &order_counter_pda,
            &order_pda,
            &vault_pda,
            &anchor_spl::token::ID,
            0,
            vec![
                AccountMeta::new(vault_token_account, false),
                AccountMeta::new(user_token_account, false),
            ],
        );
        let close_tx = Transaction::new_signed_with_payer(
            &[close_ix],
            Some(&user.pubkey()),
            &[&user],
            svm.latest_blockhash(),
        );
        svm.send_transaction(close_tx)
            .expect("close_order with token drain should succeed");

        let vault_token_after = token_amount(&svm, &vault_token_account);
        let user_token_after = token_amount(&svm, &user_token_account);
        assert_eq!(vault_token_after, 0, "vault token account should be drained");
        assert_eq!(
            user_token_after, 500_000,
            "user should receive all tokens from vault"
        );

        let order_after = svm.get_account(&order_pda);
        assert!(order_after.is_none(), "order account should be closed");
    }

    const NATIVE_SOL_MINT: Pubkey = solana_sdk::pubkey!("So11111111111111111111111111111111111111112");
    const USDC_MINT: Pubkey = solana_sdk::pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

    #[test]
    fn test_create_order_swap_intent() {
        let mut svm = LiteSVM::new();
        let program_bytes = include_bytes!("../../../target/deploy/order_executor.so");
        svm.add_program(PROGRAM_ID, program_bytes)
            .expect("load order_executor program");

        let user = Keypair::new();
        svm.airdrop(&user.pubkey(), 10 * LAMPORTS_PER_SOL).unwrap();

        let (order_counter_pda, _) = get_order_counter_pda(&user.pubkey());
        let (order_pda, _) = get_order_pda(&user.pubkey(), 0);
        let (vault_pda, _) = get_vault_pda(&user.pubkey(), 0);

        let swap_amount = 100_000_000u64;
        let input_amount = swap_amount + 500_000_000;
        let intent = SwapIntent {
            swap_program: crate::swap_programs::JUPITER,
            input_mint: NATIVE_SOL_MINT,
            output_mint: USDC_MINT,
            input_amount: swap_amount,
            max_slippage_bps: 100,
        };
        let action = OrderAction::SwapIntent(intent);
        let trigger = Trigger::TimeAfter { slot: u64::MAX };

        let init_ix = init_user_counter_ix(&user.pubkey(), &order_counter_pda);
        let init_tx = Transaction::new_signed_with_payer(
            &[init_ix],
            Some(&user.pubkey()),
            &[&user],
            svm.latest_blockhash(),
        );
        svm.send_transaction(init_tx)
            .expect("init_user_counter should succeed");

        let create_ix = create_order_ix(
            &user.pubkey(),
            &order_counter_pda,
            &order_pda,
            &vault_pda,
            input_amount,
            trigger,
            action,
            None,
            0,
        );
        let create_tx = Transaction::new_signed_with_payer(
            &[create_ix],
            Some(&user.pubkey()),
            &[&user],
            svm.latest_blockhash(),
        );
        svm.send_transaction(create_tx)
            .expect("create_order with SwapIntent should succeed");

        let order_acc = svm.get_account(&order_pda).expect("order account missing");
        let vault_acc = svm.get_account(&vault_pda).expect("vault account missing");
        assert!(vault_acc.lamports >= input_amount);

        let mut order_data = order_acc.data.as_slice();
        let order = Order::try_deserialize(&mut order_data).unwrap();
        assert_eq!(order.user, user.pubkey());
        assert_eq!(order.order_id, 0);
        assert_eq!(order.input_amount, input_amount);
        assert!(!order.executed);
        assert!(!order.canceled);

        if let OrderAction::SwapIntent(intent) = &order.action {
            assert_eq!(intent.swap_program, crate::swap_programs::JUPITER);
            assert_eq!(intent.input_mint, NATIVE_SOL_MINT);
            assert_eq!(intent.output_mint, USDC_MINT);
            assert_eq!(intent.input_amount, swap_amount);
            assert_eq!(intent.max_slippage_bps, 100);
        } else {
            panic!("expected SwapIntent action");
        }
    }

    #[test]
    fn test_execute_order_swap_intent() {
        let mut svm = LiteSVM::new();
        let program_bytes = include_bytes!("../../../target/deploy/order_executor.so");
        svm.add_program(PROGRAM_ID, program_bytes)
            .expect("load order_executor program");

        let user = Keypair::new();
        let keeper = Keypair::new();
        let recipient = Keypair::new();

        svm.airdrop(&user.pubkey(), 10 * LAMPORTS_PER_SOL).unwrap();
        svm.airdrop(&keeper.pubkey(), LAMPORTS_PER_SOL).unwrap();

        let (order_counter_pda, _) = get_order_counter_pda(&user.pubkey());
        let (order_pda, _) = get_order_pda(&user.pubkey(), 0);
        let (vault_pda, _) = get_vault_pda(&user.pubkey(), 0);

        let transfer_amount = 100_000_000u64;
        let input_amount = transfer_amount + 500_000_000;
        // Use USDC as input_mint so wrap logic doesn't run (avoids native mint in LiteSVM)
        let intent = SwapIntent {
            swap_program: system_program::ID,
            input_mint: USDC_MINT,
            output_mint: USDC_MINT,
            input_amount: transfer_amount,
            max_slippage_bps: 100,
        };
        let action = OrderAction::SwapIntent(intent);
        let trigger = Trigger::TimeAfter { slot: 0 };

        let init_ix = init_user_counter_ix(&user.pubkey(), &order_counter_pda);
        let init_tx = Transaction::new_signed_with_payer(
            &[init_ix],
            Some(&user.pubkey()),
            &[&user],
            svm.latest_blockhash(),
        );
        svm.send_transaction(init_tx)
            .expect("init_user_counter should succeed");

        let create_ix = create_order_ix(
            &user.pubkey(),
            &order_counter_pda,
            &order_pda,
            &vault_pda,
            input_amount,
            trigger,
            action,
            None,
            0,
        );
        let create_tx = Transaction::new_signed_with_payer(
            &[create_ix],
            Some(&user.pubkey()),
            &[&user],
            svm.latest_blockhash(),
        );
        svm.send_transaction(create_tx)
            .expect("create_order with SwapIntent should succeed");

        let recipient_before = svm
            .get_account(&recipient.pubkey())
            .map(|a| a.lamports)
            .unwrap_or(0);

        let transfer_ix = system_instruction::transfer(&vault_pda, &recipient.pubkey(), transfer_amount);
        let swap_instruction_data = transfer_ix.data;

        let execute_ix = execute_order_if_ready_ix(
            &order_pda,
            &vault_pda,
            &user.pubkey(),
            &keeper.pubkey(),
            &order_pda,
            vec![
                AccountMeta::new(vault_pda, false),
                AccountMeta::new(recipient.pubkey(), false),
                AccountMeta::new_readonly(system_program::ID, false),
            ],
            Some(swap_instruction_data),
        );
        let execute_tx = Transaction::new_signed_with_payer(
            &[execute_ix],
            Some(&keeper.pubkey()),
            &[&keeper],
            svm.latest_blockhash(),
        );
        svm.send_transaction(execute_tx)
            .expect("execute_order_if_ready with SwapIntent should succeed");

        let recipient_after = svm
            .get_account(&recipient.pubkey())
            .map(|a| a.lamports)
            .unwrap_or(0);
        assert_eq!(recipient_after, recipient_before + transfer_amount);

        let order_acc = svm.get_account(&order_pda).expect("order account missing");
        let mut order_data = order_acc.data.as_slice();
        let order = Order::try_deserialize(&mut order_data).unwrap();
        assert!(order.executed);
    }
}
