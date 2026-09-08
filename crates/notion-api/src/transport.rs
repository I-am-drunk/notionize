//! Shared transport for every `/api/v3` call: cookie auth, per-request scoping
//! headers, decompression, and the status policy (401 = signed out, else retryable).

use notion_core::ids::SpaceId;
use notion_core::port::Session;
use serde_json::Value;

const BASE: &str = "https://app.notion.com/api/v3";

pub struct Transport {
    http: reqwest::Client,
    base: String,
}

impl Transport {
    pub fn new() -> Self {
        Self::with_base(BASE.to_string())
    }

    /// Used by tests to point at the mock server.
    pub fn with_base(base: String) -> Self {
        let http = reqwest::Client::builder()
            .user_agent("Notionize/0.1")
            .build()
            .expect("reqwest client");
        Self { http, base }
    }

    /// POST a JSON body to `endpoint`, returning the decoded response text.
    /// `space` is `None` for calls that are not workspace-scoped (e.g. login).
    pub async fn post(
        &self,
        session: &Session,
        space: Option<&SpaceId>,
        endpoint: &str,
        body: Value,
    ) -> Result<String, String> {
        let mut req = self
            .http
            .post(format!("{}/{}", self.base, endpoint))
            .header("content-type", "application/json")
            .header("cookie", &session.cookie_header)
            .header("x-notion-active-user-header", &session.active_user.0);

        if let Some(space) = space {
            req = req.header("x-notion-space-id", &space.0);
        }

        let resp = req.json(&body).send().await.map_err(|e| e.to_string())?;
        let status = resp.status();

        // Status policy — see AGENTS.md #3. Only 401 destroys a session.
        if status.as_u16() == 401 {
            return Err("unauthorized".to_string());
        }
        let text = resp.text().await.map_err(|e| e.to_string())?;
        if !status.is_success() {
            return Err(format!("retryable {}: {}", status.as_u16(), truncate(&text)));
        }
        Ok(text)
    }

    /// Convenience for JSON-shaped responses.
    pub async fn post_json(
        &self,
        session: &Session,
        space: Option<&SpaceId>,
        endpoint: &str,
        body: Value,
    ) -> Result<Value, String> {
        let text = self.post(session, space, endpoint, body).await?;
        serde_json::from_str(&text).map_err(|e| format!("decode {endpoint}: {e}"))
    }
}

fn truncate(s: &str) -> String {
    s.chars().take(200).collect()
}
