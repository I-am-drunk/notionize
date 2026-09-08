use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Our own stable id for an account. Independent of Notion's user id.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct AccountId(pub Uuid);

impl AccountId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

impl Default for AccountId {
    fn default() -> Self {
        Self::new()
    }
}

/// Notion's own id for a signed-in user (the value of `x-notion-active-user-header`).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct NotionUserId(pub String);

/// A Notion workspace / space id (`x-notion-space-id`). Credit is metered per space.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SpaceId(pub String);
