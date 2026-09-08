# Notion AI HAR semantics

## Scope and redaction

This note analyzes two local captures only:

- `ai-probe-auto.har` (trace A)
- `ai-probe-gpt56-sol-medium.har` (trace B)

This is intentionally the original two-trace deep dive. The later no-thinking trace, three-transaction comparison, corrected terminal-usage mapping, and compaction verdict are in `inference-protocol-findings.md`, `stream-field-compatibility.md`, and `anthropic-sse-compatibility.md`.

No network request was made. Cookie values, account/workspace/page/thread/trace/message IDs, email/name fields, prompts, returned prose, and analytics identifiers are intentionally omitted. Schema examples use `<redacted-…>` placeholders.

## Main finding

The browser sends Notion AI work to `POST https://app.notion.com/api/v3/runInferenceTranscript`. It submits JSON and requests `application/x-ndjson`; Notion returns a zstd-compressed NDJSON patch stream over HTTP/2. The stream builds a transcript state, incrementally extends the assistant text, attaches final token/timing/model metadata, returns persisted thread records, and closes with a full synchronized state.

Both captures keep model-vendor traffic server-side: there is no browser request to OpenAI, Anthropic, Gemini, xAI, Kimi, DeepSeek, or GLM. Model names exposed to the browser are Notion aliases and provider metadata.

## Observed endpoints

All routes below are on `https://app.notion.com/api/v3/` and use `POST`.

| Endpoint | Trace A | Trace B | Status and response MIME | Observed role |
|---|---:|---:|---|---|
| `runInferenceTranscript` | 1 × 388 ms | 1 × 124 ms | 200, `application/x-ndjson` | Submit transcript/config and stream patches |
| `getAvailableModels` | 1 × 246 ms | 1 × 190 ms | 200, JSON | Return model-picker roster and restrictions |
| `getInferenceTranscriptsUnreadCount` | 2 × 151–162 ms | 2 × 143–170 ms | 200, JSON | Unread AI-thread count |
| `markInferenceTranscriptSeen` | 2 × 184–300 ms | 1 × 156 ms | 200, JSON | Mark an AI thread seen |
| `warmSearchCache` | 1 × 227 ms | — | 200, JSON | Warm workspace search cache |
| `warmVectorDBCache` | 1 × 398 ms | — | 200, JSON | Warm vector-search cache |
| `getAIUsageEligibilityV2` | — | 1 × 789 ms | HAR status 0, no MIME | Usage, limit, credit, and dependency data; capture status is indeterminate |
| `getCreditRateLimitStatus` | — | 1 × 129 ms | 200, JSON | Credit-rate-limit state |
| `etClient` | 2 × 259–438 ms | 4 × 131–339 ms | 200, JSON | Batched client lifecycle/product analytics |
| `syncRecordValuesSpaceInitial` | 8 × 130–443 ms | 10 × 133–195 ms | 200, JSON | Hydrate referenced Notion records |
| `syncRecordValuesMain` | 1 × 158 ms | — | 200, JSON | Hydrate additional records |
| `saveTransactionsFanout` | — | 1 × 230 ms | 200, JSON | Persist a transaction batch immediately before trace B |
| `getAssetsJsonV2` | — | 1 × 128 ms | 200, JSON | Client asset/build metadata, not inference |

Peripheral capture traffic also includes Notion experiment registration (`exp.notion.com/v1/rgstr`), Splunk collection, Sentry envelopes, and static assets. Those are telemetry/assets, not browser-to-model inference endpoints.

A later settled export, `ai-session-settled-full.har`, captured the previously in-flight `getAIUsageEligibilityV2` call completing with status 200 and JSON. The status-0 row above accurately describes the earlier isolated snapshot, not the final network outcome.

## Transport and authentication context

- Request: HTTP/2, `Content-Type: application/json`, `Accept: application/x-ndjson`, no query parameters.
- Response: HTTP/2, `Content-Type: application/x-ndjson`, `Content-Encoding: zstd`.
- The browser included a `Cookie` header plus `x-notion-active-user-header` and `x-notion-space-id`. No standalone `Authorization` header appears in either inference request. All values are redacted.
- Other correlation headers include `sentry-trace` and `baggage`; client/version and audit-platform headers are also present.
- Request bodies were 3,323 bytes (A) and 3,549 bytes (B) in the HAR.

## `runInferenceTranscript` request schema

The observed shape is:

```text
{
  asPatchResponse: boolean,
  patchResponseVersion: number,
  createThread: boolean,
  generateTitle: boolean,
  isPartialTranscript: boolean,
  saveAllThreadOperations: boolean,
  setUnreadState: boolean,
  supportsCustomAgentNudgeTranscriptStep: boolean,
  createdSource: string,
  threadType: string,
  debugOverrides: object,
  spaceId: "<redacted-space-id>",
  threadId: "<redacted-thread-id>",
  traceId: "<redacted-trace-id>",
  threadParentPointer?: {
    table: string,
    id: "<redacted-parent-id>",
    spaceId: "<redacted-space-id>"
  },
  transcript: [
    { type: "config", id: "<redacted>", value: { capability/config fields… } },
    { type: "context", id: "<redacted>", value: { datetime, surface, timezone, redacted user/workspace context… } },
    { type: "updated-config", id: "<redacted>", value: { model, reasoningEffort, modelFromUser } }?,
    { type: "user", id: "<redacted>", userId: "<redacted>", createdAt: "<redacted>", value: [["<redacted-prompt>"]] }
  ]
}
```

