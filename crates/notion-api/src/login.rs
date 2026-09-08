//! Login. `getLoginOptions` is captured and stable-ish; the credential-exchange step
//! that actually mints `token_v2` was NOT captured in the archive and must be reversed
//! live. This is the highest-risk file in the repo — keep it small and fixture-backed.

use crate::transport::Transport;
use notion_core::port::{LoginOptions, Session};
use serde_json::json;

pub async fn login_options(t: &Transport, email: &str) -> Result<LoginOptions, String> {
    // Not workspace-scoped, and there is no session yet — but Notion still accepts an
    // anonymous probe. We pass an empty session so headers stay uniform.
    let anon = Session {
        active_user: notion_core::ids::NotionUserId(String::new()),
        cookie_header: String::new(),
    };
    let v = t
        .post_json(&anon, None, "getLoginOptions", json!({ "email": email }))
        .await?;

    Ok(LoginOptions {
        has_account: v["hasAccount"].as_bool().unwrap_or(false),
        password_sign_in: v["passwordSignIn"].as_bool().unwrap_or(false),
        login_options_token: v["loginOptionsToken"].as_str().map(str::to_string),
    })
}

pub async fn complete_login(_t: &Transport, _email: &str, _secret: &str) -> Result<Session, String> {
    // TODO(reverse-engineer): capture the live email-code exchange, then implement the
    // POST here and return the resulting cookie jar as a `Session`. Re-checked against a
    // fresh capture (2026-09-07): `getLoginOptions` still returns `passwordSignIn: false`
    // and `samlSignIn: "unavailable"` for the archive account, so the only path is the
    // emailed-code flow gated behind `authFlowId`/`loginOptionsToken` — password exchange
    // is not applicable here. That follow-up request was never observed live (the
    // capturing browser was already signed in), so it still can't be implemented from
    // the archive alone. Until then, sessions are imported from a browser jar via the
    // CLI (`account import`). Follow the `add-notion-account` skill.
    Err("credential exchange not yet implemented — import a session instead".to_string())
}
