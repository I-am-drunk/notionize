//! Stable domain + orchestration. No HTTP, no SQL, no Notion quirks — those live
//! behind the ports in `port.rs` and are implemented in `notion-api` / `notion-store`.

pub mod account;
pub mod credits;
pub mod error;
pub mod ids;
pub mod pipeline;
pub mod port;
pub mod rotation;
pub mod workspace;

pub use account::{AccountState, ManagedAccount, SessionHealth};
pub use error::CoreError;
pub use ids::{AccountId, NotionUserId, SpaceId};
pub use pipeline::{run, InferenceOutcome, InferenceRequest, InferenceResult, Usage};
pub use port::{LoginOptions, NotionClient, Session, SessionStore, SpaceSpec, StateStore};
pub use workspace::{CreditSnapshot, Workspace};
