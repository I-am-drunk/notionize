# Notionize: Notion browser code, network, and AI endpoint archive

**Capture window:** 2026-08-26 through 2026-08-27 (America/Toronto)  
**Archive root:** `/Users/irene/Documents/Notionize/reference`  
**Scope:** authorized observation of the archive owner's signed-in Twilight/Notion session plus public browser assets advertised by the captured Notion runtime

## Executive result

The requested archive exists in `Documents/Notionize`. It preserves six raw HAR exports and six sanitized counterparts, three owner-only live-hook snapshots and two schema-only derivatives, a manifest-complete snapshot of the captured browser runtime, endpoint/model catalogs, protocol reconstruction, an Anthropic-SSE projection proof, privacy checks, and reproducible integrity data.

The central browser chat route is:

```http
POST /api/v3/runInferenceTranscript
Content-Type: application/json
Accept: application/x-ndjson
```

The response is **Notion NDJSON, not Anthropic SSE and not OpenAI SSE**. Successful captured turns follow this state-oriented lifecycle:

```text
patch-start -> patch* -> record-map -> patch-sync
```

Two quota failures also returned HTTP 200 and NDJSON, but followed:

```text
patch-start -> record-map
```

Those failure streams contain `premium-feature-unavailable`, no model inference, no per-inference usage, and no terminal `patch-sync`. A downstream bridge must emit an error; treating either stream as a successful empty answer would be wrong.

The browser chat traffic crosses a same-origin Notion boundary. The capture does not expose Notion's private server-to-provider request, provider key, system prompt, or routing decision. No captured browser request went to OpenRouter, and the full runtime scan found zero quoted `OpenRouter` lexemes. That is bounded negative client evidence, not proof that a private backend can never use a gateway.

The compatibility answer is similarly bounded:

- Successful text can be projected into an Anthropic Messages SDK 0.121.0-shaped SSE event sequence.
- Final Notion-reported input/output/cache integers can be carried in terminal usage fields.
- The source model identity, stop reason, Anthropic billing semantics, thinking signatures, native tool lifecycle, complete prior history, and compaction state are not all present.
- `end_turn`, a provider-authentic model ID, and any Anthropic compaction block would therefore be synthetic unless supplied by a separate target backend.
- A response-only proxy cannot transparently implement agent continuation or compaction. A stateful gateway can do so only by owning a canonical history and introducing its own explicit policy.

The compaction experiment did not fail because “Notion has no compaction.” Static code proves a Notion-specific summary/compaction surface, and live requests carried aggressively lowered thresholds. No summary/compaction marker appeared. The long turn became prior history only on the following calls, and both were rejected by the account-wide quota before inference. The correct finding is **not observed / insufficient capture**.

A later pass recovered the full mechanism statically and explains the non-observation. Notion ships a three-stage **progressive transcript compression** ladder (create summary → rolling update → compact) resolved from `contextManagementConfiguration` → Statsig `ai_agent_progressive_transcript_compression_threshold` → hardcoded defaults, over a 272,000-token window. The default `compactThreshold` is **1.0** (compact only at the ceiling) and `createSummaryThreshold` defaults to `compactThreshold − 0.1`, so with no override the ladder never fires in a normal session — and the forced-low probes hit quota before inference. A working configuration and validation plan are in `reference/analysis/compaction-design.md`.

This archive now also includes a **decompile of the Notion macOS desktop app (v7.31.3, Electron 42.4.1)**. The desktop main process contains no inference code, but it ships two OS-level AI surfaces the browser cannot: a **local coding-agent skill installer** (IPC that writes `SKILL.md` into `~/.claude/skills`, `~/.codex/skills`, `~/.cursor/skills`, `~/.gemini/skills`, `~/.grok/skills`, behind a consent dialog and filesystem safety rails) and a **system-audio meeting-notes/transcription** pipeline. Details are in `reference/analysis/desktop-decompile-findings.md`. Web research (`reference/analysis/notion-ai-integration-research.md`) confirms these map to shipping features — Notion's hosted MCP server (`https://mcp.notion.com/mcp`), the Claude Code plugin's "Skills," and the Custom/External Agents APIs — and that **no public endpoint exposes Notion's AI models**; usage is metered server-side as workspace credits regardless of client feature/thread labels.

## Measured coverage

| Evidence area | Verified result |
|---|---:|
| Raw HAR exports / sanitized counterparts | 6 / 6 |
| HAR network observations | 1,190 |
| Unique method + normalized-endpoint pairs | 418 |
| Observed hosts | 23 |
| HAR `runInferenceTranscript` observations | 7 |
| Live-hook targeted request observations | 4 |
| Distinct transactions across overlapping sources | 7: 5 successes, 2 quota failures |
| Advertised runtime JavaScript archived | 2,149 / 2,149 files; 93,843,729 bytes |
| Advertised runtime CSS archived | 35 / 35 files; 386,883 bytes |
| Directly referenced public assets archived | 198 / 198 files; 26,277,470 bytes |
| Literal client API event/method callsite pairs | 1,098 |
| High-signal AI-named callsite pairs | 131 |
| Broader AI-adjacent callsite pairs | 164 |
| Streaming callsite pairs | 14 total; 9 AI-named or adjacent |
| Model aliases in captured roster | 31 across 7 reported providers |
| Roster aliases found as exact runtime strings | 31 / 31 |
| Anthropic projection tests | 24 / 24 pass |
| Final checksum inventory | 2,688 files; 321,124,439 bytes |

