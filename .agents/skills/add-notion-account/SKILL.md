---
name: add-notion-account
description: Add a Notion account to Notionize, by importing an existing browser session or (once implemented) via the login flow. Use when onboarding a new account or debugging authentication.
---

# Adding a Notion account

Two paths. Import works today; native login is pending the credential-exchange reverse.

## Import an existing session (works now)

1. In a browser signed in to Notion, read the cookies `token_v2`, `notion_users`, and the
   active `notion_user_id`.
2. `notionize import --alias <name> --user <notion_user_id> --token-v2 <...> --notion-users '<json>'`
3. The session goes to the keychain (`SessionStore`); a non-secret row goes to SQLite. See ADR-001.
4. Confirm with `notionize status`.

## Native login (pending)

`login.rs::complete_login` is stubbed — the password / email-code exchange that mints
`token_v2` was never captured. To implement: capture the live exchange, add the POST in
`login.rs`, return the resulting `Session`. Keep it fixture-backed. Do not store the
password.
