//! Ports: the seams between stable core and the swappable adapters.
//! `NotionClient` is implemented by `notion-api` (the fragile layer);
//! `SessionStore` + `StateStore` by `notion-store`.

use crate::account::ManagedAccount;
use crate::ids::{AccountId, NotionUserId, SpaceId};
use crate::pipeline::{InferenceRequest, InferenceResult};
use crate::workspace::CreditSnapshot;
use async_trait::async_trait;

/// An in-memory, resolved session for one account. Carries the secret cookie jar,
/// so it is never persisted through `StateStore` and never logged.
#[derive(Clone)]
pub struct Session {
    pub active_user: NotionUserId,
    /// Raw `Cookie:` header value (at least `token_v2` + `notion_users`).
    pub cookie_header: String,
}

impl std::fmt::Debug for Session {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Session")
            .field("active_user", &self.active_user)
            .field("cookie_header", &"<redacted>")
            .finish()
    }
}

#[derive(Debug, Clone)]
pub struct LoginOptions {
    pub has_account: bool,
    pub password_sign_in: bool,
    pub login_options_token: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SpaceSpec {
    pub name: String,
}

/// The one port that talks to Notion. Everything undocumented/fragile is behind this.
#[async_trait]
pub trait NotionClient: Send + Sync {
    async fn login_options(&self, email: &str) -> Result<LoginOptions, String>;

    /// Complete the credential exchange and return a live session.
    /// NOTE: the exact step is undocumented and must be reversed live — see
    /// `notion-api/src/login.rs`.
    async fn complete_login(&self, email: &str, secret: &str) -> Result<Session, String>;

    /// Run one AI request end to end. Returns `Exhausted` (fail-closed) when the
    /// stream carries `premium-feature-unavailable`.
    async fn run_inference(
        &self,
        session: &Session,
        space: &SpaceId,
        req: &InferenceRequest,
    ) -> Result<InferenceResult, String>;

    async fn usage(&self, session: &Session, space: &SpaceId) -> Result<CreditSnapshot, String>;

    async fn can_create_workspace(&self, session: &Session) -> Result<bool, String>;

    async fn create_space(&self, session: &Session, spec: &SpaceSpec) -> Result<SpaceId, String>;
}

/// Secret storage (keychain). Separate from `StateStore` by design (ADR-001).
#[async_trait]
pub trait SessionStore: Send + Sync {
    async fn load(&self, user: &NotionUserId) -> Result<Option<Session>, String>;
    async fn save(&self, session: &Session) -> Result<(), String>;
    async fn delete(&self, user: &NotionUserId) -> Result<(), String>;
}

/// Non-secret state (SQLite). Never stores cookies/tokens.
#[async_trait]
pub trait StateStore: Send + Sync {
    async fn get(&self, id: AccountId) -> Result<Option<ManagedAccount>, String>;
    async fn list(&self) -> Result<Vec<ManagedAccount>, String>;
    async fn upsert(&self, account: &ManagedAccount) -> Result<(), String>;
}