These figures are exact for the archived evidence. “2,149 / 2,149” means complete against one captured runtime manifest. It does not prove coverage of every Notion build, cohort, region, experiment, account tier, service-worker-only body, future asset, or server component.

## 1. Evidence layers and method

The archive deliberately separates four kinds of evidence:

1. **Observed HAR traffic.** Six bounded network windows preserve request/response evidence and produce a privacy-safe endpoint catalog.
2. **Persistent live Fetch-hook evidence.** Four targeted requests across two hook sessions preserve chunk boundaries and request/response structure across page state changes. The hook rewrote the targets to request full steps, debug errors, and forced context-management settings; those requests are instrumented rather than untouched controls.
3. **Archived browser code.** The first HAR supplied a 222-body seed corpus. Runtime discovery then expanded coverage to every JavaScript and CSS chunk advertised by the captured runtime and 198 directly referenced public assets.
4. **Derived, privacy-safe analysis.** Scripts retain field names, structural enums, counts, hashes, lengths, usage metrics, normalized paths, and validation results without reproducing prompts, response prose, headers, cookies, or private identifiers in reports.

No authentication bypass, endpoint fuzzing, destructive testing, other-user access, or replay of captured private requests was performed.

### HAR inventory

| Raw capture | Entries | Raw bytes | Inference role |
|---|---:|---:|---|
| `baseline-full.har` | 317 | 39,174,568 | Baseline application traffic; no inference entry |
| `ai-probe-auto.har` | 37 | 950,976 | Automatic-model success |
| `ai-probe-gpt56-sol-medium.har` | 31 | 580,881 | Explicit-model continuation success |
| `ai-session-settled-full.har` | 239 | 7,922,115 | Repeats the preceding continuation transaction byte-for-byte |
| `ai-probe-gpt56-sol-no-thinking.har` | 44 | 952,266 | Explicit-model fresh-thread success |
| `notion-live-session-2026-08-27.har` | 522 | 41,109,507 | Long-history success plus two quota failures |

Firefox/Twilight's network UI displayed 529 requests when the newest session was saved; the exported HAR contains 522 entries. The catalog reports what is actually present in the file, not the transient UI counter.

### Observation versus transaction accounting

Counting files or hooks as independent model runs would overstate coverage:

| Source | Artifact-level observations | Deduplication/overlap | Distinct contribution |
|---|---:|---|---:|
| First five HARs | 4 inference entries | Settled-session entry duplicates the explicit-medium entry | 3 successful turns |
| New live-session HAR | 3 inference entries | Same requests as hook targets 2–4 | 1 success, 2 failures |
| Latest hook artifact | 4 targets | Targets 2–4 overlap the new HAR | Adds one hook-only short success |
| Earlier one-target hook artifact | 1 target | Same request as latest hook target 1 | Adds nothing |

Therefore the combined evidence contains eleven artifact observations but only seven distinct transactions: five successes and two quota failures.

## 2. Browser-facing endpoint map

The HAR catalog contains 418 normalized method/endpoint pairs. Thirteen routes were classified as directly AI-specific, retrieval support, or temporally correlated with AI flows.

### Direct AI routes

| Normalized endpoint | HAR observations | Observed role |
|---|---:|---|
| `/api/v3/runInferenceTranscript` | 7 | Submit transcript/config state and receive NDJSON patches |
| `/api/v3/getAvailableModels` | 9 | Model aliases, display metadata, restrictions, and reasoning options |
| `/api/v3/getAIUsageEligibilityV2` | 5 | Eligibility, limit, and credit dependencies |
| `/api/v3/getCreditRateLimitStatus` | 4 | Credit/rate-limit state |
| `/api/v3/getInferenceTranscriptsUnreadCount` | 19 | AI-thread unread state |
| `/api/v3/markInferenceTranscriptSeen` | 9 | Mark an AI thread seen |

Some catalog entries have status 0 because an exporter observed an incomplete/in-flight request. This is not an HTTP status and is not interpreted as a server outcome.

### Retrieval support and correlated generic routes

| Normalized endpoint | Observations | Evidence-bounded interpretation |
|---|---:|---|
| `/api/v3/warmSearchCache` | 3 | Search-cache warmup |
| `/api/v3/warmVectorDBCache` | 3 | Vector-retrieval cache warmup |
| `/api/v3/etClient` | 43 | Generic lifecycle/product/performance telemetry |
| `/api/v3/syncRecordValuesSpaceInitial` | 64 | Generic initial record hydration |
| `/api/v3/syncRecordValuesMain` | 2 | Additional record hydration |
| `/api/v3/saveTransactionsFanout` | 7 | Generic persistence |
| `/api/v3/getAssetsJsonV2` | 62 | Client asset/build metadata |

Correlation does not make a generic route AI-exclusive. The full normalized catalog retains capture counts, statuses, MIME types, timing aggregates, query-parameter names, and body-size totals without header/query values.

## 3. Static API surface from the full runtime

The static scanner recognizes literal `eventName` values at Notion client API wrappers and pairs each with the wrapper method. It found:

- 1,098 literal event/method callsite pairs;
- 131 high-signal AI-named pairs;
- 164 pairs when ambiguous AI-adjacent names are included;
- 14 streaming pairs, 9 of which are AI-named or adjacent; and
- 8 literal query-free `/api/v3` pathnames.

Examples of shipped streaming callsites include `runInferenceTranscript`, `aiSearchAnswerPreview`, `generateAiBlock`, `runMeetingNotesAgent`, `streamExportInferenceTranscriptsForWorkflow`, meeting-summary generators, and transcript listeners. Non-streaming candidates cover model discovery, connectors, agent threads, uploads, policies, transcript lifecycle, feedback, meetings, and administrative/debug surfaces.

These are **callsites, not observed requests**. A shipped event name does not establish that the route exists for this account, was invoked, succeeded, or has the guessed server behavior. The complete evidence is in `full-runtime-ai-api-events.csv`; this report does not inflate the seven observed inference requests into 1,098 network events.

## 4. `runInferenceTranscript` request contract

Observed requests use a JSON envelope with no required model-vendor API key in the browser. The earlier unmodified captures use same-origin session credentials and Notion user/workspace scoping. A privacy-safe structural summary is:

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
  debugOverrides: object,
  spaceId: <private>,
  threadId: <private>,
  traceId: <private>,
  threadParentPointer?: <private record pointer>,
  transcript: [
    {type: "config", value: <capabilities/model policy>},
    {type: "context", value: <surface/time/private context>},
    {type: "updated-config", value: <model/effort override>}?,
    {type: "user", value: <private content>}
  ]
}
```

The focused captures show both full new-thread transcripts and partial continuation transcripts. The partial continuation identifies server-managed state with a thread ID while omitting much of the canonical prior history. That is convenient for Notion's own server, but insufficient for a stateless third-party agent adapter that must independently reproduce the complete conversation.

The latest hook inserted an explicit `contextManagementConfiguration` into all four targets. Forced values were:

| Field | Instrumented value |
|---|---:|
| `createSummaryThreshold` | 0.01 |
| `updateSummaryInterval` | 0.005 |
| `compactThreshold` | 0.02 |
| `recentSearchToolResultsToKeep` | -1 |

These values prove only what the hook submitted. They do not prove the server accepted, honored, or crossed each threshold.

## 5. NDJSON response and patch reconstruction

Successful response envelopes are:

```text
patch-start { data: { s: [...] }, version: 1 }
patch       { v: [{ o, p, v? }, ...] }
record-map  { recordMap: {...} }
patch-sync  { data: { s: [...] }, version: 1 }
```

The request's `patchResponseVersion: 2` and envelope `version: 1` are distinct observed fields.

Patch behavior recovered from five successful HAR observations:

- opcode `a` assigns/appends a value; when its value member is absent it clears the target in the compact replay model;
- opcode `x` extends an existing string at the path;
- text begins in an `agent-inference` record and grows through ordered string extensions;
- `record-map` carries persisted Notion records; and
- `patch-sync.data.s` is the authoritative terminal state for a success.

The extractor replays every successful stream and verifies exact equality with `patch-sync`. It deliberately does not attempt reconstruction for either quota stream because neither has terminal sync state.

The browser transport code independently matches the traffic:

```text
UI transcript/config builder
  -> runInferenceTranscript wrapper
  -> callStreamApi(format = jsonStream)
  -> same-origin JSON POST
  -> Fetch response body
  -> incremental UTF-8 newline decoder
  -> JSON object async iterator
  -> onResponse(event) updates UI/state
  -> terminal event array/error handling
