# Notionize requirements and coverage audit

_This audit compares the original capture/investigation request with the current archive. It proposes future probes but performs no browser actions._

## Executive assessment

The archive strongly establishes one browser-facing Notion AI transport and several bounded examples across two evidence modes: ordinary HAR exports and an instrumented live Fetch hook. It also contains an integrity-verified snapshot of every JavaScript chunk advertised by the captured runtime, its advertised CSS, and directly referenced public assets.

It does **not** establish exhaustive coverage of Notion's browser code, every Notion AI endpoint, every model/tool/error path, or any server-to-model-provider request. Those goals cannot be proven from a finite browser session. Future work should therefore use explicit coverage metrics and stop conditions rather than the phrase “capture everything.”

Current high-confidence evidence includes:

- Six raw HAR captures and six sanitized counterparts.
- 1,190 HAR entry observations, 418 unique method/endpoint pairs, and 23 observed hosts. These are catalog observations, not necessarily distinct requests, because some exports overlap.
- 13 AI-relevant classified network routes: 6 direct, 2 retrieval-support, and 5 correlated generic routes.
- A verified runtime archive of 2,149 JavaScript chunks (93,843,729 bytes), 35 CSS chunks, and 198 directly referenced public assets. Every manifest mapping rehashes and recounts successfully. The earlier baseline extractor's 225 embedded responses/222 unique bodies remain a separate, narrower HAR-derived set.
- 1,098 literal client API event/method callsite pairs in the runtime chunks: 131 high-signal AI-named pairs, 164 when adjacent or ambiguous AI names are included, and 14 streaming pairs. These are static callsites, not observed requests.
- A 31-alias model roster spanning 7 reported providers; all 31 aliases also occur as exact quoted strings in the runtime archive.
- Seven HAR observations of `runInferenceTranscript`: five successful-stream observations and two application-level quota failures, all with HTTP 200. One success observation duplicates the explicit-medium transaction, leaving six distinct HAR transactions: four successes and two application-level failures. No HTTP error is observed.
- Four targeted request observations in the latest live-hook artifact across two hook sessions: two instrumented successes and two instrumented application-level quota failures. The hook rewrote all four requests, so they are not evidence of untouched request bodies.
- Known overlap: live-hook targets 2–4 align by request-start time with the three live-session HAR entries (within 156 ms), while target 1 is hook-only. The earlier one-target live-hook artifact is the same request as target 1 in the latest four-target artifact. These source counts must not be added together.
- Static browser-code evidence for same-origin JSON request construction, `fetch`, NDJSON decoding, async iteration, callbacks, abort handling, and error handling, plus exact reconstruction of four distinct successful HAR NDJSON streams, including the newer long success.
- Context-management thresholds in all four latest instrumented requests, but zero observed compaction/summary activation markers. The current verdict is **configuration observed; runtime compaction unobserved**.
- A tested offline, buffered text-only Anthropic SSE proof adapter; 24 unit tests pass. Across the six sanitized HARs, five successful observations convert and both quota observations are rejected before SSE rendering while the adapter discloses its lossy semantics.
- Reproducible sanitization, cataloging, static extraction, full-runtime scanning, model extraction, inference summarization, and inventory scripts.

## Requirement-by-requirement status

