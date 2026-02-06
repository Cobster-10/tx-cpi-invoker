// T002: Constants and PDA seeds

/// Maximum number of conditions per Requirement (bounded for compute + rent)
pub const MAX_CONDITIONS: usize = 8;

/// Maximum length of instruction data stored in a Requirement
pub const MAX_IX_DATA_LEN: usize = 1024;

/// Maximum length of an individual outcome in bytes
pub const MAX_OUTCOME_LEN: usize = 64;

/// Default freshness window: 60 minutes
pub const DEFAULT_MAX_PROOF_AGE_SECS: u32 = 3600;

/// Default future skew tolerance: 5 minutes
pub const DEFAULT_MAX_FUTURE_SKEW_SECS: u32 = 300;

// PDA Seeds
pub const REQUIREMENT_SEED: &[u8] = b"requirement";
pub const CONFIG_SEED: &[u8] = b"config";

/// Hardcoded default Stork signer pubkey (placeholder; replace with real value)
/// This is used when no Config PDA is present
pub const DEFAULT_STORK_SIGNER: [u8; 32] = [0u8; 32]; // TODO: Replace with actual Stork pubkey