```

The browser transparently decompresses the zstd-encoded wire response before JavaScript sees the cloned/readable body. The hook therefore captured decoded NDJSON chunks, not raw zstd bytes.

## 6. Successful and failure states

### Successful HAR-backed turns

| Distinct turn | Final Notion alias | Input | Output | Cache read | Cache created | Max context | Max input |
|---|---|---:|---:|---:|---:|---:|---:|
| Automatic selection | `oatmeal-cookie` | 22,560 | 8 | 20,864 | 0 | 400,000 | 272,000 |
| Explicit continuation | `orange-mousse` | 4,862 | 8 | 4,859 | 16,967 | 400,000 | 272,000 |
| Explicit fresh thread, no thinking | `orange-mousse` | 3 | 9 | 0 | 20,567 | 400,000 | 272,000 |
| Latest long-history success | retained in private evidence | 34,685 | 7 | 29,580 | 28,949 | 200,000 | 160,000 |

The settled-session HAR repeats the explicit continuation and is not a fifth HAR-backed success. The live hook adds one distinct short success that is absent from all HARs:

| Hook-only turn | Input | Output | Cache read | Cache created | Max context | Max input |
|---|---:|---:|---:|---:|---:|---:|
| Short control | 29,911 | 18 | 29,580 | 12,484 | 200,000 | 160,000 |

The latest long synthetic user string was 34,045 characters; the archive reports only the length, not its content.

These counters arrive together in terminal inference metadata. They do not appear on every text delta, request, prior message, retrieved document, tool result, or sampling iteration. The extreme combinations—such as three visible input tokens beside 20,567 cache-created tokens—show that server-managed context/cache behavior is involved. They do not establish Anthropic tokenizer or billing semantics.

### HTTP-200 application failures

Both quota attempts:

- used the same NDJSON MIME type as successful calls;
- returned HTTP 200;
- contained the exact step type `premium-feature-unavailable`;
- included feature-availability metadata;
- returned no `agent-inference` call;
- returned no per-inference token/usage object; and
- stopped after `record-map` without `patch-sync`.

The second failure included an `updated-config` transcript step, so the error classification is not dependent on the absence of a user model update. The capture does not establish an Anthropic-native error type, retryability rule, or HTTP mapping. The safe adapter behavior is to fail closed before emitting a success stream.

## 7. Summary and compaction investigation

### Static evidence

The full runtime contains a Notion-specific transcript-management surface, including exact values or fields such as:

- `agent-transcript-summary`;
- `activate-transcript-compaction`;
- `summarize-transcript`;
- `summarize-transcript-record-map`;
- `summarize-transcript-error`;
- `summary`, `lastStepId`, `summaryStepId`, and `activationMode`;
- `transcriptTokenCount` and `transcriptContextUsage`; and
- `createSummaryThreshold`, `updateSummaryInterval`, and `compactThreshold`.

There is no proven literal wire type named `summary-inference`. A debug interface labels qualifying summary-related calls “Summary inference”; that display label must not be promoted into a protocol discriminator.

### Live threshold experiment

The latest hook captured four instrumented requests with the low thresholds listed earlier. Across all four requests and decoded responses, exact occurrence counts were zero for the summary/activation markers tested by the sanitizer/auditor.

That result is not a successful negative proof of compaction. The sequence matters:

1. A long turn succeeded and returned 34,685 input tokens.
2. Only the next request could treat that completed turn as prior history.
3. Both subsequent requests were rejected by quota before any model inference.
4. Consequently no successful post-history turn exists in which summary creation or compaction activation could be observed.

The supported verdict is:

> Context-management configuration and static reducer/schema evidence are present; runtime summarization/compaction is not observed, and the available capture is insufficient to determine trigger behavior, summary content, state replacement, resume behavior, failure behavior, or provider relationship.

### Resolved root cause and working configuration

A later static pass recovered the complete resolver and reducer, which explains the non-observation without weakening the verdict. From chunk `38161`, thresholds resolve as client `contextManagementConfiguration` → Statsig `ai_agent_progressive_transcript_compression_threshold` → defaults, with `compactThreshold` defaulting to **1.0**, `createSummaryThreshold` to `compactThreshold − 0.1`, and `updateSummaryInterval` to `0.1`, over a `maxInputTokens ?? maxContextTokens ?? 272000`-token window. From chunk `92549`, an `agent-transcript-summary` step keyed by `lastStepId` is **replaced in place** on update (unless a non-empty summary would be clobbered by an empty one) and otherwise appended; `activate-transcript-compaction` "applies the latest transcript summary to reduce context size" (i18n, chunk `26775`).

So the default only fires at ~100% of a 272k window, which no ordinary session reaches; the forced-low probes then failed at quota before inference. The full mechanism, a recommended `{ createSummaryThreshold: 0.5, updateSummaryInterval: 0.1, compactThreshold: 0.8, maxToolResultTokens: 50000, recentSearchToolResultsToKeep: 5 }` ladder, an external-consumer handling design, and a capture plan to move this to "observed" are in `reference/analysis/compaction-design.md`.

### Why token totals alone do not provide transparent compaction

Output format conversion and input-history compaction are different operations. Anthropic's compaction contract needs target-side request controls and returns compaction-specific block/delta/state and iteration accounting. A terminal Notion input total cannot identify which prior messages were included, which prefix was summarized, what summary was created, what opaque state must be preserved, or how a resumed request should be assembled.

A reliable gateway can compact only if it owns a canonical ledger from the first turn, tokenizes or estimates for the target model, preserves unresolved tool pairs and required instructions, summarizes a closed prefix with provenance, and treats that summary as new gateway behavior. It cannot truthfully claim the summary was recovered from these Notion responses.

## 8. Anthropic SSE compatibility

### Direct verdict

Notion does not stream Anthropic SSE. A converter must synthesize this event family:

```text
message_start
content_block_start
content_block_delta*  (text_delta)
content_block_stop
message_delta
message_stop
```

| Downstream field/behavior | Source evidence | Fidelity |
|---|---|---|
| Visible text and order | Initial inference text plus ordered `x` extensions | Directly reconstructible |
| Terminal input/output integers | `inputTokens`, `outputTokens` | Numerically mappable; semantics remain Notion-defined |
| Terminal cache integers | `cachedTokensRead`, `cachedTokensCreated` | Numerically mappable; Anthropic cache/billing equivalence unproven |
| Accurate first-frame usage | Usage arrives only at terminal patch | Requires buffering; otherwise initial values are placeholders |
| Model in `message_start` | Final Notion alias arrives late | Requires buffering for source accuracy; alias is not provider-authentic |
| Assistant role/block framing | Implied by successful text response | Synthesized protocol structure |
| Stop reason | No source stop cause | Synthetic; current proof labels `end_turn` as gateway policy |
| Thinking/signature/redacted state | Request effort exists; response state not observed | Unsupported |
| Native tool use/result lifecycle | Not observed after inference | Unsupported |
| Full continuation history | Partial request omits canonical history | Insufficient for stateless continuation |
| Summary/compaction state | Static surface only; no live transition | Unsupported from captures |
| Quota failure mapping | HTTP-200 application state is observable | Must become downstream error; exact Anthropic taxonomy is adapter policy |

Per-delta token counts are not required for ordinary Anthropic text streaming. In SDK 0.121.0, non-null terminal usage fields can correct the accumulated final message's input/cache/output integers. That makes a live text projection structurally viable, but does not repair inaccurate already-delivered `message_start` metadata or prove provider accounting equivalence.

### Executable proof

`reference/tools/notion-anthropic-sse/` is an offline, fail-closed proof. It:

- parses and replays observed `a`/`x` patches;
- requires exact terminal `patch-sync` equality;
- buffers one supported text inference;
- emits SDK-0.121.0-shaped SSE objects;
- repeats cumulative Notion usage in terminal correction fields;
- identifies synthesized values and fidelity limits; and
- rejects summary/compaction states, quota/error states, post-inference tool results, and moved/replaced inference state.

Validation result: 24/24 tests pass. A metadata-only replay across all six sanitized HARs found seven inference entries, converted five successful observations, and rejected both quota entries before rendering any SSE. The five conversions represent four distinct HAR successes because one older success is duplicated. The hook-only short success has no HAR body to replay.

This proof validates a narrow response projection. It is not an authenticated Notion client, an Anthropic backend, a provider-identity proof, or a complete agent loop.

## 9. Server routing and OpenRouter

### What is proven for captured chat inference

For all seven HAR-backed chat calls, the browser sends the transcript to Notion and receives Notion's NDJSON state stream. No captured chat request sends its prompt directly to a model-vendor host. Browser-visible authentication is Notion session/workspace state, not a model-vendor bearer key.

### What remains opaque

The browser cannot see the private hop after Notion receives the request. Therefore the archive cannot determine whether Notion uses a direct vendor API, its own model serving, Bedrock, Vertex, Baseten, Fireworks, another gateway, or a mixture for a particular turn. Model/provider names and routing-like codenames in shipped JavaScript are hypotheses, not transaction attribution.

### OpenRouter finding

- Quoted `OpenRouter` occurrences in all 2,149 runtime JavaScript chunks: **0**.
- Captured OpenRouter browser hosts: **0**.
- Captured OpenRouter browser credentials: **0**.

This is meaningful client-side negative evidence. It is not evidence about unshipped server source or private egress.

### Important scope exceptions

It would be too broad to claim “every Notion AI feature always proxies through the same server path.” Static code for a separate meeting-transcription/audio surface advertises direct xAI and Fireworks WebSocket configuration. Organization settings also contain fields and client API operations for storing an AI-provider API key and an OpenAI-compatible base URL. Neither static feature proves that it was active in this account or used by the captured chat turns, but both disprove a universal inference from one chat route to every product surface.

## 10. Agent-CLI viability

An experimental local adapter can understand the browser-facing protocol:

```text
agent client
  -> Notion-specific authenticated transport
  -> runInferenceTranscript
  -> NDJSON decoder
  -> patch reducer and terminal verifier
  -> lossy Anthropic/OpenAI-shaped response projection