| Original intent | Status | What is proven | Remaining gap |
|---|---|---|---|
| Create a `Documents/Notionize` archive with a `reference` folder | Proven | The archive and requested hierarchy exist | Final checksum inventory must be regenerated after all writing finishes |
| Archive Notion browser code | Strong, build-bounded | All 2,149 JavaScript chunks advertised by the captured runtime, all 35 advertised CSS chunks, and 198 directly referenced public assets are archived and hash/byte verified; the baseline HAR also preserves 225 embedded responses representing 222 unique bodies | This proves completeness only against one captured runtime manifest, not every bootstrap asset, service-worker-only body, cohort, region, account tier, future build, or server component |
| Measure and continuously improve code capture | Partial | Runtime/CSS/asset manifests, hashes, byte totals, and a deterministic full-runtime scanner provide explicit coverage metrics | No cross-build or cross-cohort saturation loop can prove “all Notion code” |
| Download all network traffic | Partial | Six HAR windows preserve 1,190 observations across 418 unique method/endpoints and 23 hosts | These are bounded exports, not continuous capture; the settled-session export duplicates one historical inference and the live-session HAR overlaps three hook observations |
| Preserve traffic across navigation/page changes | Partial | Durable HARs exist; the latest live hook persisted 584 events across two hook sessions and four targeted requests | This proves persistence only for those hook sessions, not every navigation or every request; target 1 was outside the live-session HAR window |
| Use the live Notion AI | Proven, narrow | Across HAR and hook evidence, five distinct successful turns and two distinct application-level quota failures are structurally evidenced | The latest requests were deliberately rewritten by the hook; many models, modes, tools, and failures remain untested |
| Capture AI request and response bodies | Proven, bounded | The regenerated HAR protocol summary covers seven observations across six distinct transactions and reconstructs four distinct successful streams; the latest schema-only hook derivative covers four requests and their NDJSON outcomes | Reports intentionally omit prompts/output/identifiers; the latest hook also contains one short success outside the HAR capture window |
| Identify AI endpoints | Strong but bounded | Observed traffic catalogs 6 direct, 2 support, and 5 correlated routes; static runtime code adds 1,098 literal API callsite pairs, including 131 high-signal AI names and 14 streaming pairs | Static callsites do not prove invocation or server implementation; observed routes remain bounded to six HAR windows |
| Explain how the browser sends AI requests | Proven for captured build | Static code and HAR agree on same-origin `POST`, JSON body, cookie-backed credentials, Notion scoping headers, and `Accept: application/x-ndjson` | Build-specific minified modules may change; upstream provider request construction is server-side |
| Explain how responses return and update the UI | Proven for captured build | zstd is transparently decoded by Fetch; UTF-8 NDJSON is parsed line-by-line and yielded through an async iterator/callback; captured state uses `patch-start`, `patch`, `record-map`, `patch-sync` | The exact patch reducer/UI dispatch module was not present in recovered chunks |
| Determine model selection/routing | Partial | Historical captures resolve Notion aliases and the roster/runtime expose provider/family labels and model metadata | Client labels and provider lexemes do not reveal the active upstream deployment, provider endpoint, fallback policy, credentials, system prompts, or server-side transformation; zero OpenRouter lexemes in this runtime are only client-side negative evidence |
| Test every AI capability | Incomplete and not exhaustively provable | New-thread/continuation, automatic/explicit model selection, `medium`/`none` reasoning configuration, context auto-load, streaming text, an updated-config request, and application-level quota failure were observed | Search execution, model tool calls, attachments, cancellation, fetch/offline failure, HTTP non-2xx behavior, presentation modes, remaining reasoning modes, and compaction execution remain unobserved |
| Produce technical documentation and a compatibility proof | Substantially proven | Focused protocol/static-code/privacy/coverage analyses, human- and machine-readable compatibility matrices, and a tested buffered text-only SSE adapter exist | The adapter intentionally does not claim provider authenticity, request conversion, native tools/reasoning/compaction, or lossless round trips; historical deep-dive reports remain explicitly bounded to their source captures |

## Proven protocol surface

The captured browser path is:

```text
UI transcript/config builder
  -> runInferenceTranscript wrapper
  -> callStreamApi(format = jsonStream)
  -> POST /api/v3/runInferenceTranscript
  -> same-origin Fetch with JSON body and AbortSignal
  -> application/x-ndjson response
  -> incremental TextDecoder/newline parser
  -> async iterator and onResponse(event)
  -> transcript patch handling and persistence
```

