# Notionize reference archive: technical capture report

_Draft generated from the archived artifacts. This is a bounded snapshot of observed behavior, not an exhaustive reconstruction of Notion or Notion AI._

> **Superseded interim snapshot.** This file preserves the four-HAR/two-probe analysis stage for provenance. Its counts predate the later HARs, full-runtime archive, persistent-hook evidence, and SSE/compaction audit. Use `/Users/irene/Documents/Notionize/NOTION_AI_BROWSER_AND_ENDPOINT_ARCHIVE.md` for the current six-HAR, five-success/two-quota-failure result.

## Executive summary

The archive captures four browser-network states, a content-addressed subset of the loaded Notion web application, two focused AI turns, a settled post-interaction session, and privacy-safe derived catalogs. Across the four raw HARs, the endpoint catalog records 624 request observations, 332 unique method/endpoint pairs, and 9 hosts. The browser-code pass recovered 225 embedded JavaScript/CSS/HTML responses, representing 222 unique bodies and 16.74 MB of unique decoded code.

The strongest AI finding is the browser-facing inference contract:

```text
POST https://app.notion.com/api/v3/runInferenceTranscript
Content-Type: application/json
Accept: application/x-ndjson
```

Notion returns a zstd-compressed NDJSON patch stream. The stream creates or continues transcript state, appends assistant text incrementally, adds model/token/timing metadata, returns persisted thread records, and closes with a synchronized state. No captured browser request goes directly to an external model vendor; provider routing occurs behind Notion's `app.notion.com/api/v3` facade.

Two controlled UI/network probes show distinct paths:

- An automatic-selection, new-thread turn omitted an explicit submitted model and ultimately used Notion alias `oatmeal-cookie`, listed by the model roster as **GPT-5.2**.
- A continuation turn used the visible **GPT-5.6 Sol** selector with medium reasoning. The request carried an `updated-config` step selecting alias `orange-mousse`, and the final inference metadata echoed that alias.

The archive is useful for endpoint discovery, protocol study, and repeatable comparison. It does not expose Notion's server-side provider calls, system prompt, routing algorithm, or every lazy-loaded product path.

## 1. Methodology

The evidence was assembled in layers so that high-risk raw captures could remain separate from shareable derived material:

1. **Browser capture.** Four raw HARs record a baseline page, an automatic-model AI probe, an explicit GPT-5.6 Sol probe, and a settled AI session.
2. **Static asset recovery.** The baseline HAR was scanned only for the first `app.notion.com` HTML document and embedded `/_assets/` JavaScript/CSS bodies. Bodies were decoded, hashed, deduplicated, and saved under content-stable filenames.
3. **Static indexing.** Recovered code was scanned for literal `/api/v3` paths and AI-related symbols. These are lexical candidates, not proof of runtime calls.
4. **Network cataloging.** Raw HARs were reduced to URL structure, method, status, MIME, timing, response-size, query-name, and capture-count metadata. Headers, cookies, query values, and bodies were excluded from the endpoint catalog.
5. **Focused protocol analysis.** The two probe HARs were compared for request shape, NDJSON event order, transcript operations, model metadata, telemetry timing, and causal ordering. Private values were replaced conceptually with placeholders and were not copied into the analysis note.
6. **Model-roster extraction.** The non-personal `getAvailableModels` response was normalized into JSON and CSV, preserving aliases, display names, provider/family labels, supported reasoning effort, surface availability, and model-card attributes.
7. **Sanitization and validation.** A deterministic sanitizer removed credential/session headers, HAR cookie objects, personal identifiers, opaque IDs, and identifier-bearing JSON keys while preserving structural shapes and selected analytical fields.
8. **Integrity inventory.** A SHA-256 manifest and JSON inventory record path, byte size, and digest for the reference tree as it existed at inventory generation time.

Endpoint classifications in the catalogs are analytical labels:

- **Direct:** AI-specific name and observed role.
- **Support:** concurrent retrieval/cache preparation.
- **Correlated:** generic Notion operations seen in the AI flows.

“Correlated” does not mean an endpoint is exclusive to AI.

## 2. Archive inventory

The point-in-time inventory at `analysis/archive-inventory.json` records 253 files totaling 111,348,904 bytes (about 106.2 MiB). This draft was created after that snapshot and is therefore not included in its count or SHA-256 manifest.