Common values in both traces were `asPatchResponse: true`, `patchResponseVersion: 2`, `createdSource: "workflows"`, `threadType: "workflow"`, `saveAllThreadOperations: true`, and `setUnreadState: true`. Config enabled `useWebSearch`, used search scope `everything`, exposed `notion-calendar` as an available connector, and separately had `internetAccess: false`.

Trace-specific behavior:

| Field | Trace A | Trace B |
|---|---|---|
| Thread operation | New thread (`createThread: true`) | Continue thread (`createThread: false`) |
| Transcript mode | Full (`isPartialTranscript: false`) | Partial (`isPartialTranscript: true`) |
| Title | Generated | Not generated |
| Submitted step types | `config`, `context`, `user` | `config`, `context`, `updated-config`, `user` |
| Model selection | `modelFromUser: false`; no submitted model value | Initial `oatmeal-cookie`, then `updated-config` selects `orange-mousse`, `reasoningEffort: medium`, `modelFromUser: true` |
| Prompt | One nested text item, 54 characters, redacted | One nested text item, 57 characters, redacted |

Related request/response shapes are small and regular:

- `getAvailableModels`: `{spaceId}` → `{models[], restrictedAccessModelsInPickerConfig[], restrictedGeoPolicyApplied}`.
- `getInferenceTranscriptsUnreadCount`: `{spaceId, threadParentId}` → `{count}`.
- `markInferenceTranscriptSeen`: `{spaceId, threadId}` → `{ok}`.
- Cache warmers: `{spaceId}` → `{}`.
- `getCreditRateLimitStatus`: `{spaceId}` → `{status}`.
- `getAIUsageEligibilityV2`: `{spaceId}` → `{usage, limits, basicCredits, premiumCredits, dependencies}`.
- Record sync: `{requests:[{pointer, version}], spacePointer}` → `{recordMap}`.
- `etClient`: `{api_key, client_upload_time, events[], options, request_metadata}` → ingestion counters. The API key and all analytics identity fields are omitted here.

## NDJSON patch protocol

The request asks for patch response version 2. The observed NDJSON envelope independently labels both `patch-start` and `patch-sync` as `version: 1`.

Observed line types are:

```text
patch-start { data: { s: [...] }, version: 1 }
patch       { v: [{ o, p, v }, ...] }
record-map  { recordMap: {...} }
patch-sync  { data: { s: [...] }, version: 1 }
```

`s` is the ordered transcript/state array. Opcode `a` adds a value (including append at `/s/-`). Opcode `x` extends the string at an existing content path. In both traces, concatenating the initial content with every `x` value exactly reproduces the final `patch-sync` content.

### Trace A: automatic model selection

Fifteen NDJSON lines arrived in this order:

1. `patch-start`: initial state contains one `agent-instruction-state`.
2. Append `agent-turn-full-record-map`.
3. Append applied `agent-tool-result` for `connections.fs.readFiles`, auto-load phase `core_docs` (23 file arguments, 16 ms).
4. Append applied `agent-tool-result` for `connections.fs.readFiles`, auto-load phase `user_docs` (3 file arguments, 15 ms).
5. Append applied `agent-tool-result` for `connections.notion.loadUser`, auto-load phase `context_urls` (28 ms).
6. Append `config`; the server-selected model is `oatmeal-cookie`.
7. Append `title`.
8. Append `agent-inference` with the first 3 content characters.
9. Three `x` patches extend that content by 3, 8, and 3 characters.
10. One patch adds completion/token/timing/model fields; another attaches an empty `recordVersions` array.
11. `record-map`: `thread` has 1 record and `thread_message` has 10 records.
12. `patch-sync`: final state has 8 steps in the order `agent-instruction-state`, `agent-turn-full-record-map`, three `agent-tool-result` steps, `config`, `title`, `agent-inference`.

The final response text is 17 characters (redacted), and the exact incremental reconstruction check passed.

Final inference metadata:

| Field | Value |
|---|---:|
| Model | `oatmeal-cookie` |
| Input / output tokens | 22,560 / 8 |
| Cached tokens read / created | 20,864 / 0 |
| Submit-to-LLM | 49.1 ms |
| Server time to first token | 3,627.2 ms |
| Post-submit time to first token | 3,578.1 ms |
| Max context / max input | 400,000 / 272,000 tokens |
| Model failover | `null` |

The client analytics report zero model tool calls. That is consistent with the three `agent-tool-result` rows being pre-inference auto-load/context hydration rather than model-initiated tool calls.

### Trace B: explicit `orange-mousse`, medium reasoning

Nine NDJSON lines arrived:

