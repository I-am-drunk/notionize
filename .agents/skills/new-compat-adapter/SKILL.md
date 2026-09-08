---
name: new-compat-adapter
description: Add a new consumer under compat/ (e.g. Codex, or any tool) that talks to the Notionize pipeline. Use when integrating an external CLI or API-compatible client.
---

# Adding a compat adapter

Each consumer is a self-contained folder under `compat/`. Nothing in `crates/` changes.

1. Create `compat/<name>/`.
2. Stand up a local gateway that speaks the consumer's expected protocol (Anthropic
   Messages for Claude, Responses/OpenAI for Codex) and calls `notion-core::pipeline::run`.
3. If the consumer is a CLI, add a thin launcher that sets its base-URL env to the loopback
   and delivers the bearer out of band (helper/keychain), never as a CLI literal.
4. Keep protocols separate — never merge two consumers' gateways into one.
5. Document it in `compat/<name>/README.md` and link from `compat/README.md`.

Reference implementation shape: `compat/claude/README.md`.