| Archive area | Contents |
|---|---|
| `reference/har/` | 4 raw HARs, 4 sanitized counterparts, and the sanitizer |
| `reference/assets/browser-code/files/` | 219 unique JavaScript files, 2 CSS files, and 1 HTML document |
| `reference/assets/browser-code/` | Asset manifest, literal API-route catalog, AI-symbol catalog, and scan summary in JSON/CSV |
| `reference/analysis/` | Endpoint catalogs, model roster, protocol note, privacy report, static-code findings, inventory, and hashes |
| `reference/scripts/` | Static extractor, endpoint cataloger, model-roster extractor, and archive-inventory builder |
| `reference/screenshots/` | One UI/network evidence screenshot; it contains private UI context and is not sanitized |

Raw capture sizes and entry counts:

| Capture | Entries | Raw bytes | Purpose |
|---|---:|---:|---|
| `baseline-full.har` | 317 | 39,174,568 | Baseline app/network and static-code source |
| `ai-probe-auto.har` | 37 | 950,976 | Automatic model, new thread, full transcript |
| `ai-probe-gpt56-sol-medium.har` | 31 | 580,881 | Explicit model/reasoning, continuation turn |
| `ai-session-settled-full.har` | 239 | 7,922,115 | Settled UI/session traffic after the AI interaction |

The baseline static pass selected 225 embedded responses: 222 JavaScript, 2 CSS, and 1 HTML. Three JavaScript responses were byte-identical duplicates, leaving 222 unique bodies. Every manifest-to-file mapping was rehashed successfully.

## 3. Observed AI and adjacent endpoints

All confirmed browser-facing AI routes use `POST` under `https://app.notion.com/api/v3/`.

### Direct AI routes

| Endpoint | Observations | Observed status/MIME | Role |
|---|---:|---|---|
| `runInferenceTranscript` | 3 | 3 × 200, `application/x-ndjson` | Core inference/transcript stream |
| `getAvailableModels` | 3 | 3 × 200, JSON | Model-picker roster and availability |
| `getAIUsageEligibilityV2` | 2 | one 200 JSON; one HAR status 0 | Usage, limits, credit eligibility, dependencies |
| `getCreditRateLimitStatus` | 2 | 2 × 200, JSON | Credit-rate-limit state |
| `getInferenceTranscriptsUnreadCount` | 7 | 7 × 200, JSON | Transcript lifecycle/unread state |
| `markInferenceTranscriptSeen` | 4 | 4 × 200, JSON | Transcript lifecycle/seen state |

### Retrieval support

| Endpoint | Observations | Role |
|---|---:|---|
| `warmSearchCache` | 1 | Workspace-search warmup |
| `warmVectorDBCache` | 1 | Vector-retrieval warmup |

Both warmups began about 140 ms after the automatic inference request and overlapped that turn. Their timing supports a retrieval-preparation role, but one observation per route is not enough to generalize to every turn.

### Correlated generic routes

| Endpoint | Observations | Interpretation |
|---|---:|---|
| `etClient` | 22 | Batched client lifecycle and product analytics |
| `syncRecordValuesSpaceInitial` | 32 | Generic Notion record hydration |
| `syncRecordValuesMain` | 2 | Additional record hydration |
| `saveTransactionsFanout` | 2 | Generic persistence; observed immediately before explicit-model inference |
| `getAssetsJsonV2` | 28 | Client asset/build metadata |

Peripheral traffic includes Notion experiment registration, Splunk ingestion, Sentry envelopes, image delivery, message-store traffic, and third-party page content. Across the raw captures, `app.notion.com` accounts for 480 of 624 observations. None of the nine observed hosts is a direct OpenAI, Anthropic, Google/Gemini, xAI, Kimi, DeepSeek, or GLM API endpoint.

Static-code scanning found only seven literal normalized `/api/v3` strings in the recovered bundles, and none was explicitly AI-named. The runtime-confirmed AI routes therefore demonstrate an important limitation of literal bundle search: operation names may be supplied separately, assembled dynamically, or live in lazy chunks absent from the baseline.

## 4. Inference request and stream protocol

### Request envelope

The two focused requests use HTTP/2 JSON and include browser session cookies plus Notion active-user and space-scoping headers. The analysis does not retain their values. No standalone `Authorization` header appears in either focused inference request.

