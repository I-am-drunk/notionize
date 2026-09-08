//! The core pipeline: run one Notion AI request, and transparently rotate to a fresh
//! workspace when the current one is out of credits.

use crate::account::{AccountState, ManagedAccount};
use crate::credits;
use crate::error::CoreError;
use crate::port::{NotionClient, Session, SessionStore, SpaceSpec, StateStore};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InferenceRequest {
    pub prompt: String,
    /// Notion model codename (volatile — resolved by the fragile layer). None = default.
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InferenceOutcome {
    pub text: String,
    pub usage: Usage,
}

/// The result of one upstream run. `Exhausted` encodes the fail-closed rule at the
/// type level: an exhausted run is NEVER an empty `Completed`.
#[derive(Debug, Clone)]
pub enum InferenceResult {
    Completed(InferenceOutcome),
    Exhausted { reason: String },
}

/// Ports the pipeline needs. Passed as trait objects to keep wiring simple.
pub struct Deps<'a> {
    pub client: &'a dyn NotionClient,
    pub sessions: &'a dyn SessionStore,
    pub state: &'a dyn StateStore,
}

/// Run a request for `account`, creating a new workspace and retrying once if the
/// current workspace is exhausted.
pub async fn run(
    deps: &Deps<'_>,
    account: &mut ManagedAccount,
    req: &InferenceRequest,
) -> Result<InferenceOutcome, CoreError> {
    let session = deps
        .sessions
        .load(&account.notion_user_id)
        .await
        .map_err(CoreError::Store)?
        .ok_or(CoreError::NoSession)?;

    let space = credits::ensure_space(deps, account, &session).await?;

    match deps
        .client
        .run_inference(&session, &space, req)
        .await
        .map_err(CoreError::Notion)?
    {
        InferenceResult::Completed(outcome) => {
            account.consecutive_failures = 0;
            Ok(outcome)
        }
        InferenceResult::Exhausted { .. } => {
            // Fail closed: rotate to a fresh workspace, then retry exactly once.
            let fresh = credits::rotate_to_new_space(deps, account, &session).await?;
            retry_once(deps, account, &session, &fresh, req).await
        }
    }
}

async fn retry_once(
    deps: &Deps<'_>,
    account: &mut ManagedAccount,
    session: &Session,
    space: &crate::ids::SpaceId,
    req: &InferenceRequest,
) -> Result<InferenceOutcome, CoreError> {
    match deps
        .client
        .run_inference(session, space, req)
        .await
        .map_err(CoreError::Notion)?
    {
        InferenceResult::Completed(outcome) => Ok(outcome),
        InferenceResult::Exhausted { reason } => {
            account.state = AccountState::Exhausted;
            deps.state.upsert(account).await.map_err(CoreError::Store)?;
            Err(CoreError::NotEligible(format!(
                "exhausted again after rotation: {reason}"
            )))
        }
    }
}

/// A fresh workspace name. Kept trivial on purpose.
pub(crate) fn default_space_spec() -> SpaceSpec {
    SpaceSpec {
        name: "Notionize".to_string(),
    }
}