The request includes thread lifecycle flags, config/context/user transcript steps, optional `updated-config`, redacted workspace/thread/trace identifiers, and patch response version 2. The captured response streams use envelope version 1 and the event order:

```text
patch-start -> patch* -> record-map -> patch-sync
```

Observed patch opcode `a` adds/appends state or clears a target when its value member is absent; `x` extends assistant text. All four distinct successful HAR final contents reconstruct exactly from their initial text plus the `x` chunks. Both historical new/full-thread turns contain three applied context auto-load results. No captured transaction contains a model-initiated tool call.

## Capture accounting and overlap

The source counts describe evidence records, not automatically distinct model turns:

| Source | Recorded target observations | Known overlap | Safe interpretation |
|---|---:|---|---|
| Historical HAR captures | 4 | The settled-session entry duplicates the explicit-medium request and decoded stream | 3 distinct historical successful transactions |
| New live-session HAR | 3 | Same requests as latest live-hook targets 2–4; request starts align within 156 ms | 3 HAR observations: one instrumented success and two instrumented application-level quota failures |
| Latest live-hook artifact | 4 | Targets 2–4 overlap the new HAR; target 1 is outside that HAR window | 4 instrumented request observations: 2 successes and 2 quota failures |
| Earlier one-target live-hook artifact | 1 | Its target request is target 1 in the latest artifact | Earlier artifact adds no fifth hook request |

Accordingly, the network catalog's 7 HAR inference observations and the hook's 4 observations are not an 11-request corpus. The regenerated `inference-protocol.json` records five success observations and two application-error observations. After removing the duplicated historical success, those are 6 distinct HAR transactions: 4 successes and 2 failures, with no HTTP errors. After also reconciling the hook overlap, the cross-source corpus contains 7 distinct outcomes: 5 successes and 2 failures. The additional success is latest hook target 1, which is absent from HAR; the earlier one-target hook artifact duplicates that same target.

## Current compaction status

Static runtime chunks contain exact compaction/summary field and marker strings, including context configuration and activation-related names. That is client-awareness evidence only. In live evidence, all four latest instrumented requests carry numeric `compactThreshold`, `createSummaryThreshold`, and `updateSummaryInterval` fields, but the four request/response pairs contain zero exact occurrences of `agent-transcript-summary`, `activate-transcript-compaction`, `summary-inference`, `summarize-transcript`, and `summarize-transcript-error`.

The supported verdict remains **configuration observed; runtime compaction unobserved**. There is no captured activation event, summary inference, summary failure, or paired before/after compacted transcript state. Absence in four requests does not establish that compaction is disabled or unsupported.

## Provider-routing boundary

The runtime catalog contains quoted provider/model lexemes and model-roster metadata, but those strings do not establish the provider selected for any turn. OpenRouter has zero quoted-lexeme occurrences across the 2,149 archived runtime chunks; that is negative evidence for this client archive only. The 23-host network catalog contains no observed direct model-provider API request, but browser evidence cannot exclude Notion's private server-side routing, alias resolution, fallback, or provider changes. No provider credential or upstream request is established client-side.

## Untested but safely testable areas

The following gaps can be tested through ordinary UI behavior using synthetic, non-sensitive data:

- Remaining `low`, `high`, `xhigh`, and `max` reasoning modes for one already-observed selectable model; `none` and `medium` are already captured.
- One actual web-search turn with public, non-personal subject matter.
- One read-only Notion lookup against a synthetic test page.
- One small synthetic text attachment.
- One user cancellation and one local-offline failure.
- Floating and full-screen AI presentation modes without sending prompts.
- UI-to-codepath mapping for model, search, attachment, and presentation controls. The captured runtime's advertised chunks are already archived; a passive probe could still reveal execution paths or assets outside that manifest.

## Not safely testable without broader authorization

