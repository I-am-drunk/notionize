# Notionize

Always-on service that automates Notion AI: hold multiple Notion accounts, run AI
requests through them, and auto-create a fresh workspace when one runs out of credits.
One Rust binary (daemon + REST/SSE server + static web UI). Reachable locally or over
Tailscale.

See [`NOTIONIZE-PLAN.md`](./NOTIONIZE-PLAN.md) for the full design and [`AGENTS.md`](AGENTS.md)
for how to work in this repo.

## Layout

- `crates/notion-core` — stable domain + orchestration. No HTTP details.
- `crates/notion-api` — **the fragile layer**: one small file per Notion endpoint. Edit here when Notion changes.
- `crates/notion-store` — SQLite (non-secret state) + OS keychain (session cookies).
- `crates/notion-server` — REST/SSE HTTP server + serves the built web UI.
- `crates/notion-testkit` — testing CLI, script runner, mock server, deterministic verifier.
- `crates/notionize` — the binary: CLI + daemon wiring.
- `web/` — React/Vite UI (built to static files, served by the binary).
- `compat/` — consumer adapters (Claude Code, Codex, …).
- `platform/` — per-OS boot service (launchd / systemd).

## Status

Skeleton. The vertical slice (login → run → auto-workspace → minimal UI) is being built out.
First `cargo build` must run where crates.io is reachable.
