//! `getAvailableModels`. Model codenames (e.g. `oatmeal-cookie`) are snapshot-in-time
//! and drift often; v1 uses Notion's default, so this is a helper, not wired into the
//! core port yet. Keep it here so the churn stays contained.
#![allow(dead_code)]

use crate::transport::Transport;
use notion_core::ids::SpaceId;
use notion_core::port::Session;
use serde_json::json;

pub async fn available_models(
    t: &Transport,
    session: &Session,
    space: &SpaceId,
) -> Result<Vec<String>, String> {
    let v = t
        .post_json(session, Some(space), "getAvailableModels", json!({}))
        .await?;
    Ok(v["models"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m["codename"].as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default())
}
