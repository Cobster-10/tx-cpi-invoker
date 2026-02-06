// T028: Ed25519 instruction inspection via Instructions Sysvar

use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::{
    load_current_index_checked, load_instruction_at_checked,
};

use crate::conditional_executor::error::ExecutorError;

/// Ed25519 program ID (Solana native program for signature verification)
/// Address: Ed25519SigVerify111111111111111111111111111
pub fn ed25519_program_id() -> Pubkey {
    // Ed25519SigVerify111111111111111111111111111 as bytes
    Pubkey::new_from_array([
        0x03, 0x7d, 0xbb, 0x0e, 0x40, 0x1b, 0x9f, 0x30, 0x4c, 0x82, 0x99, 0x29, 0x6a, 0xc0, 0xbe,
        0xef, 0xa0, 0x35, 0xf1, 0x1a, 0x5d, 0xb2, 0x65, 0xfb, 0x66, 0x68, 0xc8, 0xfc, 0x21, 0x73,
        0x73, 0x00,
    ])
}

/// Minimum length of ed25519 verify instruction data
const ED25519_IX_DATA_MIN_LEN: usize = 2 + 16; // header + one signature entry

/// Ed25519 signature entry offsets (per Solana ed25519_program layout)
/// Each entry: 2 bytes for signature_offset, 2 for signature_ix_index,
/// 2 for pubkey_offset, 2 for pubkey_ix_index,
/// 2 for message_offset, 2 for message_len, 2 for message_ix_index
const SIGNATURE_ENTRY_SIZE: usize = 14;

/// Verify that an ed25519 signature verification instruction exists in the current transaction
/// for the given public key and message.
///
/// This inspects prior instructions in the transaction to find a matching ed25519 verify.
pub fn verify_ed25519_instruction(
    instructions_sysvar: &AccountInfo,
    expected_pubkey: &Pubkey,
    expected_message: &[u8],
) -> Result<()> {
    // Get current instruction index
    let current_index = load_current_index_checked(instructions_sysvar)
        .map_err(|_| ExecutorError::Ed25519VerifyNotFound)?;

    // Search backwards for ed25519 verify instructions
    for i in 0..current_index {
        if let Ok(ix) = load_instruction_at_checked(i as usize, instructions_sysvar) {
            if ix.program_id == ed25519_program_id() {
                // Found an ed25519 instruction, check if it matches our requirements
                if verify_ed25519_ix_data(&ix.data, expected_pubkey, expected_message) {
                    return Ok(());
                }
            }
        }
    }

    Err(ExecutorError::Ed25519VerifyNotFound.into())
}

/// Parse ed25519 instruction data and check if it verifies the expected pubkey+message
fn verify_ed25519_ix_data(data: &[u8], expected_pubkey: &Pubkey, expected_message: &[u8]) -> bool {
    if data.len() < ED25519_IX_DATA_MIN_LEN {
        return false;
    }

    // First byte is number of signatures
    let num_signatures = data[0] as usize;
    if num_signatures == 0 {
        return false;
    }

    // Skip padding byte at index 1, signature entries start at index 2
    let mut offset = 2;

    for _ in 0..num_signatures {
        if offset + SIGNATURE_ENTRY_SIZE > data.len() {
            return false;
        }

        // Parse signature entry
        let _sig_offset = u16::from_le_bytes([data[offset], data[offset + 1]]) as usize;
        let _sig_ix_index = u16::from_le_bytes([data[offset + 2], data[offset + 3]]);
        let pubkey_offset = u16::from_le_bytes([data[offset + 4], data[offset + 5]]) as usize;
        let _pubkey_ix_index = u16::from_le_bytes([data[offset + 6], data[offset + 7]]);
        let msg_offset = u16::from_le_bytes([data[offset + 8], data[offset + 9]]) as usize;
        let msg_len = u16::from_le_bytes([data[offset + 10], data[offset + 11]]) as usize;
        let _msg_ix_index = u16::from_le_bytes([data[offset + 12], data[offset + 13]]);

        offset += SIGNATURE_ENTRY_SIZE;

        // Validate we can read the pubkey and message from data
        if pubkey_offset + 32 > data.len() || msg_offset + msg_len > data.len() {
            continue;
        }

        // Extract pubkey and message
        let pubkey_bytes: [u8; 32] = match data[pubkey_offset..pubkey_offset + 32].try_into() {
            Ok(b) => b,
            Err(_) => continue,
        };
        let msg_bytes = &data[msg_offset..msg_offset + msg_len];

        // Check if this matches our expected values
        if Pubkey::new_from_array(pubkey_bytes) == *expected_pubkey && msg_bytes == expected_message
        {
            return true;
        }
    }

    false
}

/// Simple check: is there any ed25519 verify instruction in the transaction?
pub fn has_ed25519_instruction(instructions_sysvar: &AccountInfo) -> Result<bool> {
    let current_index = load_current_index_checked(instructions_sysvar)
        .map_err(|_| ExecutorError::Ed25519VerifyNotFound)?;

    for i in 0..current_index {
        if let Ok(ix) = load_instruction_at_checked(i as usize, instructions_sysvar) {
            if ix.program_id == ed25519_program_id() {
                return Ok(true);
            }
        }
    }

    Ok(false)
}
