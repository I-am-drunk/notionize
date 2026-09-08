use crate::ids::{AccountId, SpaceId};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub space_id: SpaceId,
    pub account_id: AccountId,
    pub credit: CreditSnapshot,
}

/// A point-in-time read of a space's credit ledger (from `getAIUsageEligibilityV2`).
/// Field names are ours; the fragile layer maps Notion's shape onto this.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreditSnapshot {
    pub total_balance: f64,
    pub in_overage: bool,
    /// True when the pre-flight rate-limit check reports `rate_limited`.
    pub rate_limited: bool,
}

impl CreditSnapshot {
    /// Pre-flight guess at exhaustion. The authoritative signal is still the in-band
    /// `premium-feature-unavailable` from a run (see pipeline), so this is advisory.
    pub fn looks_exhausted(&self) -> bool {
        self.rate_limited || self.total_balance <= 0.0
    }
}
