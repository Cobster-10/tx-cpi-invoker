// T007 + T020: Hash helper for accounts_hash

use anchor_lang::prelude::*;
use sha2::{Sha256, Digest};

use crate::conditional_executor::types::AccountMetaInput;

/// Compute a deterministic SHA256 hash of account metas for CPI binding.
///
/// The hash covers: pubkey (32) + is_signer (1) + is_writable (1) for each account,
/// concatenated in order.
pub fn compute_accounts_hash(accounts: &[AccountMetaInput]) -> [u8; 32] {
    let mut hasher = Sha256::new();

    for meta in accounts {
        hasher.update(meta.pubkey.as_ref());
        hasher.update(&[if meta.is_signer { 1 } else { 0 }]);
        hasher.update(&[if meta.is_writable { 1 } else { 0 }]);
    }

    hasher.finalize().into()
}

/// Verify that remaining accounts match the stored accounts hash
pub fn verify_accounts_hash(
    remaining_accounts: &[AccountInfo],
    stored_hash: &[u8; 32],
) -> bool {
    let metas: Vec<AccountMetaInput> = remaining_accounts
        .iter()
        .map(|acc| AccountMetaInput {
            pubkey: *acc.key,
            is_signer: acc.is_signer,
            is_writable: acc.is_writable,
        })
        .collect();

    let computed = compute_accounts_hash(&metas);
    computed == *stored_hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_accounts_hash() {
        let hash = compute_accounts_hash(&[]);
        // Should produce a valid 32-byte hash
        assert_eq!(hash.len(), 32);
    }

    #[test]
    fn test_accounts_hash_deterministic() {
        let accounts = vec![
            AccountMetaInput {
                pubkey: Pubkey::new_unique(),
                is_signer: true,
                is_writable: false,
            },
            AccountMetaInput {
                pubkey: Pubkey::new_unique(),
                is_signer: false,
                is_writable: true,
            },
        ];

        let hash1 = compute_accounts_hash(&accounts);
        let hash2 = compute_accounts_hash(&accounts);
        assert_eq!(hash1, hash2);
    }
}
