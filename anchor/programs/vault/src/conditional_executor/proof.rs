// T012 + T029: Proof message parsing and freshness checks

use anchor_lang::prelude::*;

use crate::conditional_executor::constants::{DEFAULT_MAX_FUTURE_SKEW_SECS, DEFAULT_MAX_PROOF_AGE_SECS};
use crate::conditional_executor::error::ExecutorError;
use crate::conditional_executor::types::{OracleProof, ParsedProof};

/// Proof message layout (packed binary):
/// - condition_id: [u8; 32]
/// - outcome_len: u16 (little-endian)
/// - outcome: [u8; outcome_len]
/// - timestamp_unix: i64 (little-endian)
///
/// Total minimum size: 32 + 2 + 0 + 8 = 42 bytes
const MIN_MESSAGE_LEN: usize = 42;

/// Parse an oracle proof message into structured data
pub fn parse_proof_message(proof: &OracleProof) -> Result<ParsedProof> {
    let msg = &proof.message;

    if msg.len() < MIN_MESSAGE_LEN {
        return Err(ExecutorError::ProofParseError.into());
    }

    // Extract condition_id (first 32 bytes)
    let condition_id: [u8; 32] = msg[0..32]
        .try_into()
        .map_err(|_| ExecutorError::ProofParseError)?;

    // Extract outcome_len (2 bytes, little-endian)
    let outcome_len = u16::from_le_bytes(
        msg[32..34]
            .try_into()
            .map_err(|_| ExecutorError::ProofParseError)?,
    ) as usize;

    // Validate message length
    let expected_len = 32 + 2 + outcome_len + 8;
    if msg.len() < expected_len {
        return Err(ExecutorError::ProofParseError.into());
    }

    // Extract outcome
    let outcome = msg[34..34 + outcome_len].to_vec();

    // Extract timestamp (8 bytes, little-endian)
    let timestamp_offset = 34 + outcome_len;
    let timestamp_unix = i64::from_le_bytes(
        msg[timestamp_offset..timestamp_offset + 8]
            .try_into()
            .map_err(|_| ExecutorError::ProofParseError)?,
    );

    Ok(ParsedProof {
        condition_id,
        outcome,
        timestamp_unix,
    })
}

/// Check proof freshness against current time
pub fn check_proof_freshness(
    proof_timestamp: i64,
    current_time: i64,
    max_age_secs: u32,
    max_future_skew_secs: u32,
) -> Result<()> {
    let max_age = if max_age_secs == 0 {
        DEFAULT_MAX_PROOF_AGE_SECS
    } else {
        max_age_secs
    };

    let max_future = if max_future_skew_secs == 0 {
        DEFAULT_MAX_FUTURE_SKEW_SECS
    } else {
        max_future_skew_secs
    };

    // Check if proof is too old
    let age = current_time.saturating_sub(proof_timestamp);
    if age > max_age as i64 {
        return Err(ExecutorError::ProofTooOld.into());
    }

    // Check if proof is too far in the future
    let future_skew = proof_timestamp.saturating_sub(current_time);
    if future_skew > max_future as i64 {
        return Err(ExecutorError::ProofInFuture.into());
    }

    Ok(())
}

/// Encode a proof message from components (for testing / off-chain use)
pub fn encode_proof_message(
    condition_id: &[u8; 32],
    outcome: &[u8],
    timestamp_unix: i64,
) -> Vec<u8> {
    let mut msg = Vec::with_capacity(32 + 2 + outcome.len() + 8);
    msg.extend_from_slice(condition_id);
    msg.extend_from_slice(&(outcome.len() as u16).to_le_bytes());
    msg.extend_from_slice(outcome);
    msg.extend_from_slice(&timestamp_unix.to_le_bytes());
    msg
}
