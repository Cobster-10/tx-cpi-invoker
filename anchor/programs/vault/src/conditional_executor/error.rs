// T005 + T046: Executor error codes

use anchor_lang::prelude::*;

#[error_code]
pub enum ExecutorError {
    // === Requirement Creation Errors ===
    #[msg("Too many conditions; maximum is 8")]
    TooManyConditions,

    #[msg("Instruction data exceeds maximum length")]
    InstructionDataTooLong,

    #[msg("Duplicate condition_id in conditions list")]
    DuplicateConditionId,

    #[msg("Outcome data exceeds maximum length")]
    OutcomeTooLong,

    #[msg("At least one condition is required")]
    NoConditions,

    // === Lifecycle Errors ===
    #[msg("Requirement is not in Active state")]
    RequirementNotActive,

    #[msg("Requirement has already been executed")]
    AlreadyExecuted,

    #[msg("Requirement has been canceled")]
    RequirementCanceled,

    #[msg("Only the requirement authority can perform this action")]
    UnauthorizedAuthority,

    // === Proof Verification Errors ===
    #[msg("Number of proofs does not match number of conditions")]
    ProofCountMismatch,

    #[msg("Proof condition_id does not match requirement condition")]
    ConditionIdMismatch,

    #[msg("Proof outcome does not match expected outcome")]
    OutcomeMismatch,

    #[msg("Proof is stale; timestamp exceeds max proof age")]
    ProofTooOld,

    #[msg("Proof timestamp is too far in the future")]
    ProofInFuture,

    #[msg("Failed to parse proof message")]
    ProofParseError,

    #[msg("Ed25519 signature verification instruction not found in transaction")]
    Ed25519VerifyNotFound,

    #[msg("Ed25519 signature verification failed or used wrong public key")]
    Ed25519VerifyFailed,

    // === Fee Errors ===
    #[msg("Requested keeper fee exceeds maximum allowed")]
    KeeperFeeExceedsMax,

    #[msg("Insufficient lamports for keeper fee transfer")]
    InsufficientFundsForFee,

    // === CPI Errors ===
    #[msg("Remaining accounts hash does not match stored accounts_hash")]
    AccountsHashMismatch,

    #[msg("CPI invocation failed")]
    CpiInvocationFailed,

    // === Config Errors ===
    #[msg("Config already initialized")]
    ConfigAlreadyInitialized,

    #[msg("Invalid signer public key")]
    InvalidSignerPubkey,
}
