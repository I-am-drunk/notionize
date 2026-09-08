//! THE FRAGILE LAYER. The only code that speaks Notion's private `/api/v3`.
//! One file per endpoint. When Notion changes, you edit exactly one of these files
//! and its fixture — nothing above `notion-api` moves. See ADR-002.
//!
//! Contract facts (from the reference archive), all enforced in `transport`:
//!   - auth is cookies (`token_v2` + `notion_users`), never a bearer.
//!   - every call carries `x-notion-active-user-header` and `x-notion-space-id`.
//!   - only HTTP 401 means signed-out; other non-200s are retryable.
//!   - responses are zstd (decoded by reqwest); inference is NDJSON.

mod credits;
mod inference;
mod login;
mod models;
mod session;
mod transport;
mod workspace;

use async_trait::async_trait;
use notion_core::ids::SpaceId;
use notion_core::pipeline::{InferenceRequest, InferenceResult};
use notion_core::port::{LoginOptions, NotionClient, Session, SpaceSpec};
use notion_core::workspace::CreditSnapshot;
use transport::Transport;

/// Live implementation of the core `NotionClient` port.
pub struct HttpNotionClient {
    transport: Transport,
}

impl HttpNotionClient {
    pub fn new() -> Self {
        Self {
            transport: Transport::new(),
        }
    }
}

impl Default for HttpNotionClient {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl NotionClient for HttpNotionClient {
    async fn login_options(&self, email: &str) -> Result<LoginOptions, String> {
        login::login_options(&self.transport, email).await
    }

    async fn complete_login(&self, email: &str, secret: &str) -> Result<Session, String> {
        login::complete_login(&self.transport, email, secret).await
    }

    async fn run_inference(
        &self,
        session: &Session,
        space: &SpaceId,
        req: &InferenceRequest,
    ) -> Result<InferenceResult, String> {
        inference::run(&self.transport, session, space, req).await
    }

    async fn usage(&self, session: &Session, space: &SpaceId) -> Result<CreditSnapshot, String> {
        credits::usage(&self.transport, session, space).await
    }

    async fn can_create_workspace(&self, session: &Session) -> Result<bool, String> {
        workspace::can_create(&self.transport, session).await
    }

    async fn create_space(&self, session: &Session, spec: &SpaceSpec) -> Result<SpaceId, String> {
        workspace::create_space(&self.transport, session, spec).await
    }
}
