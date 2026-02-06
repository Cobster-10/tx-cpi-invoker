// T011: Bounded parsing/validation helpers

use anchor_lang::prelude::*;
use std::collections::HashSet;

use crate::conditional_executor::constants::{MAX_CONDITIONS, MAX_IX_DATA_LEN, MAX_OUTCOME_LEN};
use crate::conditional_executor::error::ExecutorError;
use crate::conditional_executor::types::ConditionRequirementInput;

/// Validate conditions list: count, duplicates, outcome length
pub fn validate_conditions(conditions: &[ConditionRequirementInput]) -> Result<()> {
    // Must have at least one condition
    require!(!conditions.is_empty(), ExecutorError::NoConditions);

    // Must not exceed max conditions
    require!(
        conditions.len() <= MAX_CONDITIONS,
        ExecutorError::TooManyConditions
    );

    // Check for duplicate condition_ids
    let mut seen_ids = HashSet::new();
    for cond in conditions {
        if !seen_ids.insert(cond.condition_id) {
            return Err(ExecutorError::DuplicateConditionId.into());
        }

        // Validate outcome length
        require!(
            cond.expected_outcome.len() <= MAX_OUTCOME_LEN,
            ExecutorError::OutcomeTooLong
        );
    }

    Ok(())
}

/// Validate instruction data length
pub fn validate_instruction_data(data: &[u8]) -> Result<()> {
    require!(
        data.len() <= MAX_IX_DATA_LEN,
        ExecutorError::InstructionDataTooLong
    );
    Ok(())
}

/// Validate that requirement is in Active state
pub fn require_active(state: crate::conditional_executor::state::RequirementState) -> Result<()> {
    use crate::conditional_executor::state::RequirementState;

    match state {
        RequirementState::Active => Ok(()),
        RequirementState::Canceled => Err(ExecutorError::RequirementCanceled.into()),
        RequirementState::Executed => Err(ExecutorError::AlreadyExecuted.into()),
    }
}
