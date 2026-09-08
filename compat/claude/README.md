# compat/claude — Claude Code gateway

Pattern lifted from the Framer prototype's Claude integration (the cleanest known one).

**Gateway.** A loopback HTTP server on `127.0.0.1:<port>` that speaks the Anthropic
Messages API (JSON + SSE) and is backed by the Notionize pipeline. It only serves once
an eligible account exists.

**Launcher.** A tiny binary that:
1. writes an isolated Claude config dir (`CLAUDE_CONFIG_DIR`),
2. sets `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>`,
3. delivers the gateway bearer via `apiKeyHelper` (never as a CLI literal),
4. strips any real `ANTHROPIC_API_KEY` / auth-token env,
5. `exec`s the user's `claude` binary in the target workspace.

**Why this shape:** the user keeps using stock `claude`; all Notion specifics stay behind
the gateway; the bearer survives daemon restarts (read from keychain first). Codex would
be a parallel folder with a Responses-compatible gateway — never merged with this one.

Status: to be implemented in a later milestone (after the vertical slice works).
