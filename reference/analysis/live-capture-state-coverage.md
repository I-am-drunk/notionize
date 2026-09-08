# Live capture state coverage

## Scope and privacy boundary

This note covers the latest private capture,
`captures/raw/notionize-live-2026-08-27T03-50-19.759Z.json`, and its shareable
schema derivative,
`captures/sanitized/notionize-live-2026-08-27T03-50-19.759Z.schema.json`.
The raw capture remains mode `0600`. The derivative is mode `0644` and contains
only allowlisted structural enums, booleans, counts, byte/string lengths,
context thresholds, and per-inference token metrics. It contains no captured
URLs, identifiers, headers, cookies, credentials, model aliases, prompt text,
or response text. Credit/accounting values are omitted; only their field names
and value types are retained.

The capture contains 584 events across two hook sessions and four targeted
requests. All four request bodies parsed as JSON and were rewritten by the
capture hook to request full agent steps, debug errors, and an explicit context
management configuration. These are instrumented observations, not evidence
about an unmodified request.

## Target comparison

| Target | Request transcript order | Sanitized request-size evidence | Observed application outcome | Decoded NDJSON sequence |
|---:|---|---:|---|---|
| 1 | `config → context → context → user` | 3,959 body bytes; one 86-character user string | Success | `patch-start → patch → patch → patch → patch → record-map → patch-sync` |
| 2 | `config → context → context → user` | 37,918 body bytes; one 34,045-character user string | Long synthetic success | `patch-start → patch → patch → patch → patch → patch → record-map → patch-sync` |
| 3 | `config → context → context → user` | 3,962 body bytes; one 89-character user string | Application-level quota failure | `patch-start → record-map` |
| 4 | `config → context → context → updated-config → user` | 4,077 body bytes; one 102-character user string | Application-level quota failure after an updated configuration step | `patch-start → record-map` |

A success classification requires one deduplicated `agent-inference` call and
a terminal `patch-sync`; targets 1 and 2 meet both conditions. The quota
classification requires the exact `premium-feature-unavailable` step; targets
3 and 4 contain it and contain no `agent-inference` call or terminal
`patch-sync`. Duplicate structural occurrences in patches and the final record
map are not counted as separate calls or failures.

## Protocol framing

Every target received HTTP `200`. Each response header classified the payload
as `application/x-ndjson` and retained `content-encoding: zstd`. The hook reads
a cloned Fetch `Response.body`, so its captured chunks are already decoded by
the browser; they are not zstd wire bytes. The decoded chunks parse directly as
newline-delimited JSON.

Targets 1–4 used 6, 7, 2, and 2 captured chunks respectively. They yielded 7,
8, 2, and 2 non-empty NDJSON objects with zero parse failures. Chunk indexes,
per-chunk byte lengths, final chunk counts, and final byte totals reconcile for
all four transactions.

The quota state is therefore an application-level result inside an HTTP-200
NDJSON stream, not an observed HTTP `429` or other transport failure.

## Exact structural types

Successful responses use these exact type discriminators:

- framing: `patch-start`, `patch`, `record-map`, `patch-sync`;
- agent records: `agent-turn-full-record-map`, `agent-inference`, `config`;
- nested content/configuration: `text`, `workflow`, `everything`.

Quota responses use these exact type discriminators:

- framing: `patch-start`, `record-map`;
- agent records: `premium-feature-unavailable`, `config`;
- feature-availability discriminators: `unavailable`, `cumulative`, `product`;
- nested configuration: `workflow`, `everything`.

No type value in the derivative falls back to an unknown-enum bucket.

## Token and usage structure

Each successful transaction contains one deduplicated `agent-inference` with
these per-inference fields and values:

| Target | `inputTokens` | `outputTokens` | `cachedTokensRead` | `cachedTokensCreated` | `maxContextTokens` | `maxInputTokens` |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 29,911 | 18 | 29,580 | 12,484 | 200,000 | 160,000 |
| 2 | 34,685 | 7 | 29,580 | 28,949 | 200,000 | 160,000 |

Targets 3 and 4 have no per-inference token object because no
`agent-inference` step was returned.

All four final record maps contain a thread-level `usage_summary` schema with
numeric `input_tokens`, `output_tokens`, `cached_input_tokens_created`,
`cached_input_tokens_read`, `agent_inference_count`, and `completion_count`.
They also contain `credits_by_type_unit` with numeric `basic_ai_credits`,
`exempt_ai_credits`, `premium_ai_credits`, and `preview_ai_credits`. Those
cumulative fields are thread state and must not be attributed to only the
active request. Their numeric values are deliberately not copied into the
derivative or this note.

## Summary and compaction markers

Each request carries numeric `compactThreshold`, `createSummaryThreshold`, and
`updateSummaryInterval` fields. Across all four request bodies and decoded
responses, exact occurrence counts are zero for:

- `agent-transcript-summary`;
- `activate-transcript-compaction`;
- `summary-inference`;
- `summarize-transcript`;
- `summarize-transcript-error`.

This establishes that context-management configuration was present but no
summary or compaction marker was observed in these transactions. It does not
establish that compaction is disabled, unreachable, or unsupported.

## Coverage boundaries

Observed live states are a short success, a long synthetic success, and two
application quota failures, including one request with an `updated-config`
transcript step. The following target states remain unobserved in this capture:

- transcript summarization or compaction activation;
- summary inference success or summary failure;
- a top-level NDJSON `error` event;
- target HTTP non-2xx behavior, including HTTP `429`;
- target fetch/network failure, cancellation, or abort;
- model failover, retry exhaustion, or alternate-attempt usage;
- tool-use/tool-result steps;
- a target response framed as SSE, plain JSON, or anything other than NDJSON.

Absence from these four transactions supports no claim about whether any of
those states can occur elsewhere.

## Validation

`analysis/live-capture-latest-privacy-scan.json` records an independent,
deterministic audit. It verifies source byte count and digest, event and target
counts, file modes, JSON parsing, response-chunk integrity, complete NDJSON
parsing, structural enum coverage, and byte-for-byte sanitizer regeneration.
The URL, absolute-path, UUID, compact-identifier, email, JWT, bearer-token,
Notion-token, and serialized-cookie scans all report zero hits. The path-aware
string audit, forbidden-key audit, and unknown-enum audit also report zero.

Reproduce from the repository root:

```sh
node reference/scripts/sanitize_live_capture.mjs \
  reference/captures/raw/notionize-live-2026-08-27T03-50-19.759Z.json \
  reference/captures/sanitized/notionize-live-2026-08-27T03-50-19.759Z.schema.json
node reference/scripts/audit_live_capture.mjs \
  reference/captures/raw/notionize-live-2026-08-27T03-50-19.759Z.json \
  reference/captures/sanitized/notionize-live-2026-08-27T03-50-19.759Z.schema.json \
  reference/analysis/live-capture-latest-privacy-scan.json
```
