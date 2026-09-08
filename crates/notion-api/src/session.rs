//! How a Notion session is represented on the wire. A session is the cookie jar;
//! at minimum `token_v2` (the secret) and `notion_users` (the signed-in user list).

use notion_core::ids::NotionUserId;
use notion_core::port::Session;

/// Build a runtime session from the two cookies we persist per account.
pub fn from_cookies(active_user: &str, token_v2: &str, notion_users: &str) -> Session {
    Session {
        active_user: NotionUserId(active_user.to_string()),
        cookie_header: format!("token_v2={token_v2}; notion_users={notion_users}"),
    }
}
