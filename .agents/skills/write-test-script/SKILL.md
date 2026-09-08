---
name: write-test-script
description: Write a test or probe that runs against loaded accounts through notion-testkit, without rebuilding or risking the running daemon. Use when validating new Notion behavior or adding a verifier group.
---

# Writing a test / probe

Test behavior, offline and deterministic. Never point tests at live production state.

- **Unit/behavior:** add a group in `crates/notion-testkit/src/main.rs`. Drive
  `notion-core` with `MockNotion` + `Mem*Store`. Assert observable outcomes (rotation
  happened, fail-closed error, text/usage), not implementation details.
- **Endpoint parsing:** add a fixture (a captured NDJSON/JSON body) and a group that feeds
  it through the relevant `notion-api` parser.
- **Live probe (careful):** use the Test page in the web UI or `notionize run` against an
  account explicitly marked for testing. Watch the raw stream. This is the safe place to
  probe a new endpoint before wiring it in.

Run: `cargo run -p notion-testkit --bin notion-verify -- --only <substring>`.