The observed high-level body is:

```text
{
  asPatchResponse: true,
  patchResponseVersion: 2,
  createThread: boolean,
  generateTitle: boolean,
  isPartialTranscript: boolean,
  saveAllThreadOperations: true,
  setUnreadState: true,
  createdSource: "workflows",
  threadType: "workflow",
  debugOverrides: {...},
  spaceId: "<redacted>",
  threadId: "<redacted>",
  traceId: "<redacted>",
  threadParentPointer?: {...redacted identifiers...},
  transcript: [
    {type: "config", value: {...capabilities, model policy, retrieval settings...}},
    {type: "context", value: {...surface, time, redacted user/workspace context...}},
    {type: "updated-config", value: {model, reasoningEffort, modelFromUser}}?,
    {type: "user", value: [["<redacted prompt>"]]}
  ]
}
```

Both probes enabled `useWebSearch`, declared search scope `everything`, exposed `notion-calendar` as an available connector, and separately carried `internetAccess: false`. These flags show client configuration, not proof that a web search occurred.

### Stream envelope and operations

The response is `application/x-ndjson` with `Content-Encoding: zstd`. Its logical sequence is:

```text
patch-start  -> patch* -> record-map -> patch-sync
```

- `patch-start` supplies initial transcript/state array `s`.
- Each `patch` contains operations `{o, p, v}`.
- Observed opcode `a` adds a value or appends a step at `/s/-`.
- Observed opcode `x` extends an existing assistant-content string.
- A final metadata patch adds finish time, input/output tokens, cache counters, server timing, context limits, model alias, and failover state.
- `record-map` returns persisted `thread` and `thread_message` records.
- `patch-sync` supplies the final synchronized state.

The request asks for patch response version 2, while the observed `patch-start` and `patch-sync` envelopes label themselves `version: 1`; these appear to be distinct version fields.

For both probes, concatenating the initial assistant content with all `x` chunks exactly reproduced the final synchronized content. The response inference trace matched the request trace, and four telemetry events per probe referenced the same trace through `trace_id` or `ai_trace_id`; all values remain redacted.

### Automatic-selection turn

The new-thread stream contained 15 NDJSON lines. It began with an instruction state, then appended a full-record-map marker and three applied auto-load results:

- `connections.fs.readFiles`, `core_docs`, 23 file arguments, 16 ms;
- `connections.fs.readFiles`, `user_docs`, 3 file arguments, 15 ms;
- `connections.notion.loadUser`, `context_urls`, 28 ms.

It then appended server config, title, and inference steps. Final metadata reported `oatmeal-cookie`, 22,560 input tokens, 8 output tokens, 20,864 cached tokens read, and a 3,627 ms server time to first token. Client telemetry reported no model tool calls, consistent with the three earlier steps being context auto-load rather than model-initiated tools.

### Explicit-model continuation

The continuation stream contained 9 lines and only two final state steps: full-record-map and inference. The submitted `updated-config` chose `orange-mousse` with medium reasoning, and final metadata echoed `orange-mousse`: 4,862 input tokens, 8 output tokens, 4,859 cached tokens read, 16,967 cached tokens created, and a 2,469 ms server time to first token.

HAR-level durations (388 ms and 124 ms) record `receive: 0` and are much shorter than client/server lifecycle measurements. They should not be treated as end-to-end stream latency; the capture format did not retain per-line arrival times or raw HTTP/2 frames.

## 5. Model aliases and routing evidence

The model-picker response exposes 31 Notion aliases from seven reported providers:

| Provider | Aliases |
|---|---:|
| Anthropic | 8 |
| DeepSeek | 2 |
| Gemini | 5 |
| GLM | 1 |
| Kimi | 3 |
| OpenAI | 8 |
| xAI | 4 |

Thirty aliases were enabled and one was disabled for a business/enterprise-plan requirement. The response reported `restrictedGeoPolicyApplied: false`. It divided models into `fast` and `intelligent` display groups, provided reasoning-effort configuration for 26 aliases, and included model-card speed/intelligence/cost scores where available.

The roster also contains surface-specific routing objects:

- 26 aliases have a `workflow` mapping;
- 29 have a `customAgent` mapping;
- 24 have an `agentService` mapping.

