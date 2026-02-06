// T010: Requirement PDA derivation helpers

use anchor_lang::prelude::*;

use crate::conditional_executor::constants::{CONFIG_SEED, REQUIREMENT_SEED};

/// Derive the Requirement PDA address
pub fn derive_requirement_pda(
    authority: &Pubkey,
    nonce: u64,
    program_id: &Pubkey,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            REQUIREMENT_SEED,
            authority.as_ref(),
            &nonce.to_le_bytes(),
        ],
        program_id,
    )
}

/// Derive the Config PDA address (singleton)
pub fn derive_config_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CONFIG_SEED], program_id)
}

/// Get Requirement PDA seeds for signing
pub fn requirement_signer_seeds<'a>(
    authority: &'a Pubkey,
    nonce: &'a [u8; 8],
    bump: &'a [u8; 1],
) -> [&'a [u8]; 4] {
    [REQUIREMENT_SEED, authority.as_ref(), nonce, bump]
}
