//! Credit / workspace policy. The single place that turns "out of credits" into
//! "make a new workspace and keep going".

use crate::account::ManagedAccount;
use crate::error::CoreError;
use crate::ids::SpaceId;
use crate::pipeline::{default_space_spec, Deps};
use crate::port::Session;

/// Return the account's current workspace, creating one if it has none yet.
pub async fn ensure_space(
    deps: &Deps<'_>,
    account: &mut ManagedAccount,
    session: &Session,
) -> Result<SpaceId, CoreError> {
    if let Some(space) = &account.current_space {
        return Ok(space.clone());
    }
    rotate_to_new_space(deps, account, session).await
}

/// Create a fresh workspace, point the account at it, and persist.
pub async fn rotate_to_new_space(
    deps: &Deps<'_>,
    account: &mut ManagedAccount,
    session: &Session,
) -> Result<SpaceId, CoreError> {
    if !deps
        .client
        .can_create_workspace(session)
        .await
        .map_err(CoreError::Notion)?
    {
        return Err(CoreError::CannotCreateWorkspace);
    }

    let space = deps
        .client
        .create_space(session, &default_space_spec())
        .await
        .map_err(CoreError::Notion)?;

    account.current_space = Some(space.clone());
    account.credit = None;
    deps.state.upsert(account).await.map_err(CoreError::Store)?;
    Ok(space)
}
