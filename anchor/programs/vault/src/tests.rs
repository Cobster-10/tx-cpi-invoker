#[cfg(test)]
mod tests {
    use crate::{CpiAction, Order, Trigger, UserOrderCounter, ID as PROGRAM_ID};

    use anchor_lang::{AccountDeserialize, AnchorSerialize};

    use litesvm::LiteSVM;
    use sha2::{Digest, Sha256};
    use solana_sdk::{
        instruction::{AccountMeta, Instruction},
        pubkey::Pubkey,
        signature::Keypair,
        signer::Signer,
        system_program,
        transaction::Transaction,
    };

    const LAMPORTS_PER_SOL: u64 = 1_000_000_000;

    //helper function to calculate the instruction discriminator for a given instruction
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

    fn create_order_ix(
        user: &Pubkey,
        order_counter_pda: &Pubkey,
        order_pda: &Pubkey,
        input_amount: u64,
        trigger: Trigger,
        action: CpiAction,
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
                AccountMeta::new_readonly(system_program::ID, false),
            ],
            data,
        }
    }

    #[test]
    fn test_create_order_initializes_order_and_counter() {
        let mut svm = LiteSVM::new();
        let program_bytes = include_bytes!("../../../target/deploy/vault.so");
        svm.add_program(PROGRAM_ID, program_bytes);

        let user = Keypair::new();
        svm.airdrop(&user.pubkey(), 10 * LAMPORTS_PER_SOL).unwrap();

        let (order_counter_pda, _) = get_order_counter_pda(&user.pubkey());
        let (order_pda, _) = get_order_pda(&user.pubkey(), 0); // first order id should be 0

        let trigger = Trigger::TimeAfter { slot: 0 };
        let action = CpiAction {
            program_id: system_program::ID, // whitelisted
            accounts: vec![],
            data: vec![],
        };

        let input_amount = LAMPORTS_PER_SOL;
        let execution_bounty = 10_000_000;

        let ix = create_order_ix(
            &user.pubkey(),
            &order_counter_pda,
            &order_pda,
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
        assert!(order_acc.lamports >= input_amount);

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
}
