# ADR-001 — Credential boundary

## Decision

Session secrets (the Notion cookie jar: `token_v2`, `notion_users`) live ONLY in the OS
keychain, behind `SessionStore`. Non-secret account state lives in SQLite, behind
`StateStore`. The two never mix.

- `ManagedAccount` (SQLite) references an account by `notion_user_id`. It has no cookie,
  token, or password field, ever.
- `Session` (in-memory) carries the cookie jar, has a redacting `Debug`, and is never
  persisted through `StateStore` or logged.

## Why

Lifting browser cookies into a service is a real credential-handling risk (called out in
the reference archive). Keeping secrets in the keychain limits blast radius, keeps the
SQLite file safe to copy for tests, and makes "forget this account" a single keychain
delete.

## Enforcement

Code review + the rule in AGENTS.md. Adding a secret column to SQLite is a defect.