- Deliberately exhausting credits or provoking server rate limits.
- Bypassing disabled models, plan gates, geographic restrictions, or feature flags.
- Replaying raw authenticated requests, cookies, or recorded identifiers outside the normal UI.
- Fuzzing undocumented endpoints, altering authorization/scoping headers, or sending malformed bulk traffic.
- Connecting external calendar/mail/Slack/Drive accounts or reading unrelated workspace content.
- Asking the agent to edit/delete production pages, databases, mail, calendar, or third-party data.

These should remain excluded unless separately authorized with an explicit account, data set, and impact boundary.

## Fundamentally opaque from browser evidence

A browser archive cannot prove:

- Complete Notion server source or internal service topology.
- The exact provider-side endpoint, credentials, request body, system prompt, or raw provider response.
- A permanent one-to-one mapping between a Notion alias and an upstream model deployment.
- Every endpoint/code chunk across all account tiers, regions, devices, experiments, and future builds.
- A universal negative such as “the browser never contacts another host”; it can only describe the capture windows.
- Exhaustive AI behavior from finite prompts.

## Prioritized low-risk live probe matrix

All proposed probes use normal UI actions only. Each model-producing probe should use a disposable test page/thread, a short deterministic prompt containing no personal or workspace data, one attempt per variant, and an owner-only raw HAR followed immediately by sanitization.

| Priority | Probe | Gap addressed | Exact evidence to capture | Success criterion | Probe-specific stop condition |
|---|---|---|---|---|---|
| P0 | **Capture-control baseline**: one short automatic reply in a new disposable thread | Establishes a contemporaneous control and verifies the capture pipeline before variants | Raw/sanitized HAR pair; selector/config state; `runInferenceTranscript` request schema digest; NDJSON line/event/op/path counts; final model/token/timing fields; unique endpoint and asset deltas | Safe summary matches between raw and sanitized files and reconstructs final stream | Stop immediately if sanitization/validation fails, Preserve Log is not active, or the prompt/page contains real data |
| P0 | **Passive presentation modes**: open Sidebar, Floating, and Full Screen without sending a prompt | Only Sidebar is currently evidenced as active | Redacted screenshot per mode; network entries caused by each transition; new JS/CSS/HTML URLs and SHA-256s; no inference request expected | Each mode is visually confirmed and any mode-specific assets/endpoints are cataloged | Stop if switching mode would navigate away with unsaved work, reveal private content, or generate an AI turn |
| P0 | **Lazy-control loading**: open model picker, reasoning menu, search control, attachment menu, and layout menu without selecting external connectors | Full runtime archive is not mapped to control execution and may omit assets outside its captured manifest | Per-control time window; asset URL/status/MIME; decoded SHA-256; first-seen control-to-asset mapping; new AI symbols/routes; service-worker/cache source metadata | A deterministic control-to-codepath mapping or asset delta is recorded, or two repeated opens add nothing | Stop after two opens of the same control yield zero new unique assets/routes; never authenticate a connector |
| P1 | **Remaining reasoning variants** on `orange-mousse`: one turn each for `low`, `high`, `xhigh`, and `max`; `none` and `medium` are already captured | Four advertised reasoning modes remain untested | For each turn: UI label, submitted `reasoningEffort`, alias, final model/failover field, token/cache/server timing, NDJSON event/op/path sets, terminal telemetry | Requested effort appears in the request and the turn completes normally on the same alias | Stop on first usage/credit warning, disabled option, upgrade prompt, model change, unexpected write/tool action, or after one turn per available mode |
| P1 | **Actual web search** using one public, time-stable query | `useWebSearch: true` is only a config flag; no search execution is proven | Search/tool step types and function names; search-specific endpoints; request schema changes; citation/result object schema with text/URLs redacted; stream ordering around tool start/result/inference | At least one explicit search/tool event and one citation/result structure are captured | Stop if login, CAPTCHA, paywall, connector authorization, private query expansion, or more than one search round is requested |
| P1 | **Controlled Notion read tool** against a synthetic page containing a unique harmless marker | No model-initiated Notion read/search is captured | Synthetic page hash/marker kept outside report; tool name/type/function; input schema with IDs redacted; tool state/duration; record-map table counts; final stream step order | A read-only model tool event references only the synthetic page and returns normally | Stop if the UI proposes edits, searches outside the test page, exposes unrelated records, or requires expanded workspace permission |
| P1 | **Synthetic text attachment**: one small `.txt` file with generated non-sensitive content | Attachment/upload/request schema is unknown | Local SHA-256 and byte size; upload endpoints/method/status/MIME; attachment metadata field names/types with identifiers redacted; inference request reference shape; attachment-related tool/event types | File reference is present in the inference request and reply completes without other data access | Stop if the picker exposes private recent files, upload targets an unexpected host, file conversion expands scope, or any real file is selected |
| P1 | **User cancellation**: start one harmless response and cancel once after streaming begins | Abort and partial-stream behavior are only statically known | Whether request is cancelled/status 0; NDJSON prefix and last event; presence/absence of `record-map` and `patch-sync`; UI error/cancel state; terminal telemetry reason; persisted thread state after reload | Cancellation is reflected consistently in network, telemetry, and UI without retry | Stop after the first cancel; do not repeat if the request remains open for 10 seconds, auto-retries, or leaves ambiguous persistence |
| P2 | **Local-offline failure**: enable browser offline mode, submit one harmless short prompt, then restore connectivity without automatic resubmission | Non-HTTP Fetch failure UI path is unobserved | Failed request/status; offline/error classification; emitted telemetry; UI message; whether any transcript state is persisted; proof that no server body arrived | One bounded offline failure matches the static error path and no request is replayed | Stop after one failure; restore connectivity, discard draft, and do not press retry |
| P2 | **Passive eligibility/rate-limit observation** | One eligibility entry has HAR status 0; rate-limit behavior is otherwise untested | Normal UI-triggered `getAIUsageEligibilityV2` and `getCreditRateLimitStatus` status/MIME/schema; disabled reason codes; visible usage notice, redacted | A successful ordinary eligibility/status response is captured without consuming credits to force a boundary | Never attempt to exhaust credits, loop requests, bypass a disabled model, or trigger an upgrade/charge flow |