```

It is not a durable drop-in backend. A live client would have to handle session-bound cookie authentication, user/workspace scoping, private thread IDs, request config/context construction, thread lifecycle, record persistence, quota states, schema drift, and product policy. Copying browser cookies into a CLI would create a serious credential risk.

Three viable levels should not be confused:

1. **Text response bridge:** technically demonstrated for the captured success subset.
2. **Stateful terminating gateway:** possible if it owns history, IDs, tools, errors, token policy, and any new compaction behavior from turn one.
3. **Transparent provider-compatible proxy:** not supported by this evidence because source identity, stop semantics, complete history, tools, opaque reasoning/compaction state, and error taxonomy are incomplete.

For a durable system, use an official inference API and the official Notion API for authorized content access. Treat the internal browser route only as local, account-owner research subject to applicable terms and conservative secret handling.

## 11. Model roster

The captured model-picker response contains 31 aliases across seven reported providers, with 30 enabled and one disabled in that snapshot. All 31 alias strings occur in the full runtime archive.

| Reported provider | Alias count |
|---|---:|
| Anthropic | 8 |
| DeepSeek | 2 |
| Gemini | 5 |
| GLM | 1 |
| Kimi | 3 |
| OpenAI | 8 |
| xAI | 4 |

The roster preserves alias, display label, provider/family, fast/intelligent grouping, reasoning options/default, availability state, model-card metrics, and workflow/custom-agent/service mappings. A Notion alias is a client-facing selector, not proof of a permanent upstream deployment.

## 12. Browser-code archive

### Seed HAR recovery

The baseline extractor selected 225 embedded JS/CSS/HTML responses and deduplicated them to 222 unique bodies totaling 16,743,777 bytes. That seed includes 219 unique JavaScript bodies, two CSS bodies, and one signed-in HTML document.

### Manifest-complete captured runtime

| Asset set | Advertised/discovered | Archived | Bytes | Verification |
|---|---:|---:|---:|---|
| Runtime JavaScript chunks | 2,149 | 2,149 | 93,843,729 | Hash and byte count pass |
| Runtime CSS chunks | 35 | 35 | 386,883 | Hash and byte count pass |
| Directly referenced public assets | 198 | 198 | 26,277,470 | Hash and byte count pass |

The 198 referenced assets include JavaScript/module files, three filename-evident workers, two WASM binaries, JSON, fonts, PNG/GIF images, and one Rive asset. Fetch manifests record discovery source, local path, status, size, and SHA-256.

This closes the measurable “advertised by this runtime” gap. It does not expose server code and cannot prove that another build or experiment would advertise the same graph.

## 13. Privacy and integrity

Raw HARs, sanitized HARs, raw hook captures, the signed-in HTML document, and the private screenshot are owner-only (`0600`). Sanitized HARs remove HAR cookie objects and recognized authentication/session headers, but retain response prose and therefore remain private by default.

The latest schema-only hook derivative is stricter. It emits allowlisted structural values, counts, lengths, thresholds, and selected usage metrics while omitting captured URLs, identifiers, headers, cookies, credentials, arbitrary request/response strings, and model aliases. Its deterministic audit reports zero URL, absolute-path, UUID, compact-identifier, email, JWT, bearer-token, Notion-token, serialized-cookie, forbidden-key, and unknown-enum hits.

Privacy scans are strong safeguards, not anonymity proofs. Unusual identifiers or sensitive prose can evade pattern matching. Review any artifact manually before external sharing, and never publish the raw evidence.

**Integrity note.** `ARCHIVE_MANIFEST.sha256` and `archive-inventory.json` were finalized before the desktop-decompile pass. The new `reference/desktop-decompile/` tree and the three added analysis docs (`desktop-decompile-findings.md`, `notion-ai-integration-research.md`, `compaction-design.md`) are therefore **not** in the current checksum snapshot; a manifest check will report them as untracked additions until both integrity files are rebuilt per the order in `reference/README.md`. The vendored desktop bundle is Notion's copyrighted code, archived locally for analysis only.

## 14. Reproduction and validation

Run from `/Users/irene/Documents/Notionize` unless noted:

```sh
# Regenerate missing/outdated sanitized HARs and validate capture pairing.
python3 reference/har/sanitize_har.py --discover
python3 reference/scripts/check_capture_pipeline.py

