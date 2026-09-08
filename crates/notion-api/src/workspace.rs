//! Workspace creation — the other half of the auto-recovery loop. A fresh `spaceId`
//! carries its own credit allocation, which is why rotating restores service.

use crate::transport::Transport;
use notion_core::ids::SpaceId;
use notion_core::port::{Session, SpaceSpec};
use serde_json::json;

pub async fn can_create(t: &Transport, session: &Session) -> Result<bool, String> {
    let v = t
        .post_json(session, None, "validateUserCanCreateWorkspace", json!({}))
        .await?;
    Ok(v["canUserCreateSpace"].as_bool().unwrap_or(false))
}

pub async fn create_space(
    t: &Transport,
    session: &Session,
    spec: &SpaceSpec,
) -> Result<SpaceId, String> {
    // Minimal viable payload; extend only if Notion rejects it. YAGNI.
    let body = json!({
        "name": spec.name,
        "planType": "personal",
        "initialPersona": "personal",
    });
    let v = t.post_json(session, None, "createSpace", body).await?;
    v["spaceId"]
        .as_str()
        .map(|s| SpaceId(s.to_string()))
        .ok_or_else(|| "createSpace: no spaceId in response".to_string())
}