All populated `finalModelName` values in this snapshot equal the corresponding Notion alias, and all populated surface entries are marked beta. The browser submits the alias, not a public vendor endpoint. The server then echoes the alias on the completed inference step.

Two mappings are directly correlated with the UI probes:

| UI label from roster/UI | Notion alias | Reported provider/group | Reasoning evidence |
|---|---|---|---|
| GPT-5.2 | `oatmeal-cookie` | OpenAI / fast | Auto-selected; roster default medium |
| GPT-5.6 Sol | `orange-mousse` | OpenAI / intelligent | User-selected medium; supports none through max/xhigh in roster |

These mappings are strong browser-facing evidence, but they do not establish the exact upstream vendor model version, deployment, weights, system prompt, or server-side fallback policy.

## 6. Captured UI experiments

The archived interactions exercise a narrow but useful comparison:

1. **Automatic/new-thread condition.** `createThread: true`, `isPartialTranscript: false`, `generateTitle: true`, no submitted model value, and `modelFromUser: false`. The response config selected `oatmeal-cookie`.
2. **Explicit/continuation condition.** `createThread: false`, `isPartialTranscript: true`, `generateTitle: false`, and an `updated-config` step set `orange-mousse`, `reasoningEffort: medium`, and `modelFromUser: true`.
3. **Sidebar presentation.** Telemetry identifies `chat_mode: sidebar`. The screenshot shows the AI surface's Sidebar/Floating/Full Screen presentation menu, the GPT-5.6 Sol selector, and a usage-limit notice.
4. **Settled-session observation.** The larger post-interaction HAR records later model, usage, credit, transcript, asset, telemetry, and hydration calls, helping distinguish immediate inference traffic from deferred UI/session work.

The screenshot at `reference/screenshots/ai-gpt56-network.png` contains account/page context and response content. It is evidentiary but not privacy-safe for redistribution without image redaction.

The captures did not systematically test every visible model, reasoning level, presentation mode, attachment, connector, tool, web-search result, image flow, failure, cancellation, rate limit, or plan tier.

## 7. Privacy, security, and handling caveats

- **Raw HARs are sensitive.** They contain cookies, session and trace headers, workspace/user/page/thread IDs, emails/names, request prompts, response prose, record maps, and analytics payloads. Treat `reference/har/*.har` without `.sanitized` as restricted local evidence.
- **Prefer sanitized HARs for analysis and sharing.** The sanitizer produced a sanitized counterpart for all four raw captures and removed all recognized sensitive header names and HAR cookie objects.
- **Sanitization is not a guarantee.** Unusual identifiers in opaque or malformed payloads can remain. The sanitizer intentionally preserves response prose, model values, and event-type values, so sanitized files still require review before external release.
- **Stable placeholders are per-file only.** They allow internal correlation without a reversal map but should not be treated as cryptographic anonymization.
- **Static assets are vendor code.** The browser-code archive is useful for local research and hashing; it is not a license to redistribute Notion's proprietary bundles.
- **The screenshot remains unsanitized.** Keep it in the restricted evidence tier until pixels containing private UI context are redacted.
- **Hashes prove integrity, not safety.** Inclusion in `ARCHIVE_MANIFEST.sha256` says a file matches the archived bytes; it does not mean the file is privacy-safe.

The redaction pass across the two AI probes removed 191 credential/session/trace headers, 590 HAR cookie objects, and 1,135 identifier/credential/email occurrences representing 105 unique source values. Across all four sanitized HARs, automated post-run checks found zero remaining sensitive header names and zero HAR cookie objects.

## 8. Reproducibility

Run from `/Users/irene/Documents/Notionize/reference` with local files only:

```sh
# 1. Produce validated sanitized HARs.
python3 har/sanitize_har.py \
  har/ai-probe-auto.har \
  har/ai-probe-gpt56-sol-medium.har \
  har/ai-session-settled-full.har \
  har/baseline-full.har

# 2. Re-extract and hash embedded browser code from the baseline capture.
node scripts/extract_static_assets.mjs \
  har/baseline-full.har \
  assets/browser-code

# 3. Rebuild privacy-safe endpoint catalogs and summary.
python3 scripts/catalog_har_endpoints.py

# 4. Rebuild the non-personal model roster.
python3 scripts/extract_model_roster.py

# 5. Rebuild the reference-tree inventory and SHA-256 manifest last.
python3 scripts/build_archive_inventory.py

# 6. Verify archived files against the manifest on macOS.
shasum -a 256 -c analysis/ARCHIVE_MANIFEST.sha256
```