# Rebuild endpoint and model catalogs.
python3 reference/scripts/catalog_har_endpoints.py
python3 reference/scripts/extract_model_roster.py

# Rebuild the multi-entry protocol dataset and findings.
python3 reference/scripts/extract_inference_protocol.py

# Re-run the complete-runtime static audit.
node reference/scripts/scan_full_runtime.mjs

# Rebuild and audit the latest privacy-safe hook schema.
node reference/scripts/sanitize_live_capture.mjs \
  reference/captures/raw/notionize-live-2026-08-27T03-50-19.759Z.json \
  reference/captures/sanitized/notionize-live-2026-08-27T03-50-19.759Z.schema.json
node reference/scripts/audit_live_capture.mjs \
  reference/captures/raw/notionize-live-2026-08-27T03-50-19.759Z.json \
  reference/captures/sanitized/notionize-live-2026-08-27T03-50-19.759Z.schema.json \
  reference/analysis/live-capture-latest-privacy-scan.json

# Test the offline fail-closed SSE projection.
(cd reference/tools/notion-anthropic-sse && python3 -m unittest -v test_adapter.py)
python3 reference/tools/notion-anthropic-sse/validate_har_replay.py

# Build integrity data only after every other file is final.
python3 reference/scripts/build_archive_inventory.py

