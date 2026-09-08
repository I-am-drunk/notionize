# ADR-002 — Isolate the fragile Notion surface

## Decision

Everything that depends on Notion's private, undocumented `/api/v3` surface lives in
`crates/notion-api`, one small file per endpoint, behind the `NotionClient` port.
`notion-core` and everything above it never import `reqwest`, never see a Notion header,
status code, zstd body, NDJSON line, or model codename.

## Why

Notion can change these endpoints without notice. When they do, the blast radius must be
a single file plus its fixture — not a refactor. This is the difference between a 10-minute
repair and a rewrite.

## Rules baked in

- Only HTTP 401 means signed-out; every other non-200 is retryable (never destroy a
  healthy account on a transient 429/5xx).
- Credit exhaustion is an in-band signal (`premium-feature-unavailable`, no `patch-sync`),
  returned as `InferenceResult::Exhausted`. Never a blank `Completed`. Fail closed.
- Model codenames are volatile; v1 uses the default and treats the catalog as disposable.

## Repair loop

See the `notion-endpoint-repair` skill: capture → diff against fixture → patch one file →
update fixture → run the verifier.