## Evidence package required for every future probe

Each probe should produce a small, self-contained evidence package:

1. **Probe manifest**: probe name, local timestamp, browser/build identifier, UI mode, selected model/reasoning, and a statement that only synthetic data was used.
2. **Owner-only raw evidence**: raw HAR and any screenshot saved with mode `0600`.
3. **Sanitized evidence**: sanitized HAR plus validation output showing zero HAR cookie objects, zero sensitive header names, and no bearer/JWT/Notion-token pattern.
4. **Privacy-safe protocol summary**: request field paths/types, transcript step types, response event order/counts, patch op/path counts, model/token/timing metadata, record-map table counts, and terminal state—never prompt/output/IDs.
5. **Asset delta**: new URL path, MIME, decoded SHA-256, byte size, initiating UI control, and whether response came from network/service worker/cache.
6. **Endpoint delta**: new host/method/path/status/MIME/query-name tuple and its direct/support/correlated/none classification.
7. **Comparison result**: exact fields added/removed/changed relative to the control, including whether a difference is UI-only, request-only, stream-only, or telemetry-only.

## Coverage metrics and saturation rule

Track these cumulative sets after each probe:

- Unique `(host, method, path)` tuples.
- Unique decoded browser-asset SHA-256s.
- Unique literal `/api/v3` strings and AI symbols in newly loaded assets.
- Unique inference request leaf `(path, type)` pairs.
- Unique transcript step types.
- Unique NDJSON event types, patch opcodes, and normalized patch paths.
- Unique tool `(toolType, function, state)` tuples.
- Unique `(model alias, reasoning effort, presentation mode)` tuples.
- Unique terminal reasons and HTTP/error classifications.