# Verify from the Notionize root on macOS.
shasum -a 256 -c reference/analysis/ARCHIVE_MANIFEST.sha256
```

The capture pipeline rejects missing sanitized partners, public file modes, symlinks, malformed HARs, ambiguous filenames, raw/sanitized summary mismatches, and duplicate collapse. The protocol extractor supports multiple inference entries in one HAR and keeps per-entry outcome/identity.

## 15. What the archive proves and does not prove

### Supported conclusions

- The captured browser chat uses a same-origin Notion JSON request and NDJSON patch response.
- Five distinct successful turns and two distinct HTTP-200 quota failures are structurally evidenced across overlapping HAR/hook sources.
- Text, terminal usage integers, final state, application failure, and patch ordering can be recovered for the observed subset.
- The complete JavaScript/CSS graph advertised by one captured runtime and all directly referenced public assets are archived and verified.
- The full runtime contains a much broader AI/agent/meeting/connector API surface than the seven observed inference requests.
- Notion-specific transcript summary/compaction structures exist in client code.
- The browser chat boundary does not expose a model-vendor credential or direct captured provider request.

### Unsupported conclusions

- That every Notion endpoint, asset, mode, experiment, model, or account cohort has been captured.
- That every Notion AI feature uses `runInferenceTranscript` or always proxies through the same server path.
- Which private upstream service handled any captured inference.
- That OpenRouter is or is not present behind Notion's private backend.
- That Notion cache counters equal Anthropic cache billing categories.
- That a successful terminal state implies a native `end_turn` stop cause.
- That reasoning effort exposes chain-of-thought or reusable signatures.
- That model-selected tools, cancellation, retry/failover, top-level stream errors, or compaction behavior have been live-validated.
- That the low-threshold experiment proves compaction cannot occur.
- That sanitized artifacts are safe for publication without review.

## 16. Evidence index

| Artifact | Purpose |
|---|---|
| `reference/README.md` | Archive map and handling guide |
| `reference/analysis/coverage-audit.md` | Current coverage, overlap accounting, gaps, and stop conditions |
| `reference/analysis/full-runtime-static-audit.{md,json}` | Full-runtime integrity and static callsite/provider/model evidence |
| `reference/analysis/full-runtime-*.csv` | API, model, and provider evidence catalogs |
| `reference/analysis/network-summary.json` | Six-HAR network totals |
| `reference/analysis/network-endpoints.{json,csv}` | All normalized observed routes |
| `reference/analysis/ai-endpoints.{json,csv}` | Direct/support/correlated AI route subset |
| `reference/analysis/inference-protocol.json` | Multi-entry, privacy-safe HAR protocol dataset |
| `reference/analysis/inference-protocol-findings.md` | Protocol/outcome/duplicate findings |
| `reference/analysis/live-capture-state-coverage.md` | Latest four-request hook analysis |
| `reference/analysis/live-capture-latest-privacy-scan.json` | Deterministic schema/privacy audit |
| `reference/analysis/desktop-decompile-findings.md` | Notion desktop v7.31.3 static analysis: skill-install IPC, agent roots, consent/security model, meeting-notes audio, telemetry |
| `reference/analysis/notion-ai-integration-research.md` | Web research + client cross-check: hosted MCP, Skills, External/Custom Agents, credit metering, feature naming |
| `reference/analysis/compaction-design.md` | Recovered progressive-transcript-compression mechanism and a working configuration/validation plan |
| `reference/desktop-decompile/` | Downloaded zip, extracted asar, and prettified main-process + web-runtime bundles |
| `reference/analysis/anthropic-sse-compatibility.md` | Detailed SSE, token, history, error, and compaction analysis |
| `reference/analysis/stream-field-compatibility.{md,json}` | Human/machine field-level compatibility matrices |
| `reference/tools/notion-anthropic-sse/` | Offline fail-closed projection proof and tests |
| `reference/analysis/model-roster.{json,csv}` | Captured 31-alias roster |
| `reference/assets/browser-code/` | Seed bodies, runtime chunks, CSS, referenced assets, and manifests |
| `reference/har/` | Owner-only raw and sanitized HAR evidence |
| `reference/captures/` | Owner-only hook exports and schema-only derivatives |
| `reference/analysis/final-validation.md` | Final syntax, parity, privacy, permission, and integrity results |
| `reference/analysis/archive-inventory.json` | Final file count, sizes, and SHA-256 inventory |
| `reference/analysis/ARCHIVE_MANIFEST.sha256` | Whole-archive checksum manifest, excluding recursive outputs |

## 17. Desktop application decompile (v7.31.3)

The Notion macOS desktop app was downloaded (`Notion-7.31.3.zip`, SHA-512 matched against Notion's `latest-mac.yml`), its `app.asar` extracted, and the Electron main-process bundle prettified to `reference/desktop-decompile/pretty/main-index.js` (~142k lines). Full detail: `reference/analysis/desktop-decompile-findings.md`.

- **Runtime:** Electron 42.4.1, `@sentry/electron@7.11.0`, built with Electron Forge 7.8.1.
- **No inference in the desktop layer.** `runInferenceTranscript`, `getAvailableModels`, and `contextManagementConfiguration` have zero occurrences in the main process; the renderer loads the AI runtime from `app.notion.com` (the same code already archived here). The desktop owns OS-level capabilities only.
- **Local coding-agent skill installer (headline).** Module `72746` defines `SKILL_INSTALL_TARGETS` mapping `claude-code`, `codex`, `cursor`, `gemini`, `grok` to `~/.claude/skills`, `~/.codex/skills`, `~/.cursor/skills`, `~/.gemini/skills`, `~/.grok/skills`. `setupSkillFileIpc()` (invoked at boot, line 45286) registers four request/response channels: `notion:check-existing-local-skill-installs`, `notion:write-skill-file`, `notion:write-skill-assets`, `notion:manage-skill-directories`. The renderer can push a Notion-authored `SKILL.md` (+ assets) into a local agent's skills root.
- **Security model (module `37537`).** Path-segment and absolute-path validation; symlink-target rejection via `lstat`; real-path containment within the target root and an approved directory; a native consent dialog "Allow Notion to install skills for {agentName}?"; persisted `approvedSkillDirectories`; rolling-window rate limits of **500 writes or 512 MiB per 60 s**; a **5 MiB** cap per `SKILL.md`; asset caps of **25 MiB/asset**, **100 MiB/batch**, **50 assets**; an extension allowlist; and a download-source allowlist (`isSecureFileURL`: only `file.notion.so`/`file.notion.com` + dev/stg, plus a localhost dev path) with `redirect:"manual"` and post-fetch URL re-validation. An analytics event `local_skill_asset_write` is emitted per write.
- **Meeting-notes / audio transcription.** A 32-channel IPC family (`notion:core-audio-tap`, `notion:enforce-single-active-transcription`, `notion:set-meeting-notes-extension-transcription-active`, `notion:meeting-notes-speaker-activity`, …) plus `audioController`/`transcription` implement a Core Audio system tap feeding the renderer's AI notes feature. The desktop supplies OS capture; AI summarization is renderer/server-side.

## 18. Official integration surfaces and usage metering

Web research (`reference/analysis/notion-ai-integration-research.md`) places the decompiled surfaces in the shipping product and answers the brief's endpoint/feature/usage questions.

- **Hosted MCP (content bridge).** `https://mcp.notion.com/mcp` (Streamable HTTP) / `https://mcp.notion.com/sse` (fallback), OAuth-only. External agents (Claude Code, Codex, Cursor, VS Code, Gemini/Antigravity, Devin, …) read/write Notion **content** using **their own** models. It does not return Notion completions.
- **Skills (instruction bridge).** Notion's docs describe a Claude Code plugin adding "the MCP server, **Skills**, and slash commands"; the **Skills** delivery is exactly the decompiled `write-skill-file`/`write-skill-assets` IPC. `SKILL.md` is a shared format across the five agents.
- **Custom / External Agents (credit-metered bridge).** Notion 3.0 (2025-09-18) rebranded Notion AI as **Agents**; **Custom Agents** can call external MCP tools (client feature `mcp_ai_access`), and the **External Agents API** invites hosted Claude/Cursor agents into a workspace. Notion-side execution consumes credits.
- **No public model endpoint.** The only AI-inference route is the internal, session-authenticated `api/v3/runInferenceTranscript`; there is no documented AI CLI or token-accessible completions endpoint.
- **Usage metering is server-authoritative.** `getAIUsageEligibilityV2({ spaceId })` returns `basicCredits`/`premiumCredits`; `creditRateLimitVerdict` returns `within_limit`/`rate_limited`/`not_applicable` with `enforcement` and `creditTier`; overage via `ai_usage_overage`; failures surface as `premium-feature-unavailable`. Entitlements key on `featureName` (`ai_usage`, `custom_agents`, `custom_agents_credit_usage`, `mcp_ai_access`, `workers`); thread labels (`personal_agent`, `workflow`) are a separate dimension. **Renaming client feature/thread labels does not change metering**, because the credit ledger and rate-limit verdict are computed server-side per `spaceId` on the actual inference call — corroborated by the two archived quota HARs where an ordinary chat turn was denied without any special "agent" labelling.

