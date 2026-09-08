---
name: notion-endpoint-repair
description: Diagnose and fix a broken Notion endpoint in crates/notion-api when Notion changes its private /api/v3 surface. Use when inference, login, credits, or workspace calls start failing or returning unexpected shapes.
---

# Repairing a broken Notion endpoint

Notion changed something. Fix exactly one file in `crates/notion-api` and its fixture.

1. **Reproduce & capture.** Run the failing path (`notionize run …` or the Test page).
   Capture the real request/response with a browser HAR or the mock recorder. Never paste
   a live cookie into logs or the repo.
2. **Locate the owner.** `docs/CODEMAP.md` → the one bold file (e.g. `inference.rs`).
3. **Diff against the fixture** in `crates/notion-testkit` fixtures. See what field, opcode,
   status, or discriminator moved.
4. **Patch that one file only.** Do not leak the change upward — `notion-core` must not
   need edits. If it would, the seam in `port.rs` is wrong; fix the seam instead.
5. **Update the fixture** to the new shape and add/adjust a verifier group.
6. **Verify:** `cargo run -p notion-testkit --bin notion-verify`.

Remember the invariants (ADR-002): only 401 signs out; exhaustion is fail-closed.
