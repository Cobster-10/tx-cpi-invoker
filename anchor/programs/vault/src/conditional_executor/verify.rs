// T030: Proof-to-requirement matching (condition_id + outcome)

use anchor_lang::prelude::*;

use crate::conditional_executor::error::ExecutorError;
use crate::conditional_executor::proof::{check_proof_freshness, parse_proof_message};
use crate::conditional_executor::state::{ConditionRequirement, Requirement};
use crate::conditional_executor::types::{OracleProof, ParsedProof};

/// Verify all proofs match the requirement conditions
///
/// Returns parsed proofs on success for further processing (e.g., ed25519 verification)
pub fn verify_proofs_match_conditions(
    requirement: &Requirement,
    proofs: &[OracleProof],
    current_time: i64,
) -> Result<Vec<ParsedProof>> {
    // Must have exactly one proof per condition
    if proofs.len() != requirement.conditions.len() {
        return Err(ExecutorError::ProofCountMismatch.into());
    }

    let mut parsed_proofs = Vec::with_capacity(proofs.len());

    for (i, (proof, condition)) in proofs.iter().zip(requirement.conditions.iter()).enumerate() {
        // Parse the proof message
        let parsed = parse_proof_message(proof)?;

        // Check condition_id matches
        if parsed.condition_id != condition.condition_id {
            msg!(
                "Proof {} condition_id mismatch: expected {:?}, got {:?}",
                i,
                condition.condition_id,
                parsed.condition_id
            );
            return Err(ExecutorError::ConditionIdMismatch.into());
        }

        // Check outcome matches
        if parsed.outcome != condition.expected_outcome {
            msg!(
                "Proof {} outcome mismatch: expected {:?}, got {:?}",
                i,
                condition.expected_outcome,
                parsed.outcome
            );
            return Err(ExecutorError::OutcomeMismatch.into());
        }

        // Check freshness
        check_proof_freshness(
            parsed.timestamp_unix,
            current_time,
            requirement.max_proof_age_secs,
            requirement.max_future_skew_secs,
        )?;

        parsed_proofs.push(parsed);
    }

    Ok(parsed_proofs)
}

/// Verify a single proof matches a single condition (for individual checks)
pub fn verify_single_proof(
    condition: &ConditionRequirement,
    proof: &OracleProof,
    current_time: i64,
    max_proof_age_secs: u32,
    max_future_skew_secs: u32,
) -> Result<ParsedProof> {
    let parsed = parse_proof_message(proof)?;

    if parsed.condition_id != condition.condition_id {
        return Err(ExecutorError::ConditionIdMismatch.into());
    }

    if parsed.outcome != condition.expected_outcome {
        return Err(ExecutorError::OutcomeMismatch.into());
    }

    check_proof_freshness(
        parsed.timestamp_unix,
        current_time,
        max_proof_age_secs,
        max_future_skew_secs,
    )?;

    Ok(parsed)
}
