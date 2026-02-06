// T003 + T019: Core state types

use anchor_lang::prelude::*;

use crate::conditional_executor::constants::{MAX_CONDITIONS, MAX_IX_DATA_LEN, MAX_OUTCOME_LEN};

/// Lifecycle state of a Requirement
#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, Default, InitSpace,
)]
pub enum RequirementState {
    #[default]
    Active,
    Canceled,
    Executed,
}

/// A single condition that must be satisfied for execution
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, InitSpace)]
pub struct ConditionRequirement {
    /// SHA256 hash of the external condition identifier
    pub condition_id: [u8; 32],
    /// Expected outcome value (domain-specific)
    #[max_len(MAX_OUTCOME_LEN)]
    pub expected_outcome: Vec<u8>,
}

/// Global configuration PDA (optional)
#[account]
#[derive(InitSpace)]
pub struct Config {
    /// Authority allowed to update config
    pub authority: Pubkey,
    /// Trusted Stork signer public key for proof verification
    pub stork_signer_pubkey: Pubkey,
    /// PDA bump seed
    pub bump: u8,
}

/// Requirement PDA: stores delegated CPI intent + conditions + lifecycle
#[account]
#[derive(InitSpace)]
pub struct Requirement {
    /// Owner who created this requirement and can cancel/close it
    pub authority: Pubkey,
    /// Current lifecycle state
    pub state: RequirementState,
    /// Unix timestamp when created
    pub created_at_unix: i64,
    /// Slot when executed (set on successful execution)
    pub executed_at_slot: Option<u64>,
    /// Bump seed for PDA derivation
    pub bump: u8,
    /// User-provided nonce for unique PDA derivation
    pub nonce: u64,

    // --- Delegated CPI intent (immutable after creation) ---
    /// Target program to invoke
    pub target_program: Pubkey,
    /// Instruction data for the CPI
    #[max_len(MAX_IX_DATA_LEN)]
    pub instruction_data: Vec<u8>,
    /// SHA256 hash of expected account metas (pubkey + is_writable + is_signer)
    pub accounts_hash: [u8; 32],

    // --- Conditions ---
    /// List of conditions that must all be satisfied
    #[max_len(MAX_CONDITIONS)]
    pub conditions: Vec<ConditionRequirement>,

    // --- Fees / economics ---
    /// Maximum lamports the keeper can claim as fee
    pub max_keeper_fee_lamports: u64,
    /// Optional recipient for keeper fee (if None, fee goes to keeper signer)
    pub keeper_fee_recipient: Option<Pubkey>,

    // --- Freshness policy ---
    /// Maximum age of proof in seconds
    pub max_proof_age_secs: u32,
    /// Maximum future skew tolerance in seconds
    pub max_future_skew_secs: u32,
}

impl RequirementState {
    pub fn is_active(&self) -> bool {
        matches!(self, RequirementState::Active)
    }

    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            RequirementState::Canceled | RequirementState::Executed
        )
    }
}
