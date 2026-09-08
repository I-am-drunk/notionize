use thiserror::Error;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("account not found")]
    AccountNotFound,
    #[error("no session for account (needs login)")]
    NoSession,
    #[error("account not eligible: {0}")]
    NotEligible(String),
    #[error("workspace creation not permitted for this account")]
    CannotCreateWorkspace,
    /// Any failure surfaced by the fragile Notion layer.
    #[error("notion: {0}")]
    Notion(String),
    #[error("store: {0}")]
    Store(String),
}