1. `patch-start`: one `agent-turn-full-record-map` step.
2. Append `agent-inference` with the first 3 characters.
3. Three `x` patches extend content by 6, 8, and 3 characters.
4. Add completion/token/timing/model fields and an empty `recordVersions` array.
5. `record-map`: `thread` has 1 record and `thread_message` has 3 records.
6. `patch-sync`: final state is `agent-turn-full-record-map`, `agent-inference`.

The final response text is 20 characters (redacted), and the exact incremental reconstruction check passed.

Final inference metadata:

| Field | Value |
|---|---:|
| Model | `orange-mousse` |
| Submitted reasoning effort | `medium` |
| Input / output tokens | 4,862 / 8 |
| Cached tokens read / created | 4,859 / 16,967 |
| Submit-to-LLM | 30.9 ms |
| Server time to first token | 2,468.9 ms |
| Post-submit time to first token | 2,438.0 ms |
| Max context / max input | 400,000 / 272,000 tokens |
| Model failover | `null` |

## Model roster

Both `getAvailableModels` responses expose the same 31 aliases. The API reported 30 enabled and 1 disabled, with `restrictedGeoPolicyApplied: false`.

- Anthropic: `acai-budino-high` (disabled), `agave-flan`, `almond-croissant-low`, `ambrosia-tart-high`, `angel-cake-high`, `anthropic-haiku-4.5`, `apricot-sorbet-high`, `avocado-froyo-medium`.
- DeepSeek: `baseten-deepseek-v4-flash`, `baseten-deepseek-v4-pro`.
- Gemini: `galette-medium-thinking`, `gingerbread`, `grapefruit-zeppole`, `vertex-gemini-3.5-flash`, `vertex-gemini-3.6-flash`.
- GLM: `baseten-glm-5.2`.
- Kimi: `fireworks-kimi-k2.6`, `fireworks-kimi-k2.7`, `fireworks-kimi-k3`.
- OpenAI: `oatmeal-cookie`, `olive-jellyroll`, `opal-quince-medium`, `orange-mousse`, `orchid-muffin`, `oregon-grape-medium`, `otaheite-apple-medium`, `oval-kumquat-medium`.
- xAI: `soursop-shortcake`, `strawberry-whoopiepie`, `xigua-mochi-medium`, `xinomavro-cake`.

The disabled alias has restricted codename `acai-budino` and reason `business_or_enterprise_plan_required`. In the roster, `oatmeal-cookie` is OpenAI/fast and `orange-mousse` is OpenAI/intelligent. These are Notion-side labels; the HAR does not establish the exact upstream vendor model version.

## Timing and causality

Trace A, relative to its inference request:

- `runInferenceTranscript` starts at 0 ms.
- Search and vector cache warmers start at +140 and +141 ms, overlapping the stream.
- The first `markInferenceTranscriptSeen` begins at +820 ms.
- The first AI telemetry batch begins at +2,389 ms.
- `getAvailableModels` begins at +4,988 ms, after inference began; it is not a prerequisite for that turn.
- The terminal telemetry batch begins at +5,429 ms.
- Client lifecycle events report first chunk at 1,112 ms and terminal completion at 5,002 ms. Agent metrics report 4,002 ms total turn duration and 3,275 ms client time to first token.

Trace B:

- A transaction save and record sync start 248 and 247 ms before inference, consistent with persisting the model/config change.
- `runInferenceTranscript` starts at 0 ms; record sync follows at +112 ms.
- First telemetry upload starts at +420 ms; its lifecycle event records first chunk at 434 ms.
- `markInferenceTranscriptSeen` starts at +3,742 ms and `getAvailableModels` at +3,848 ms.
- Terminal telemetry reports completion at 3,853 ms and is uploaded in a later batch beginning at +5,189 ms.
- Agent metrics report 3,435 ms total duration and 2,521 ms client time to first token.

For both captures, the response `agent-inference.traceId` equals the request `traceId`; four telemetry events in each trace reference that same trace through `trace_id` or `ai_trace_id`. The values themselves are redacted.

The HAR-level request times (388 ms and 124 ms) have `receive: 0` and are much shorter than client/server lifecycle metrics. They should not be interpreted as end-to-end stream duration; they appear to reflect the recorder's request/header phase or another narrower interval.

## Limitations

- Two short successful turns cannot enumerate every AI mode, tool, error, retry, attachment, search, edit, image, connector, or failover path.
- NDJSON line order is preserved, but HAR does not provide per-line arrival timestamps or raw HTTP/2 frame boundaries.
- The recorder is inconsistent: trace A marks `response.content.encoding` as `base64` although its text is already plain NDJSON; trace B contains actual base64 and was decoded locally. Both decoded bodies parsed as NDJSON.
- `getAIUsageEligibilityV2` contains a structured body but has HAR status 0 and no MIME, so its transport outcome cannot be called successful from this capture.
- Analytics uploads are batched, and embedded server, agent, client, and HAR timings measure different scopes; they are evidence, not a single shared clock.
- The backend's provider request, system prompt, routing policy, and upstream response are not present. The browser sees only Notion's `/api/v3/` facade and Notion model aliases.
- Record maps contain private persisted objects. Only table names, counts, and wrapper shapes were used here; their identifiers and contents remain omitted.
