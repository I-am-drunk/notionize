# Notion inference stream-field compatibility

## Result

The captured protocol is sufficient for a **text-only streaming projection of the five successful transactions**, but not a lossless provider-protocol conversion. The two captured quota transactions are HTTP-200 NDJSON application failures, not successful empty responses. They must become downstream errors and must never receive a synthetic `message_stop`.

Text arrives incrementally through `agent-inference` content followed by `x` patch operations. The final model alias, token totals, cache totals, timing fields, and limits arrive only after the last text delta. A converter can therefore choose between:

- low-latency text with placeholder or adapter-defined initial metadata and a terminal usage correction; or
- a fully buffered replay with the captured final Notion metadata available from the first downstream event.

For Anthropic TypeScript SDK 0.121.0, standard `MessageDeltaUsage` includes cumulative `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, and `output_tokens`. `MessageStream` overwrites start-usage values when the corresponding terminal fields are non-null. A live projection can therefore finish with the captured Notion-reported integers even though its `message_start` usage was placeholder/inaccurate. This is structural compatibility only: Notion `inputTokens` is not proven to mean Anthropic's uncached `input_tokens`, so the Anthropic sum of input plus cache-created plus cache-read must not be presented as provider-authentic billing or context usage. The final model alias has no analogous terminal correction and still requires buffering if it must be accurate in `message_start`.

That SDK version also requires nullable `citations` on response text blocks and nullable `container` and `stop_details` on both the start message and terminal delta. Its usage objects require nullable cache-count/detail fields. The proof now emits those keys explicitly as null when the captured source has no corresponding value.

Successful turn completion is observable, but a model stop cause is not. No captured field distinguishes natural completion, token limit, stop sequence, tool use, refusal, or another provider reason. The quota marker identifies a Notion application outcome, but it does not identify an Anthropic error type or establish retryability.

The machine-readable, field-by-field audit is in `stream-field-compatibility.json`.

## Observation accounting

The artifacts overlap and must not be added naively:

| Evidence source | Artifact-level observations | Relationship to distinct transactions |
| --- | ---: | --- |
| Legacy sanitized HAR set | Four inference entries | Three distinct successful transactions; the settled-session entry repeats the earlier partial continuation |
| Latest persistent-hook schema capture | Four targeted requests | Four distinct transactions: two successes and two quota failures |
| Latest sanitized HAR | Three inference entries | The long success and both quota failures are the same transactions as hook targets 2–4 |
| Combined evidence | Eleven observations | Seven distinct transactions: five successes and two quota failures |

The latest HAR-to-hook overlap is established structurally: matching request transcript order and user-string length, matching NDJSON event order and outcome, and—for the long success—matching terminal usage and limits. The hook-only short success is not present in the latest HAR. The baseline HAR contains no inference transaction.

All seven distinct transactions returned HTTP 200 with `application/x-ndjson`. The five successes contain one text-only `agent-inference` and terminate with `patch-sync`. The two quota failures contain the exact `premium-feature-unavailable` state, contain no model call or per-inference usage, and end after `record-map` without `patch-sync`.

## Anthropic SDK 0.121.0 field provenance

The adapter emits a valid standard Messages text-stream shape, but each field has different provenance:

| SDK field(s) | Captured source | Projection status |
| --- | --- | --- |
| Text delta bytes and order | Initial text block plus `x` extensions | Observable and directly preserved for successful text turns |
| `message.role`, content index, block/event lifecycle | Inference step semantics and verified state order | Deterministically reconstructed |
| `message.id` | No Anthropic ID exists | Synthesized adapter ID |
| `message.model` | Final Notion alias arrives terminally | `notion/<alias>` is a synthesized label around an observable alias, not an Anthropic model identity |
| `usage.input_tokens` | Terminal Notion `inputTokens` | Observable integer, structurally projected; uncached-token and tokenizer semantics unverified |
| `usage.output_tokens` | Terminal Notion `outputTokens` | Observable final integer; initial zero is an adapter placeholder |
| `cache_creation_input_tokens`, `cache_read_input_tokens` | Terminal Notion cache counters | Observable integers, structurally projected; billing, boundary, TTL, and category equivalence unverified |
| `container`, `stop_details`, text `citations` | No corresponding captured value | Required nullable SDK fields synthesized as null |
| `cache_creation`, `inference_geo`, `output_tokens_details`, `server_tool_use`, `service_tier` | No corresponding captured value | Required nullable start-usage fields synthesized as null |
| Terminal `stop_sequence` | No corresponding captured value | Synthesized as null |
| Terminal `stop_reason=end_turn` | No model stop cause is captured | Explicit synthetic policy |
| `content_block_stop`, `message_stop` | Verified successful `patch-sync` | Reconstructed closure; not a model stop cause |
| Context/input limits, timing, retry/failover metadata | Observable only when a model call completes | Dropped from standard SSE and retained only as potential sidecar telemetry |
| Beta compaction envelope, block/delta, opaque state, stop cause, and usage iterations | Not observed | Must not be synthesized as native Anthropic state |

## Agent/CLI compatibility matrix

These classes describe the evidence source, not provider provenance: **native** is explicitly captured; **reconstructible** is deterministically derived; **synthetic** is generated or policy-selected by the adapter; **absent** cannot be recovered from these traces.

| Field or behavior | Wire compatibility | Semantic compatibility | Class | Agent/CLI effect |
| --- | --- | --- | --- | --- |
| Visible text and chunk order | Complete text-block SSE lifecycle | Exact for captured visible output | **Native** | Text display works |
| Assistant role and block lifecycle | Complete SDK 0.121.0 shape | Faithful for the observed single assistant text block | **Reconstructible** | Text-only SDK parsing works |
| Message ID | Valid adapter ID can be emitted | No provider identity survives | **Synthetic** | Correlate privately; do not claim Anthropic provenance |
| Model field | `notion/<alias>` is a valid string | Alias is not an Anthropic model ID | **Synthetic** | Provider capability routing is unsafe |
| Input/output/cache integers | Standard usage fields can carry them | Native Notion numbers; tokenizer, billing, cache, and TTL equivalence unverified | **Native** | Qualified telemetry only |
| Verified terminal completion | Close events can be emitted after `patch-sync` | Product/transport completion survives; model stop cause does not | **Reconstructible** | Text turn can close cleanly |
| `end_turn` | Wire-valid stop reason | Adapter policy, not captured model evidence | **Synthetic** | Do not drive a consequential loop as if native |
| Other stop causes | Values exist in Anthropic types | Not captured | **Absent** | Tool/pause/refusal/limit/compaction branching is unavailable |
| Thinking text, signature, redacted data | Known block/delta types | No values or opaque continuity state captured | **Absent** | Extended-thinking resume is unavailable |
| Tool definitions | Known request shape | Connector labels and booleans are insufficient | **Absent** | Cannot expose faithful executable tools |
| Model tool call (`id`, `name`, `input`, `caller`) | Known block plus `input_json_delta` | Auto-load results do not establish a model decision | **Absent** | Do not start a tool loop |
| Tool-result pairing | Known user `tool_result` shape | No exact invocation/result/resume pair captured | **Absent** | Tool continuation is unavailable |
| Quota application failure | Downstream HTTP error before streaming, or SSE `error` after streaming starts | Live Notion outcome is known; Anthropic taxonomy and retryability are not | **Reconstructible** | Return an error and never append synthetic success |
| Top-level stream-error envelope | Can be derived from the static Notion error branch | The branch exists in code but remains unobserved live | **Reconstructible** | Fail closed; never append synthetic success |
| Complete continuation history | `messages[]` shape is known | Partial transcript omits canonical prior turns and opaque state | **Absent** | Stateless resume is unavailable |
| Gateway-owned ledger | Next request can be built if owned from turn one | Preserves only state the gateway actually recorded exactly | **Reconstructible** | Stateful continuation can work |
| Native compaction controls/state/iterations | Beta shapes are known | Configuration fields were sent, but runtime summary/activation/opaque/iteration state was not observed | **Absent** | Transparent compaction cannot work from these artifacts |
| Gateway-created compaction policy | A fresh target request can be made | New target-side semantics, not recovered Notion behavior | **Synthetic** | Possible only in a terminating gateway |

## Executable proof validation

The offline proof adapter in `reference/tools/notion-anthropic-sse/` confirms the matrix's implementable subset. Its 24 unit tests pass. An independent in-memory replay inspected six sanitized HARs and found seven inference entries. It converted all five successful entries and rejected both quota entries before rendering SSE. The five converted entries represent four distinct successes because one legacy entry is duplicated; the hook-only short success has no HAR body to replay.

The legacy SSE replays contain 9 events for auto, 9 for explicit medium, 10 for explicit no-thinking, and 9 for the settled duplicate. The latest long-success HAR replay contains 8. The two quota entries produce zero SSE events because they fail the required terminal lifecycle. The adapter:

- buffers through `patch-sync` and verifies both text and full reconstructed state;
- retimes terminal Notion input/cache totals into `message_start`;
- re-emits cumulative input/cache/output usage at `message_delta` for SDK 0.121.0 accumulator correction;
- emits required nullable SDK 0.121.0 fields for message/delta container and stop details, text citations, cache counts, and extended usage metadata;
- labels `end_turn` as a synthetic policy because no model stop reason was captured;
- keeps auto-load tool results out of Anthropic tool blocks;
- omits Notion-only completion timing, limits, retry history, and failover metadata from SSE;
- rejects known summary, compaction, quota/error, and post-inference tool-result states; and
- fails closed on incomplete, misordered, non-text, state-mismatched, or in-stream error input before synthetic success rendering.

This validates the SDK 0.121.0 terminal-correction payload shape inside a deterministic buffered response projection. The proof still starts only after `patch-sync`, so it does not exercise low-latency placeholder-start behavior. It does not reconstruct the partial continuation request's missing history or map a Notion thread ID to a provider handle, and it does not establish provider authenticity or a lossless round trip.

## Evidence boundary

This audit used only local sanitized/schema evidence:

- all six sanitized HAR captures, including the latest three-entry session;
- the latest four-request hook schema derivative;
- `inference-protocol.json` and its findings;
- the recovered browser transport analysis; and
- the existing Anthropic SSE compatibility analysis.

It made no browser requests and no requests to Notion, Anthropic, or any model endpoint. The public npm SDK package was consulted only to verify the pinned target type definitions. This audit does not reproduce prompts, response prose, account/workspace/thread/message identifiers, record values, cookies, headers, or credentials.

Combined coverage is eleven artifact-level observations representing seven distinct transactions. The legacy settled-session HAR repeats the earlier partial continuation. The latest HAR's three entries overlap hook targets 2–4. The hook contributes one additional short success not present in that HAR. The baseline HAR has no inference transaction.

That coverage is an evidence ceiling. The two quota failures establish one application-failure state only. Thinking, native model tool calls/results, top-level stream errors, cancellation, retry/failover, refusal, limit stops, summary creation/update, summary failure, and compaction activation remain **not observed / insufficient capture**. Recovered code contains Notion-specific summary/compaction step types, but no live values, ordering, or resume behavior for those types were captured.

## Observed timing

NDJSON indexes below are zero-based.

| Distinct trace | Request mode | Events | Inference starts | Text extensions | Terminal metadata | Record map | Final sync |
| --- | --- | ---: | ---: | --- | ---: | ---: | ---: |
| Auto | New, full transcript | 15 | 7 | 8–10 | 11 | 13 | 14 |
| Explicit medium | Partial continuation | 9 | 1 | 2–4 | 5 | 7 | 8 |
| Explicit no-thinking | New, full transcript | 15 | 5 | 6–9 | 10 | 13 | 14 |
| Latest long success | Partial instrumented request | 8 | 1 | 2–3 | 4 | 6 | 7 |

Every distinct response is HTTP 200 `application/x-ndjson`. Successful responses follow:

```text
patch-start -> patch* -> record-map -> patch-sync
```

The initial `agent-inference.value` contains one `{type, content}` text block. Each later text fragment is an `x` operation against that block's `content` path. The final `patch-sync.data.s` is the authoritative assembled state.

The two quota failures instead follow `patch-start -> record-map`. They contain no `agent-inference`, text delta, terminal model/usage object, or `patch-sync`.

## Buffering decisions

| Desired downstream property | Requirement | Why |
| --- | --- | --- |
| Live text deltas | No full buffering | Initial text and each extension are available incrementally |
| Final output usage | Wait for terminal metadata | `outputTokens` is cumulative and appears after all text |
| Accurate captured input/cache usage in Anthropic `message_start` | Buffer and replay the whole stream | `inputTokens` and both cache counts arrive terminally |
| Accurate final accumulated input/cache/output usage in Anthropic TS SDK 0.121.0 | No full buffering; send a terminal `message_delta` correction | Non-null terminal usage fields overwrite the accumulator's start values |
| Captured final model alias in the first event | Buffer and replay the whole stream | Final model is terminal metadata and has no terminal correction field |
| Faithful stop/finish reason | Not recoverable from these captures | No explicit model stop cause exists in the five observed successes |
| Quota failure | Detect before success projection | Return a downstream error; do not create an empty assistant message or append `message_stop` |
| Portable continuation | Persistent external ledger | A partial request omits full prior history |
| External compaction of these captured artifacts | Persistent ledger plus target-model tokenization | No compaction event or complete standalone history is captured; broader Notion behavior remains untested |

The Notion token values are usable as qualified Notion telemetry. In particular, mapping `inputTokens` to Anthropic `input_tokens` does not prove that it is the uncached category; adding it to cache-created and cache-read counts may overstate or otherwise misdescribe provider input. Tokenizer, billing boundary, and cache equivalence are not established.

## Completion and stop reasons

Several fields establish successful Notion completion in the five success transactions:

- `finishedAt` is added after the final text delta;
- terminal `patch-sync` is present;
- returned thread outcome state says `completed`; and
- post-stream telemetry reports `terminal_reason: completed`, `completion_source: stream`, `is_error: false`, and `is_retry: false`.

Those are product/transport completion signals, not a model stop reason. In particular, `terminal_reason: completed` must not be silently converted to Anthropic `stop_reason: end_turn` or an OpenAI Chat Completions `finish_reason: stop`. Such a value can be chosen only as an explicit adapter policy and should be documented as synthetic.

`stop_reason`, `stop_sequence`, provider-native `finish_reason`, and an equivalent incomplete-reason field are absent. Buffering cannot recover them. Quota failure is a separate application outcome, not a model stop reason.

## Token and cache accounting

All five distinct successful transactions finish with:

- `inputTokens`;
- `outputTokens`;
- `cachedTokensRead`;
- `cachedTokensCreated`;
- `maxContextTokens` and `maxInputTokens`; and
- server timing metrics.

There is no per-delta token usage. `outputTokens` can be projected terminally as a cumulative downstream output count. Input and cache values need full buffering only if a protocol requires them to be accurate in its initial event. With Anthropic TypeScript SDK 0.121.0, a live converter may send terminal cumulative input/cache/output values in `message_delta.usage`; the accumulator then replaces corresponding start values. This yields accurate final accumulated Notion-reported usage, not accurate `message_start` usage or verified provider semantics.

The returned record map also contains a cumulative thread `usage_summary`. It must remain separate from the active response's usage because it represents broader thread/accounting state.

Cache counts do not reveal cache boundaries, content, lifetime, or provider policy. Anthropic `cache_control` and OpenAI `prompt_cache_key` / `prompt_cache_retention` are absent. The request's `debugOverrides.cachedInferences` is an empty object in every inference observation and is not evidence of an active cache-control mechanism.

## Errors, retries, and cancellation

Two live application-level quota failures are captured. Both return HTTP 200 NDJSON with `patch-start -> record-map`, include `premium-feature-unavailable`, and contain no `agent-inference`, per-call usage, or terminal `patch-sync`. A downstream adapter must therefore classify the body before declaring success. In buffered mode it should return a downstream error before SSE begins; if a live bridge has already begun a response, it should emit an error and close without `message_stop`. The evidence does not establish an Anthropic error subtype, HTTP status, or retry policy, so labeling the outcome as a native `rate_limit_error` or asserting retryability would be fabrication.

Static browser code does establish three client branches:

- an in-stream `{type: "error", message, code}` event;
- a structured non-200 HTTP failure path; and
- an `AbortSignal` path producing a distinct status-0 aborted result.

Those top-level error, transport-failure, and abort branches remain unvalidated by live captures. The captured quota state is a fourth, distinct application outcome inside an otherwise successful HTTP exchange.

No populated `previousAttemptValues` or affirmative `isModelFailover` was observed. This establishes only that no retry/failover state is present in the captured successes; retry, failover, cancellation, and exhaustion schemas remain insufficiently captured.

## Tools and reasoning

The two new/full-thread traces each contain three applied `agent-tool-result` steps before inference. They are auto-load/context-loading results. They lack a captured assistant decision boundary, provider tool-call ID, streamed arguments, and tool definition schema. They therefore must not become Anthropic `tool_use` / `tool_result` blocks or OpenAI function-call items.

No native model tool-call delta, result/resume pair, or tool-stop reason was captured in any of the seven distinct transactions. Request flags and connector labels are not executable tool schemas. This establishes only what this evidence exposes, not that a different Notion tool workflow cannot emit a richer schema.

Reasoning policy appears only as request configuration in the legacy set and one latest updated-config request that fails before inference. Such enums can inform adapter policy, but they do not prove an equivalent provider budget. Every captured successful inference response contains text only—no thinking/reasoning block, signature, reasoning summary, or reasoning-token count.

## Continuation and compaction

`threadId`, `createThread`, and `isPartialTranscript` are Notion routing/session fields. The partial continuation includes current config/context, an updated config, and the new user step; it is not a complete conversation history.

Consequences:

- Anthropic Messages history cannot be reconstructed from that request alone.
- A Notion thread ID is not an OpenAI `previous_response_id`.
- Hidden Notion prompt/context assembly remains server-side.
- No explicit summarization, truncation, or compaction event was observed in the five successful text turns or two quota outcomes.

The hook forced `createSummaryThreshold=0.01`, `updateSummaryInterval=0.005`, `compactThreshold=0.02`, and `recentSearchToolResultsToKeep=-1`. These are instrumented request values, not observed defaults. The long-input turn completed, but that content became prior history only for the following request. Both following requests were rejected at the quota layer before any model call. Therefore zero summary or activation markers do not test the eligible successful post-history path and cannot disprove Notion compaction.

Native Anthropic compaction has a concrete contract that the Notion captures do not supply:

- request opt-in uses `anthropic-beta: compact-2026-01-12` and a `context_management.edits` entry with `type: compact_20260112`;
- the edit may include `instructions`, `pause_after_compaction`, and an input-token trigger; the documented default trigger is 150,000 and the minimum configurable trigger is 50,000;
- the response uses a `compaction` content block with nullable summary `content` and nullable opaque `encrypted_content`;
- streaming uses the ordinary content-block lifecycle with `compaction_delta`;
- a pause-after-compaction flow can end with `stop_reason: "compaction"`; and
- the beta start message adds nullable `context_management` and `diagnostics`, while beta `message_delta` adds top-level nullable `context_management`;
- beta start and delta usage add nullable `fallback_credit` and `iterations`; and
- `usage.iterations` separates `message` from `compaction` iterations, with compaction cost excluded from top-level usage totals.

None of those request, block, delta, stop, or per-iteration fields appears in the Notion evidence. They cannot be inferred from `threadId`, terminal token/cache totals, `patch-sync`, or product-level `terminal_reason: completed`. Any non-null `encrypted_content` received from a genuine Anthropic compaction flow must be stored and round-tripped verbatim; normalizing, summarizing, or dropping it would break the contract.

For a converter limited to these artifacts, safe compaction requires a new adapter-owned feature: maintain a canonical ledger from the first turn, tokenize for the target model, preserve unresolved tool pairs and user/system constraints, summarize only a closed older prefix, and retain provenance. It is not a lossless transformation of the captured standalone Notion continuation. Other Notion states may expose product-native summary or compaction steps; the recovered reducers make that plausible, but their live values, ordering, resume behavior, and relationship to Anthropic compaction remain unverified.

To settle that broader question, capture a privacy-safe long thread as it crosses Notion's summary threshold, including the ordered schemas for summary creation/update, `activate-transcript-compaction`, pre/post record maps, the next resumed request, any opaque state and iteration usage, and an interrupted or failed summarization path. Without those states, the truthful verdict is **insufficient capture**, not **Notion cannot compact**.

## Agent/CLI viability

A text-rendering CLI is viable against the projected stream if it accepts adapter-defined identity and stop policy and treats usage as qualified Notion telemetry. A general Anthropic agent loop is not viable from a standalone captured response: native stop causes, tool decisions and pairings, thinking signatures, redacted blocks, full role-ordered history, container state, and compaction continuity are missing.

A stateful terminating gateway can become agent-capable only by owning the canonical ledger from turn one and preserving all target-native opaque data exactly. It may then tokenize for the target model and deliberately introduce a new summary or Anthropic compaction policy. Those are gateway semantics, not fields recovered from Notion.

## Transparent-proxy verdict

A stateless NDJSON-to-SSE proxy can translate the observed text wire format, but it cannot perform transparent continuation or compaction. Buffering changes timing; it does not recover missing history, tool/signature state, stop causes, opaque compaction blocks, or iteration usage. Transparent compaction is therefore **not viable** for these artifacts. Only a stateful terminating gateway with a complete ledger can implement compaction, and doing so is explicitly new behavior.

## Adapter rule set

1. Parse complete NDJSON lines and apply Notion patches in order.
2. Stream only verified text extensions in low-latency mode.
3. Treat `patch-sync` as final assembled state, not as a provider stop reason.
4. Keep Notion-only records, usage summaries, auto-load results, timings, and identifiers in a private sidecar.
5. Buffer and replay when accurate captured initial model/input/cache metadata is required.
6. Never invent tool calls, reasoning blocks, cache controls, compaction blocks/deltas, stop reasons, usage iterations, or prior history.
7. Require an adapter-owned ledger when continuing or compacting from these standalone artifacts; do not infer that other Notion states lack native compaction.
8. Treat `premium-feature-unavailable` without a model call and `patch-sync` as a downstream error even when HTTP status is 200.
9. Fail closed on malformed, incomplete, errored, or aborted streams.
