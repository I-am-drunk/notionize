# CODEMAP — feature → owning file

Keep this current. If you can't find the owner of a behavior here, add it.

| Feature | Owner |
| --- | --- |
| Account model + lifecycle | `crates/notion-core/src/account.rs` |
| Workspace + credit snapshot | `crates/notion-core/src/workspace.rs` |
| Run one request (+ retry on exhaustion) | `crates/notion-core/src/pipeline.rs` |
| Out-of-credits → new workspace policy | `crates/notion-core/src/credits.rs` |
| Account selection across the pool | `crates/notion-core/src/rotation.rs` |
| Ports (seams to adapters) | `crates/notion-core/src/port.rs` |
| **Notion transport (cookies, headers, status policy)** | `crates/notion-api/src/transport.rs` |
| **Login / add account** | `crates/notion-api/src/login.rs` |
| **Inference envelope + NDJSON parser** | `crates/notion-api/src/inference.rs` |
| **Credit reads** | `crates/notion-api/src/credits.rs` |
| **Workspace create** | `crates/notion-api/src/workspace.rs` |
| **Model catalog** | `crates/notion-api/src/models.rs` |
| SQLite state (non-secret) | `crates/notion-store/src/lib.rs` (`SqliteStateStore`) |
| Keychain sessions (secret) | `crates/notion-store/src/lib.rs` (`KeyringSessionStore`) |
| REST/SSE + static hosting | `crates/notion-server/src/lib.rs` |
| CLI + daemon wiring | `crates/notionize/src/main.rs` |
| Test doubles + fixtures | `crates/notion-testkit/src/lib.rs` |
| Deterministic verifier | `crates/notion-testkit/src/main.rs` |
| Web UI | `web/src/App.tsx` |
| Claude Code gateway | `compat/claude/` |
| Boot service | `platform/macos/`, `platform/linux/` |

**Bold** = the fragile layer. Notion changes touch only these files (+ fixtures).
