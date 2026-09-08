# compat/ — consumer adapters

How outside tools consume Notionize. Each consumer is one folder implementing the same
small idea: a local endpoint backed by the Notionize pipeline, plus (optionally) a
launcher that points a CLI at it. Adding "anything" = add a folder here; nothing in
`crates/` needs to change.

- `claude/` — a loopback Anthropic-compatible gateway + a launcher that execs the user's
  `claude` CLI against it. See `claude/README.md`.
- `codex/` — (future) the parallel Responses/OpenAI-compatible path.

See the `new-compat-adapter` skill for the recipe.