## 19. Compaction: recovered mechanism and working configuration

Full detail: `reference/analysis/compaction-design.md`.

- **Mechanism.** Progressive transcript compression: `summarize-transcript` request → `agent-transcript-summary` result → rolling in-place update keyed by `lastStepId` → `activate-transcript-compaction`. Five knobs (`contextManagementConfiguration`): `compactThreshold`, `createSummaryThreshold`, `updateSummaryInterval`, `maxToolResultTokens`, `recentSearchToolResultsToKeep`.
- **Resolution/defaults.** client config → Statsig `ai_agent_progressive_transcript_compression_threshold` → defaults; `compactThreshold` default **1.0**, `createSummaryThreshold` default `compactThreshold − 0.1`, `updateSummaryInterval` default **0.1**; window `≈272000` tokens. The high default is why live compaction was never seen.
- **Working ladder.** `createSummaryThreshold 0.5`, `updateSummaryInterval 0.1`, `compactThreshold 0.8`, `maxToolResultTokens 50000`, `recentSearchToolResultsToKeep 5` — summarize early, refresh often, compact before the ceiling, and truncate oversized tool output. Preserve the invariant `createSummaryThreshold < compactThreshold`.
- **External consumers** (e.g. the `notion-anthropic-sse` adapter) should treat `agent-transcript-summary` as context replacement keyed by `lastStepId`, drop pre-summary raw steps on `activate-transcript-compaction`, and surface `summarize-transcript-error` as non-fatal.
- **Caveat.** Compaction lowers tokens/cost/latency but does not bypass credit metering (§18).

## Conclusion

The captured Notion browser chat is a Notion-specific transcript/state protocol. The browser sends JSON to `/api/v3/runInferenceTranscript`, incrementally consumes NDJSON patches, reconstructs an inference step, receives record state, and accepts `patch-sync` as terminal success. Quota denial is an application state inside HTTP 200 rather than a demonstrated HTTP transport error.

The source has enough information for a carefully labeled text-only Anthropic SSE projection with terminal Notion usage integers. It does not contain every field required for provider-authentic identity, stop semantics, native thinking/tools, stateless continuation, or transparent compaction. Those limits are semantic, not just formatting differences.

Finally, the runtime archive is complete against the captured manifest—2,149 JavaScript chunks, 35 CSS chunks, and 198 directly referenced assets—but the honest global claim remains bounded. No finite browser session can prove possession of every future/cohort/server artifact. The archive makes that boundary measurable, preserves what was actually captured, and records exactly what further live state would be needed to strengthen the remaining conclusions.

On the Notionize thesis specifically — "connect Notion to Claude, code, and codex" — the strongest result is that Notion already ships this, in two directions, and the desktop decompile proves it: the app installs Notion-authored `SKILL.md` files into Claude Code, Codex, Cursor, Gemini, and Grok, while the hosted MCP server lets those same agents operate on Notion content. What is not available is the reverse the brief hoped for — borrowing Notion's own models through some hidden endpoint. Notion's inference is an internal, session-authenticated, credit-metered facade, and no client relabeling changes that. The productive path is therefore to use the shipping bridges (MCP for content, Skills for instructions, External/Custom Agents for orchestration) and, for long sessions, to drive Notion's own recovered compaction ladder with the configuration in `reference/analysis/compaction-design.md`.
