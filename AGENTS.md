# AGENTS.md — working in Notionize

Read this before changing code. These are strong defaults; the developer's intent overrides them.

## Taste (channel YAGNI)

- Smallest model that makes correct behavior unsurprising. Do not preserve or invent complexity.
- The code stays as small as humanly possible. Comments describe how a thing is used, not every line.
- Inferred types over annotations. No `unwrap()` on fallible I/O in library code.
- Complexity belongs at the adapter boundary (`notion-api`, `compat/`). `notion-core` stays pure; the UI stays dumb.

## Glossary

- **you** — the agent changing Notionize. **user** — the person running the service.
- **account** — one signed-in Notion identity (a `token_v2` cookie jar + a `notion_user_id`).
- **workspace / space** — a Notion space with its own credit ledger, keyed by `spaceId`.
- **pipeline** — running one Notion AI request end to end.
- **the fragile layer** — `crates/notion-api`, the only code that speaks Notion's private `/api/v3`.

## The ways to hurt yourself

1. **Widening the credential boundary.** Session cookies live only in the keychain and the per-account jar. Never add a token/cookie/password column to SQLite, never log a secret, never pass a bearer as a CLI literal. See `docs/adr/ADR-001-credential-boundary.md`.
2. **Leaking Notion quirks upward.** HTTP status handling, zstd, NDJSON parsing, header scoping, model codenames — all stay inside `notion-api`. If `notion-core` imports `reqwest`, you did it wrong.
3. **Destroying healthy accounts.** Only HTTP 401 means signed-out. Every other non-200 is retryable/coolable. Never quarantine or delete an account on a transient 429/5xx.
4. **Treating exhaustion as success.** A credit-exhausted request returns HTTP 200 with a truncated NDJSON stream (`premium-feature-unavailable`, no `patch-sync`). Fail closed and trigger the new-workspace path. See `docs/adr/ADR-002-fragile-endpoint-isolation.md`.
5. **Running tests against live production state.** Use `notion-testkit` fixtures / the mock server, or an explicitly sandboxed account.

## When Notion breaks something

Follow the `notion-endpoint-repair` skill: capture the new response, diff it against the fixture, patch the **one** file in `notion-api`, update the fixture. Nothing above `notion-api` should need to change.

## Where code lives

See `docs/CODEMAP.md` (feature → owning file). Durable decisions go in `docs/adr/`.

## Verifying

- Targeted only: `cargo test -p <crate>` for what you touched, `cargo clippy -p <crate>`. Do not run repo-wide checks unless asked.
- The deterministic verifier (`notion-testkit`) runs named groups headless; add a group when you add behavior.
