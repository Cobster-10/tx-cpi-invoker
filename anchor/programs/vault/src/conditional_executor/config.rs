// T013: Trusted signer selection (hardcoded default + optional Config PDA)

use anchor_lang::prelude::*;

use crate::conditional_executor::constants::DEFAULT_STORK_SIGNER;
use crate::conditional_executor::state::Config;

/// Get the trusted signer public key
///
/// If a Config account is provided and valid, use its signer.
/// Otherwise, fall back to the hardcoded default.
pub fn get_trusted_signer(config: Option<&Account<Config>>) -> Pubkey {
    match config {
        Some(cfg) => cfg.stork_signer_pubkey,
        None => Pubkey::new_from_array(DEFAULT_STORK_SIGNER),
    }
}

/// Check if a given pubkey matches the trusted signer
pub fn is_trusted_signer(pubkey: &Pubkey, config: Option<&Account<Config>>) -> bool {
    let trusted = get_trusted_signer(config);
    *pubkey == trusted
}
