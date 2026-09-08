use crate::ids::{AccountId, NotionUserId, SpaceId};
use crate::workspace::CreditSnapshot;
use serde::{Deserialize, Serialize};

/// Persisted, non-secret account record. The session (cookies/token_v2) is NOT here —
/// it lives in the keychain, referenced by `notion_user_id`. See ADR-001.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagedAccount {
    pub id: AccountId,
    pub alias: String,
    pub notion_user_id: NotionUserId,
    /// The workspace this account is currently pointed at. Rotated on exhaustion.
    pub current_space: Option<SpaceId>,
    pub state: AccountState,
    pub credit: Option<CreditSnapshot>,
    pub consecutive_failures: u32,
    pub cooldown_step: u32,
}

/// The account lifecycle. Transitions are centralized here so they live in one place.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccountState {
    Disconnected,
    Authenticating,
    Ready,
    CoolingDown,
    Exhausted,
    Quarantined,
}

/// Live health, kept separate from `AccountState` and merged only for display.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionHealth {
    Healthy,
    RefreshRequired,
    Expired,
    Failed,
}

impl ManagedAccount {
    pub fn is_eligible(&self) -> bool {
        matches!(self.state, AccountState::Ready)
    }
}
