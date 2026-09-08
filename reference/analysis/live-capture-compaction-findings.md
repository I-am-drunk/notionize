# Live capture: compaction and usage structure

## Scope and privacy boundary

This analysis covers the private capture copied to `captures/raw/notionize-live-2026-08-27T02-55-16.407Z.json`. The archived copy is mode `0600`, is 343,499 bytes, and has SHA-256 `49ee9a3300bf7ab51bf9f0f67d14cd2a0dbbf6eeacf4ae70ae82387734b7ef98`. The original download was preserved.

The shareable derivative is `captures/sanitized/notionize-live-2026-08-27T02-55-16.407Z.schema.json`. It contains types, counts, allowlisted structural enums, and evidence booleans only. It omits URLs, identifiers, headers, cookies, prompts, body text, arbitrary strings, and numeric payload values. `analysis/live-capture-privacy-scan.json` records the independent pattern and structural checks.

## Capture envelope

The file contains 98 capture events:

| Phase | Events | Target events |
|---|---:|---:|
| `hook-installed` | 1 | 0 |
| `request` | 25 | 1 |
| `response-start` | 25 | 1 |
| `response-chunk` | 26 | 6 |
| `response-end` | 21 | 1 |

The single targeted transaction is classified as `runInferenceTranscript`. Its request body parsed as JSON and contained four transcript entries. Its response was six captured chunks comprising seven valid `application/x-ndjson` objects in this order:

```text
patch-start → patch → patch → patch → patch → record-map → patch-sync
```

The response includes allowlisted nested types `agent-inference` and `agent-turn-full-record-map`. Repeated schema occurrences reflect the patch representation plus the returned record map; they do not prove multiple inference transactions.

## What this capture proves

### Compaction configuration exists in the request

The targeted request contains a `contextManagementConfiguration` object with numeric `compactThreshold`, `createSummaryThreshold`, and `updateSummaryInterval` fields. The capture hook also recorded that context configuration structurally. The numeric values are deliberately not copied into the sanitized derivative.

This proves that the browser request can carry client-visible compaction and summary thresholds. It does **not** prove that any threshold was crossed or that summarization or compaction executed.

### Per-inference token and context fields exist

The returned `agent-inference` structure contains numeric fields for:

- `inputTokens` and `outputTokens`;
- `cachedTokensCreated` and `cachedTokensRead`;
- `maxContextTokens` and `maxInputTokens`; and
- first-token timing fields.

The values are present in the private evidence but omitted from the schema-only artifact.

### The final record map contains cumulative usage structure

The returned thread record contains a `usage_summary` object. Its schema includes input/output/cache token counters, inference and completion counters, and credit categories. This is thread-level cumulative state and must not be treated as the usage ledger for only the active response.

## Compaction questions answered

| Question | Live evidence | Supported conclusion |
|---|---|---|
| `agent-transcript-summary` | Zero exact occurrences in captured URL fields, request bodies, decoded chunks, and the reconstructed target response; no allowlisted step type | Not observed in this capture |
| `activate-transcript-compaction` | Zero exact occurrences in the same locations; no allowlisted step type | Not observed in this capture |
| `summary-inference` | Zero exact occurrences in the same locations; no allowlisted step type | Not observed in this capture |
| Usage/token/context fields | Request threshold schema, per-inference token/context schema, and thread `usage_summary` are present | Structure is proven; values are intentionally withheld |
| Activation mode | No `activationMode` field was found in the parsed request or response schema | Not observed; mode cannot be determined |
| Before/after compaction state | One final record-map event is present, but there is no compaction activation marker or paired pre/post-compaction snapshots | No transition is proven |

## Verdict and limitation

The defensible verdict is **configuration observed; runtime compaction not observed**. This capture strengthens the evidence for Notion's context-management configuration, token accounting, and returned usage schema. It does not close the prior compaction-coverage gap because it contains neither a summary/activation event nor a before/after transition. Absence in one transaction is not evidence that Notion cannot emit those structures in a longer, threshold-crossing, resumed, failed, or differently configured session.

## Reproduce

From the Notionize root:

```sh
node reference/scripts/extract_live_capture_schema.mjs
jq empty reference/captures/sanitized/notionize-live-2026-08-27T02-55-16.407Z.schema.json
jq empty reference/analysis/live-capture-privacy-scan.json
```

The extractor refuses to process the archived raw file unless it is mode `0600`, parses the targeted request and NDJSON response, emits only allowlisted structural evidence, and fails if the generated schema matches URL, identifier, email, credential-token, or absolute-user-path patterns.
