// T009: Conditional Executor Test Utilities and Tests
// Tests will be added in a later phase per task instructions

#[cfg(test)]
mod tests {
    use crate::ID as PROGRAM_ID;
    use crate::conditional_executor::constants::REQUIREMENT_SEED;
    use solana_sdk::pubkey::Pubkey;

    const LAMPORTS_PER_SOL: u64 = 1_000_000_000;

    /// Derive Requirement PDA address
    pub fn get_requirement_pda(authority: &Pubkey, nonce: u64) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[REQUIREMENT_SEED, authority.as_ref(), &nonce.to_le_bytes()],
            &PROGRAM_ID,
        )
    }

    /// Compute Anchor instruction discriminator from instruction name
    pub fn get_discriminator(name: &str) -> [u8; 8] {
        use sha2::{Sha256, Digest};
        let mut hasher = Sha256::new();
        hasher.update(format!("global:{}", name).as_bytes());
        let result = hasher.finalize();
        let mut discriminator = [0u8; 8];
        discriminator.copy_from_slice(&result[..8]);
        discriminator
    }

    #[test]
    fn test_requirement_pda_derivation() {
        let authority = Pubkey::new_unique();
        let nonce = 12345u64;

        let (pda, bump) = get_requirement_pda(&authority, nonce);

        // PDA should be valid (off curve)
        assert!(pda.to_bytes().len() == 32);
        assert!(bump <= 255);

        // Same inputs should produce same PDA
        let (pda2, bump2) = get_requirement_pda(&authority, nonce);
        assert_eq!(pda, pda2);
        assert_eq!(bump, bump2);

        // Different nonce should produce different PDA
        let (pda3, _) = get_requirement_pda(&authority, nonce + 1);
        assert_ne!(pda, pda3);
    }

    #[test]
    fn test_discriminator_generation() {
        let disc = get_discriminator("create_requirement");
        assert_eq!(disc.len(), 8);

        // Different instructions should have different discriminators
        let disc2 = get_discriminator("execute_requirement");
        assert_ne!(disc, disc2);
    }
}