The scripts use fixed paths rooted at `/Users/irene/Documents/Notionize/reference`; portability would improve if those roots became command-line arguments. The detailed two-probe protocol comparison in `analysis/har-semantics.md` was produced with local `jq`/shell inspection rather than a committed dedicated parser, which is a current reproducibility gap.

## 9. Limitations and safe conclusions

Safe conclusions from this archive:

- The observed browser calls Notion's `runInferenceTranscript` JSON/NDJSON API for AI turns.
- The browser operates on Notion aliases and receives provider/family/display metadata from `getAvailableModels`.
- Automatic and explicit model-selection paths produce measurably different transcript requests.
- The response protocol is patch-based and reconstructs a final persisted transcript state.
- Retrieval warmups, record hydration, persistence, usage/credit checks, and telemetry surround the core stream.
- No direct browser-to-vendor model API call appears in these captures.

Claims the archive does **not** support:

- Complete enumeration of every Notion or Notion AI endpoint.
- Recovery of Notion's server-side source, system prompts, provider credentials, or routing algorithm.
- Proof that an alias always maps to one immutable upstream model.
- General latency benchmarks from two short turns or HAR `time` fields.
- A guarantee that every lazy chunk, service-worker response, experiment cohort, account tier, or geographic policy was captured.
- A guarantee that sanitized artifacts are safe without final human review.

Static identifiers such as `runInferenceTranscript`, `openNewAgentChat`, and `ai_connectors` are useful search leads, but runtime network evidence and response behavior remain the stronger evidence.

## 10. Evidence map

| Evidence | Path | Use |
|---|---|---|
| Detailed AI protocol analysis | `reference/analysis/har-semantics.md` | Request schema, NDJSON sequence, timing, causality |
| Direct/support/correlated AI catalog | `reference/analysis/ai-endpoints.json` / `.csv` | Counts, status, MIME, capture distribution |
| Full endpoint catalog | `reference/analysis/network-endpoints.json` / `.csv` | All observed hosts/routes without values or bodies |
| Compact network totals | `reference/analysis/network-summary.json` | Capture/host/category totals |
| Model roster | `reference/analysis/model-roster.json` / `.csv` | Aliases, labels, provider, reasoning, surface mappings |
| Static-code findings | `reference/analysis/static-assets-findings.md` | Extraction coverage and lexical caveats |
| Asset manifest | `reference/assets/browser-code/asset-manifest.json` / `.csv` | URL-to-file mapping and SHA-256 |
| Literal route catalog | `reference/assets/browser-code/api-v3-endpoints.json` / `.csv` | Static `/api/v3` strings |
| AI-symbol catalog | `reference/assets/browser-code/ai-symbols.json` / `.csv` | Lexical candidates and source files |
| Static scan summary | `reference/assets/browser-code/scan-summary.json` | Compact extraction totals |
| Privacy report | `reference/analysis/redaction-report.md` | Redaction counts, validation, exceptions |
| Inventory and integrity | `reference/analysis/archive-inventory.json`; `reference/analysis/ARCHIVE_MANIFEST.sha256` | Size/path/digest inventory |
| Raw and sanitized captures | `reference/har/` | Primary network evidence; raw files restricted |
| UI/network screenshot | `reference/screenshots/ai-gpt56-network.png` | Visual evidence; private until redacted |
| Reproduction scripts | `reference/scripts/`; `reference/har/sanitize_har.py` | Regenerate derived artifacts |

## Conclusion

The archive establishes a coherent browser-side picture: Notion AI is exposed as a transcript-oriented API on Notion's own origin; model choice is expressed through Notion aliases and configuration steps; output is delivered as an incremental patch stream and then persisted into Notion records. The automatic and explicit-model probes, static bundle archive, endpoint catalogs, roster, sanitized HARs, and integrity manifest form a useful reproducible baseline. Future captures should extend this baseline by testing additional models and reasoning levels, tool/search/edit modes, failure and cancellation paths, attachments/connectors, plan restrictions, and genuinely fresh lazy-loaded UI states—while continuing to separate raw evidence from privacy-reviewed derivatives.