A probe family reaches practical saturation when **two consecutive bounded probes add no new high-signal endpoint, request-schema, stream-event, tool, or asset element**. UI-only cache repeats do not justify further turns.

## Global stop conditions

Stop the live session immediately if any of the following occurs:

- A prompt, response, screenshot, or attachment contains real personal, workspace, customer, or credential data.
- An authentication, payment, upgrade, connector-consent, admin, or permission-expansion dialog appears.
- The agent proposes or begins an edit, deletion, email, calendar action, external message, or other write outside the disposable test page.
- A new external host appears that is not clearly a static asset/search-result host; capture the hostname only and stop before interacting.
- A usage/credit/rate-limit warning appears during model-producing probes.
- Sanitization or raw-versus-sanitized safe-summary validation fails.
- A request auto-retries, loops, fans out unexpectedly, or remains active more than 60 seconds.
- More than one model request is needed for a single planned variant.
- Ten new model-producing turns have been made in the session.
- Two consecutive probes in the same family add no new high-signal evidence.

Do not replay raw requests, copy cookies, invoke undocumented endpoints manually, or modify authorization/workspace headers. Preserve normal UI semantics and the user's existing account boundary.

## Prioritized next steps

1. Keep the archive inventory and SHA-256 manifest as the last generated artifacts. They were refreshed after this report; any future edit requires another rebuild.
2. Run passive presentation/lazy-control probes first because they cost no model turns and can map archived chunks to UI behavior or reveal assets outside the captured manifest.
3. Establish one fresh **unmodified** automatic control and validate raw/sanitized parity; do not use the rewritten hook requests as the control.
4. Run the remaining `low`, `high`, `xhigh`, and `max` reasoning modes with the strict one-turn and usage-warning stops.
5. Run one public web-search, one synthetic Notion-read, and one synthetic attachment probe.
6. Run cancellation and local-offline probes last; do not provoke a real rate limit.
7. Treat the consolidated report, this coverage audit, `network-summary.json`, the regenerated `inference-protocol.json`, `full-runtime-static-audit.md`, and `final-validation.md` as the current sources. `central-report-draft.md` and `har-semantics.md` remain explicitly labeled historical deep dives.

## Evidence paths

- `reference/analysis/central-report-draft.md`
- `reference/analysis/full-runtime-static-audit.{json,md}`
- `reference/analysis/full-runtime-{ai-api-events,model-evidence,provider-evidence}.csv`
- `reference/analysis/network-summary.json`
- `reference/analysis/har-semantics.md`
- `reference/analysis/inference-protocol-findings.md`
- `reference/analysis/inference-protocol.json`
- `reference/analysis/browser-transport-static-analysis.md`
- `reference/analysis/stream-field-compatibility.{json,md}`
- `reference/analysis/anthropic-sse-compatibility.md`
- `reference/analysis/ai-endpoints.json`
- `reference/analysis/network-endpoints.json`
- `reference/analysis/model-roster.json`
- `reference/analysis/static-assets-findings.md`
- `reference/analysis/live-capture-state-coverage.md`
- `reference/analysis/live-capture-compaction-findings.md`
- `reference/analysis/live-capture-latest-privacy-scan.json`
- `reference/analysis/redaction-report.md`
- `reference/analysis/final-validation.md`
- `reference/assets/browser-code/`
- `reference/har/`
- `reference/scripts/`
- `reference/tools/notion-anthropic-sse/`

## Bottom line

The archive has achieved a strong, reproducible explanation of the captured browser-side AI flow and complete integrity coverage for the chunks advertised by one captured runtime, but not exhaustive product coverage. Live evidence now includes success and application-level quota outcomes; compaction execution, direct provider routing, cancellation, transport failure, and many tool paths remain unobserved. Any next work should remain a bounded matrix of ordinary UI probes using synthetic data, measurable deltas, and hard privacy/usage stops.
