// T004: Instruction argument types

use anchor_lang::prelude::*;

use crate::conditional_executor::state::ConditionRequirement;

/// Arguments for creating a new Requirement
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CreateRequirementArgs {
    /// User-chosen nonce for unique PDA derivation
    pub nonce: u64,
    /// Target program to invoke on execution
    pub target_program: Pubkey,
    /// Instruction data for the CPI
    pub instruction_data: Vec<u8>,
    /// List of conditions that must be satisfied
    pub conditions: Vec<ConditionRequirementInput>,
    /// Maximum keeper fee in lamports
    pub max_keeper_fee_lamports: u64,
    /// Optional keeper fee recipient
    pub keeper_fee_recipient: Option<Pubkey>,
    /// Maximum proof age in seconds (0 = use default)
    pub max_proof_age_secs: u32,
    /// Maximum future skew in seconds (0 = use default)
    pub max_future_skew_secs: u32,
}

/// Input format for a single condition (used in instruction args)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ConditionRequirementInput {
    /// SHA256 hash of the external condition identifier
    pub condition_id: [u8; 32],
    /// Expected outcome value
    pub expected_outcome: Vec<u8>,
}

impl From<ConditionRequirementInput> for ConditionRequirement {
    fn from(input: ConditionRequirementInput) -> Self {
        Self {
            condition_id: input.condition_id,
            expected_outcome: input.expected_outcome,
        }
    }
}

/// A single oracle proof provided at execution time
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct OracleProof {
    /// Canonical serialized message signed by oracle
    pub message: Vec<u8>,
    /// Ed25519 signature over the message
    pub signature: [u8; 64],
}

/// Parsed content from an oracle proof message
#[derive(Clone, Debug)]
pub struct ParsedProof {
    /// Condition identifier from the proof
    pub condition_id: [u8; 32],
    /// Outcome value from the proof
    pub outcome: Vec<u8>,
    /// Unix timestamp when proof was generated
    pub timestamp_unix: i64,
}

/// Arguments for executing a Requirement
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ExecuteArgs {
    /// Proofs for each condition (must match requirement conditions in order)
    pub proofs: Vec<OracleProof>,
    /// Keeper fee to claim (must be <= max_keeper_fee_lamports)
    pub keeper_fee_lamports: u64,
}

/// Account meta representation for hashing
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct AccountMetaInput {
    pub pubkey: Pubkey,
    pub is_signer: bool,
    pub is_writable: bool,
}
