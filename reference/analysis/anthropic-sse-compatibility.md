# Notion NDJSON to Anthropic Messages SSE compatibility

## Scope

This is a local, privacy-safe compatibility analysis of the captured Notion `runInferenceTranscript` requests, NDJSON responses, returned record maps, and recovered browser transport code. It does not replay requests, contact Anthropic, expose prompt/response text, or claim behavior for unobserved Notion tool/error paths.

The central distinction is:

1. **Wire conversion:** can an adapter turn the observed Notion text stream into Anthropic-shaped SSE accepted by a compatible text client?
2. **Semantic conversion:** does that SSE mean the same thing as a genuine Anthropic Messages response?
3. **Context conversion:** does the captured Notion request contain enough history and control state to construct the next stateless Anthropic Messages request or compact that history safely?

The answers are respectively **yes for successful simple text**, **only partially**, and **no from a standalone continuation capture**. Buffering is required only if the first SSE event must already contain the final Notion model and usage; a live bridge can carry captured Notion counters in terminal `message_delta.usage` under the current Anthropic schema. The two live quota outcomes are not text responses: despite HTTP 200, their NDJSON bodies contain an application failure and must map to downstream errors.

Therefore the decisive answer is: **the five distinct successful streams can be projected into a complete SDK-0.121.0 text-event shape, but they cannot be represented truthfully and completely as native Anthropic responses; the two quota streams must become errors.** Exact visible text and Notion-reported integers survive successful projection. Provider identity, Anthropic token/cache category semantics, model stop cause, hidden history, Notion control state, and native compaction semantics do not.

## Evidence used

- `reference/har/ai-probe-auto.sanitized.har`
- `reference/har/ai-probe-gpt56-sol-medium.sanitized.har`
- `reference/har/ai-probe-gpt56-sol-no-thinking.sanitized.har`
- `reference/har/notion-live-session-2026-08-27.sanitized.har`
- `reference/captures/sanitized/notionize-live-2026-08-27T03-50-19.759Z.schema.json`
- `reference/analysis/har-semantics.md`
- `reference/analysis/inference-protocol.json`
- `reference/analysis/inference-protocol-findings.md`
- `reference/analysis/browser-transport-static-analysis.md`
- `reference/analysis/model-roster.json`
- `reference/analysis/ai-client-surface-map.json`
- `reference/analysis/stream-field-compatibility.json`
- `reference/tools/notion-anthropic-sse/`
- Recovered `ActionBarUI`, `ClientFramework`, and main-app chunks under `reference/assets/browser-code/files/`
- [Anthropic streaming documentation](https://platform.claude.com/docs/en/build-with-claude/streaming) and [compaction documentation](https://platform.claude.com/docs/en/build-with-claude/compaction)
- Official `@anthropic-ai/sdk` TypeScript package version 0.121.0, especially `MessageDeltaUsage`, `RawMessageDeltaEvent`, beta compaction types, and the `MessageStream` accumulator

The legacy HAR set has four inference entries representing three distinct successful transactions because the settled-session HAR repeats the partial continuation. The latest persistent-hook schema contains four distinct requests: two successes and two application-level quota failures. The latest HAR contains three entries that structurally match hook targets 2–4—the long success and both quota failures—so those are overlapping observations, not three more transactions. Combined coverage is eleven artifact-level observations representing seven distinct transactions: five successes and two quota failures. The hook-only short success is not present in the latest HAR; the baseline HAR has no inference entry.

Overlap is established only from privacy-safe structure: transcript type order and string lengths, NDJSON event order and outcome, and—for the long success—the terminal usage/limit integers. No prompt, response, identifier, header, or record value is used here.

## Anthropic Messages contracts relevant to an adapter

### Request contract is stateless

A normal Anthropic Messages request is a `POST /v1/messages` JSON body. For a basic request, the adapter must supply at least:

```json
{
  "model": "<anthropic-model-id>",
  "max_tokens": 1024,
  "messages": [
    {"role": "user", "content": [{"type": "text", "text": "..."}]}
  ],
  "stream": true
}
```

Important input rules for conversion:

- Conversation history is resent in `messages`; Anthropic does not accept a Notion `threadId` as a substitute for history.
- System instructions are normally supplied through the top-level `system` field; in any case, the mixed Notion `context` object must not be reinterpreted wholesale as system content.
- A client tool requires a top-level tool definition with `name`, optional description, and JSON `input_schema`.
- An assistant tool invocation is represented by a `tool_use` content block. Its result is sent in a subsequent **user** message as a `tool_result` block referencing `tool_use_id`.
- `model` and `max_tokens` are required policy decisions. The Notion auto request supplies neither an Anthropic model ID nor an Anthropic output-token cap.

Consequently, converting a Notion request into an actual Anthropic request is a separate and harder operation than merely translating the response stream.

### SSE framing

Anthropic streaming uses HTTP `Content-Type: text/event-stream`. Every frame has an SSE event name and one JSON data object, terminated by a blank line:

```text
event: <event-name>
data: {"type":"<same-event-name>", ...}

```

JSON must be serialized onto the `data:` line with embedded newlines escaped. Anthropic terminates with `message_stop`; it does not use an OpenAI-style `[DONE]` sentinel.

Clients should tolerate optional `ping` events and unknown future event types, but an adapter should not invent versioned content-block types that it did not observe or cannot populate.

### Required text-stream lifecycle

For one successful text response, the core order is:

1. `message_start`
2. `content_block_start` for content index 0
3. zero or more `content_block_delta` events for index 0
4. `content_block_stop` for index 0
5. `message_delta`
6. `message_stop`

`ping` can appear between lifecycle events. Content blocks may repeat at increasing indexes for mixed content.

#### `message_start`

```text
event: message_start
data: {
  "type": "message_start",
  "message": {
    "id": "msg_<adapter-generated>",
    "type": "message",
    "role": "assistant",
    "model": "<model-string>",
    "content": [],
    "container": null,
    "stop_reason": null,
    "stop_details": null,
    "stop_sequence": null,
    "usage": {
      "input_tokens": <integer>,
      "output_tokens": <integer>,
      "cache_creation_input_tokens": <integer or null>,
      "cache_read_input_tokens": <integer or null>,
      "cache_creation": null,
      "inference_geo": null,
      "output_tokens_details": null,
      "server_tool_use": null,
      "service_tier": null
    }
  }
}
```

The message identifier and model string must be stable for the stream. Usage fields are version-dependent. For the pinned SDK shape, emit required nullable keys as null when the source has no evidence; never fabricate non-null values.

For the version pinned by the executable proof, SDK 0.121.0 requires nullable `container` and `stop_details` on the message, required nullable cache-count keys, and nullable `cache_creation`, `inference_geo`, `output_tokens_details`, `server_tool_use`, and `service_tier` usage fields. Its response `TextBlock` also requires nullable `citations`. The proof emits explicit nulls because Notion supplied no evidence for them. This is a version-pinned Anthropic-shaped projection, not a claim that Notion produced an authentic Anthropic response.

#### Text block

```text
event: content_block_start
data: {
  "type": "content_block_start",
  "index": 0,
  "content_block": {"type": "text", "text": "", "citations": null}
}

event: content_block_delta
data: {
  "type": "content_block_delta",
  "index": 0,
  "delta": {"type": "text_delta", "text": "next chunk"}
}

event: content_block_stop
data: {"type":"content_block_stop","index":0}
```

Every delta for an index must occur after that block's start and before its stop.

#### Final delta and stop

```text
event: message_delta
data: {
  "type": "message_delta",
  "delta": {
    "container": null,
    "stop_reason":"end_turn",
    "stop_details": null,
    "stop_sequence":null
  },
  "usage": {
    "input_tokens": <final cumulative integer or null>,
    "cache_creation_input_tokens": <final cumulative integer or null>,
    "cache_read_input_tokens": <final cumulative integer or null>,
    "output_tokens": <final cumulative integer>,
    "output_tokens_details": null,
    "server_tool_use": null
  }
}

event: message_stop
data: {"type":"message_stop"}
```

These are cumulative message totals, not per-chunk counts. In the current TypeScript SDK, non-null terminal input/cache counters overwrite the corresponding `message_start` values in the accumulated final message. That permits a live bridge to end with accurate **Notion-reported** counters even if its first event used placeholders. It does not mutate the already-delivered first frame, establish Anthropic billing semantics, or correct a late model alias because `RawMessageDeltaEvent.Delta` has no model field. Known stop-reason semantics include `end_turn`, `max_tokens`, `stop_sequence`, `tool_use`, `pause_turn`, `refusal`, and `model_context_window_exceeded`; availability is API/model/version dependent. A converter must not select one without corresponding source evidence or an explicit adapter policy.

#### Exact standard-field provenance

| SDK 0.121.0 field | Provenance in this adapter |
|---|---|
| `message.id` | Synthesized adapter identifier; no Anthropic message ID is captured |
| `message.type`, `message.role`, empty start `content`, block indexes, and event lifecycle | Reconstructed target-protocol structure |
| `message.model` | Observable terminal Notion alias wrapped in a synthesized `notion/<alias>` label; not an Anthropic model identity |
| Start/terminal `input_tokens` | Observable terminal Notion integer, retimed/projected structurally; not proven to be Anthropic's uncached category |
| Start/terminal cache counters | Observable terminal Notion integers, retimed/projected structurally; cache boundaries, TTL, billing, and category equivalence are unverified |
| Start `output_tokens` | Synthesized zero placeholder |
| Terminal `output_tokens` | Observable terminal Notion integer |
| Text block and `text_delta` content | Observable text and ordering from the successful Notion inference |
| `container`, `stop_details`, text `citations` | No source value; required nullable SDK fields synthesized as null |
| Start `cache_creation`, `inference_geo`, `output_tokens_details`, `server_tool_use`, `service_tier` | No source value; required nullable fields synthesized as null |
| Terminal `stop_sequence`, `output_tokens_details`, `server_tool_use` | No source value; synthesized as null |
| Terminal `stop_reason=end_turn` | Synthetic adapter policy; no captured model stop cause supports it |
| `content_block_stop`, `message_stop` | Reconstructed only after verified successful `patch-sync` |
| Context/input limits, timing, retry/failover metadata | Observable for completed model calls but omitted from standard SSE; sidecar only |

Anthropic beta compaction fields are not part of this standard projection. `context_management`, `diagnostics`, `fallback_credit`, `iterations`, compaction blocks/deltas, opaque state, and a compaction stop cause were not observed and cannot be emitted as native state.

### Tool-use stream

An assistant client-tool call begins a `tool_use` block:

```text
event: content_block_start
data: {
  "type":"content_block_start",
  "index":0,
  "content_block": {
    "type":"tool_use",
    "id":"toolu_<adapter-generated>",
    "name":"tool_name",
    "input":{},
    "caller":{"type":"direct"}
  }
}

event: content_block_delta
data: {
  "type":"content_block_delta",
  "index":0,
  "delta":{"type":"input_json_delta","partial_json":"{\"key\":"}
}
```

The adapter must concatenate `partial_json` strings and produce valid JSON by block stop. In the pinned SDK 0.121.0 response type, a completed `ToolUseBlock` requires `id`, `name`, `input`, `caller`, and `type`; `caller: {"type":"direct"}` denotes a direct model invocation. A completed tool-call message normally ends with `stop_reason: "tool_use"`. Tool output is not another assistant SSE block; the application sends it in the next request as a user `tool_result` block containing `tool_use_id`, `type: "tool_result"`, and optional `content` and `is_error`.

### Thinking and opaque continuity state

An SDK 0.121.0 thinking response block requires `type: "thinking"`, the visible `thinking` string, and an opaque `signature`. Streaming sends `thinking_delta` fragments followed by a `signature_delta` before `content_block_stop`. A `redacted_thinking` block instead contains opaque encrypted `data`. Signatures and redacted-thinking data must be stored and passed back unchanged and in their original order when the later request requires them; reconstructed prose is not an equivalent replacement.

Thinking, signature, redacted-thinking, citation, server-tool, search-result, and compaction blocks have their own versioned block/delta schemas. No such Anthropic-native block is proven by the seven distinct transactions, so a compatibility layer should not emit them from this evidence.

### Error event

An error can arrive after an HTTP 200 stream has begun:

```text
event: error
data: {
  "type":"error",
  "error":{"type":"api_error","message":"..."}
}
```

If failure occurs before the SSE response starts, a compatible server should prefer the appropriate non-200 Anthropic JSON error response. If it occurs after `message_start`, it can emit an SSE `error` and close. An error stream should not be made to look successful by adding a synthetic `message_stop`.

The live quota outcome follows this rule even though Notion itself returns HTTP 200: `premium-feature-unavailable` plus no model call and no `patch-sync` is an application failure. A gateway must select its own conservative downstream error status/type because the capture does not establish an Anthropic taxonomy or retry policy. It must not call the response a native Anthropic `rate_limit_error` merely from the Notion marker.

## Captured Notion request and response surface

### Request steps

The new-thread request contains:

```text
config -> context -> user
```

The continuation request contains:

```text
config -> context -> updated-config -> user
```

The latest instrumented requests contain two context steps:

```text
config -> context -> context -> user
config -> context -> context -> updated-config -> user
```

The second form is observed only for one quota-failed request; it does not establish model behavior for that configuration.

The user value is a nested string array. `config` carries Notion workflow flags, search scopes, available connector names, and model policy. `context` carries environment and identity/workspace fields. `updated-config` carries the explicit Notion alias, `modelFromUser`, and reasoning effort.

Notably absent from the captured request:

- An Anthropic model ID in the automatic request.
- An Anthropic `max_tokens` value.
- Full prior history in the partial continuation request.
- Tool descriptions and JSON input schemas.
- Notion's hidden system/developer instructions.
- The complete context assembled server-side from account state, retrieval, and product policy.

### Response state

All five distinct successful responses use:

```text
patch-start -> patch* -> record-map -> patch-sync
```

The authoritative final `patch-sync.data.s` contains ordered Notion steps.

The two distinct quota failures use:

```text
patch-start -> record-map
```

They contain `premium-feature-unavailable`, no `agent-inference`, no per-inference token object, and no `patch-sync`. HTTP status remains 200, so body semantics—not transport status alone—determine failure.

Observed final state types:

- Automatic: `agent-instruction-state`, `agent-turn-full-record-map`, three `agent-tool-result` steps, `config`, `title`, `agent-inference`.
- Explicit continuation: `agent-turn-full-record-map`, `agent-inference`.
- No thinking, fresh thread: `agent-instruction-state`, `agent-turn-full-record-map`, three `agent-tool-result` steps, `agent-inference`, `title`.

The observed `agent-inference.value` is an array containing one block:

```text
{type: "text", content: <string>}
```

The initial inference append supplies the first text fragment. Three `x` operations extend the same content path in the legacy automatic and medium traces; four do so in the no-thinking trace; two occur in the latest long-success HAR. Final metadata is added only after all text chunks in every successful trace.

## Field-by-field mapping

### Request/history mapping

| Notion field/step | Anthropic target | Mapping quality | Reason |
|---|---|---|---|
| `user.value[[string]]` | User text content block | Direct for captured text | Role is explicit in Notion step type and text is present |
| Prior `agent-inference.value[].content` | Assistant text content block | Direct if the record is available | Only text blocks were observed |
| `config.model` / `updated-config.model` | `model` | Policy mapping only | Values are Notion aliases, not Anthropic model IDs |
| Missing model in auto config | Required `model` | Not mappable without policy | The server selects `oatmeal-cookie` later in the response |
| `reasoningEffort` | Anthropic thinking/effort config | Not directly portable | Enum names do not prove equivalent Anthropic budgets/semantics |
| `config.useWebSearch` | Anthropic tool configuration | Insufficient | A boolean does not provide a tool definition or input schema |
| `availableConnectors[]` | Anthropic tools | Insufficient | Connector names are not executable tool schemas |
| `context` | Top-level `system` or messages | Unsafe to stringify | It mixes product context, identity fields, and hidden server behavior |
| `threadId` | None | No standard mapping | Anthropic Messages requires resent history |
| `createThread`, `isPartialTranscript` | Adapter session policy | Side metadata only | No Anthropic message-content equivalent |
| `title`, `agent-instruction-state` | None | Side metadata only | Not assistant-visible response content |
| Notion `maxInputTokens` in response | Request `max_tokens` | No | It is an input/context limit and arrives after generation |

### Response/SSE mapping

| Notion source | Anthropic SSE target | Mapping quality |
|---|---|---|
| Appended `agent-inference` | `message_start`, then `content_block_start` | Good for one observed text block, subject to late model/usage |
| Initial `.value[0].content` | First `text_delta` | Direct |
| Each `x` patch on inference content | Subsequent `text_delta` | Direct |
| Final `model` alias | `message.model` | Wire-valid string, not provider-authentic |
| Final `inputTokens` | Initial or terminal `usage.input_tokens` | Buffer for accurate first-event placement, or emit terminally to correct the accumulated final message; tokenizer semantics may differ |
| Final `outputTokens` | `message_delta.usage.output_tokens` | Good as a Notion-reported final total; not necessarily Anthropic-tokenized |
| `cachedTokensRead` | Initial or terminal `cache_read_input_tokens` | Terminal correction is structurally supported; cache semantics remain unverified |
| `cachedTokensCreated` | Initial or terminal `cache_creation_input_tokens` | Terminal correction is structurally supported; cache semantics remain unverified |
| `serverTimeTo*` | None | Preserve only in adapter telemetry/extensions |
| `maxContextTokens`, `maxInputTokens` | None in standard SSE | Preserve only as side metadata |
| Successful `patch-sync` / completed thread outcome | `stop_reason: end_turn` | Reasonable heuristic, not an explicit source stop reason |
| Notion `type:error` with `message`,`code` | SSE `error` | Structurally possible; taxonomy unobserved |
| `premium-feature-unavailable` with no model call or `patch-sync` | Downstream error | Live application failure; target status/type and retryability are adapter policy |
| `record-map` | None | Merge into adapter history store, never emit as assistant text |
| Notion step/trace IDs | Anthropic `msg_` / `toolu_` IDs | Generate adapter IDs and retain a private correlation map |

### Agent/CLI field matrix

The classification below describes what a gateway can obtain from this evidence. **Native** means the value is explicitly present and can be preserved; it does not mean Anthropic produced it. **Reconstructible** means it can be deterministically derived without inventing model behavior. **Synthetic** means the adapter must generate or policy-select it. **Absent** means neither buffering nor reframing can recover it from these captures.

| Agent/CLI field or behavior | Wire-format compatibility | Semantic compatibility | Class | Agent consequence |
|---|---|---|---|---|
| Visible assistant text and chunk order | Complete `text_delta` lifecycle can be emitted | Exact visible text and order survive | **Native** | Text display and accumulation work |
| Assistant role, text-block index, start/stop framing | Complete SDK 0.121.0 event shape can be built | Faithful for the observed one-block assistant inference | **Reconstructible** | A text-only SDK consumer can parse the turn |
| Message ID | Any valid stable `msg_` string fits the wire type | No Anthropic message identity is present | **Synthetic** | Keep a private correlation map; never claim provider provenance |
| `message.model` | A `notion/<alias>` string is wire-valid | The captured alias is not a provider model ID | **Synthetic** | Model routing and capability checks cannot rely on it as Anthropic identity |
| Terminal input/output/cache numbers | SDK usage fields can carry the integers | They remain Notion-reported; tokenizer, billing, cache lifetime, and TTL semantics are unverified | **Native** | Useful telemetry, unsafe for Anthropic billing equivalence |
| Terminal success state | Content close and `message_stop` can be derived after verified `patch-sync` | Proves product/transport completion, not why the model stopped | **Reconstructible** | A text client can finish cleanly |
| `stop_reason: "end_turn"` | Wire-valid | No captured stop cause supports it | **Synthetic** | Agent loops must treat it as gateway policy, not model evidence |
| Other stop causes (`tool_use`, `pause_turn`, limits, refusal, compaction) | The protocol has wire values | No corresponding live Notion cause is captured | **Absent** | Branching an agent loop on them would be fabricated |
| Thinking block text | SDK block/delta shape is known | No thinking block is exposed in the five successful traces | **Absent** | Do not emit or reconstruct chain-of-thought |
| Thinking signature and redacted-thinking data | Wire types require opaque values | Opaque verification/continuity values cannot be regenerated | **Absent** | Signed-thinking continuation cannot be supported |
| Tool definitions and JSON schemas | Request wire shape is known | Connector names and booleans are not executable schemas | **Absent** | A general tool-capable CLI cannot advertise captured tools faithfully |
| Model `tool_use` (`id`, `name`, `input`, `caller`) and `input_json_delta` | Response shape is known | Auto-load results do not prove a model decision boundary | **Absent** | Do not enter a tool-execution loop from current traces |
| User `tool_result` pairing and `is_error` | Request shape is known | No provider-style invocation/result pair or resume turn is captured | **Absent** | Exact tool replay and recovery are unavailable |
| Quota failure | A downstream JSON error or SSE `error` can be constructed | Live Notion failure is known; Anthropic taxonomy, HTTP status, and retryability are unverified | **Reconstructible** | Fail closed and do not append synthetic success |
| Top-level streamed error envelope | An Anthropic `error` frame can be constructed from the static Notion error branch | That Notion branch remains unobserved live | **Reconstructible** | Fail closed and do not append synthetic success |
| Complete prior messages and role order | `messages[]` wire shape is known | The partial continuation omits canonical history | **Absent** | Stateless resume is not viable |
| Gateway-owned continuation ledger | A complete next request can be built if every turn is recorded from turn one | Semantics are preservable only for fields the gateway actually owns, including exact tool/opaque blocks | **Reconstructible** | A terminating gateway can resume; a response-only proxy cannot |
| Compaction request controls | Beta header and edit shape are known | No captured Notion request supplied them | **Absent** | Adding them is a new target-side policy, not translation |
| Compaction block, delta, opaque state, stop cause, and iteration ledger | Beta response wire shape is known | None of the required state exists in the live traces | **Absent** | Native compaction resume cannot be reproduced |
| Adapter-created summary/compaction policy | A gateway can send a new target request | The summary and policy originate in the gateway | **Synthetic** | Viable only as explicitly new behavior with provenance |

## Token accounting: timing and granularity

The three legacy successful HAR transactions expose token accounting only in the final metadata patch:

| Metric | Auto | Medium continuation | No thinking |
|---|---:|---:|---:|
| Input tokens | 22,560 | 4,862 | 3 |
| Output tokens | 8 | 8 | 9 |
| Cached tokens read | 20,864 | 4,859 | 0 |
| Cached tokens created | 0 | 16,967 | 20,567 |
| Server time to first token | 3,627.21 ms | 2,468.94 ms | 953.74 ms |
| Max context tokens | 400,000 | 400,000 | 400,000 |
| Max input tokens | 272,000 | 272,000 | 272,000 |

The latest hook adds two distinct successful calls:

| Metric | Latest short success | Latest long success |
|---|---:|---:|
| Input tokens | 29,911 | 34,685 |
| Output tokens | 18 | 7 |
| Cached tokens read | 29,580 | 29,580 |
| Cached tokens created | 12,484 | 28,949 |
| Max context tokens | 200,000 | 200,000 |
| Max input tokens | 160,000 | 160,000 |

The latest HAR independently carries the long-success values and does not contain the hook-only short success. The two quota calls have no per-inference usage because no `agent-inference` was returned.

There are no token counts in the request body or per NDJSON line, text delta, content block, prior message, tool result, retrieved document, or sampling/compaction iteration. The thread record contains a cumulative `usage_summary` with input/output/cache/credit/completion counters, but it is not a per-message ledger.

This creates a timing mismatch with Anthropic SSE:

- Anthropic's message object carries initial usage in `message_start`.
- Notion reveals `inputTokens`, final model, and cache totals after all text chunks.
- Current Anthropic `message_delta.usage` can receive cumulative input, cache, and output totals, and the current SDK accumulator overwrites non-null input/cache fields in the final message.
- The final Notion model alias still cannot be corrected through `message_delta`.

An adapter has only three choices:

1. **Buffered accurate-first-event replay:** buffer the entire Notion stream, then emit the final model and Notion-reported usage in `message_start` followed by replayed text deltas. This makes the first event internally consistent but is no longer live.
2. **Live terminally corrected stream:** start SSE immediately with estimated/zero initial usage and an adapter-defined or best-known model label, then emit all final Notion usage counters in `message_delta.usage`. The Anthropic TypeScript SDK 0.121.0 accumulator applies those terminal corrections, but the already-delivered `message_start` remains approximate and its model cannot be revised.
3. **Precomputed accounting:** maintain a full target-model history and run a target-token counter before generation. That can estimate Anthropic input usage, but it still will not equal Notion's provider-specific accounting or hidden server context.

Some captured final aliases are categorized by Notion as non-Anthropic families, so relabeling any captured token/cache counts as genuine Anthropic billing usage would be especially misleading. They may be retained as adapter telemetry, not claimed as Anthropic-provider usage.

The high Notion context/cache counts relative to the short visible user messages—including 20,567 cache-created tokens beside three input tokens in the no-thinking turn—show that server-managed prompt/context construction is not recoverable from visible transcript text. Similar field names do not establish Anthropic's rule that total input is the sum of uncached, cache-created, and cache-read categories.

## Message and tool semantics

### Simple text

Simple assistant text is the strongest mapping. The captured state identifies an assistant inference, its text block, incremental append chunks, final model, and terminal synchronized state. An adapter can create a one-block Anthropic-shaped SSE response without exposing Notion's state machinery; buffering determines whether final metadata is available in the first frame, not whether text itself can stream.

### Tools

The automatic stream contains three `agent-tool-result` objects. Each combines:

- tool name/type;
- module and function;
- input arguments;
- applied state and timings;
- result output;
- auto-load phase;
- optional artifact/thread-operation metadata.

These are context auto-load results that occur before the assistant inference. They are not captured as an assistant deciding to call a tool, and client telemetry reports zero model tool calls. Mapping them to an Anthropic `tool_use` followed by a user `tool_result` would fabricate role boundaries and causality.

Even for a future model-initiated Notion tool event, the captured request does not contain Anthropic-style tool definitions or input schemas. A loss-aware adapter must therefore:

- omit current auto-load steps from standard assistant SSE and retain them in a side log; and
- refuse standard `tool_use` conversion until a live trace establishes distinct invocation ID, model-requested input, result, error, ordering, and resume semantics.

### Stop semantics

The observed Notion inference has no explicit field equivalent to Anthropic `stop_reason` or `stop_sequence`. A complete `patch-sync` plus a completed thread outcome supports an adapter policy of `end_turn`, but does not distinguish natural completion from a product-specific stop, policy stop, or hidden fallback.

No captured evidence supports mapping to `max_tokens`, `stop_sequence`, `tool_use`, `pause_turn`, `refusal`, or `model_context_window_exceeded`.

### Error and cancellation

Recovered browser code shows three different paths:

- An in-stream Notion event with `type: "error"`, `message`, and `code` is converted by the wrapper into an error result.
- Non-200 HTTP responses use a structured failure path.
- Fetch abort becomes a distinct status-0 aborted result.

Two application-level quota streams were captured, both inside HTTP-200 NDJSON. They contain `premium-feature-unavailable`, no model call, no per-inference usage, and no `patch-sync`. They must become downstream errors rather than empty assistant messages. The target error status/type is gateway policy: this evidence does not justify a native Anthropic `rate_limit_error`, determine retryability, or expose partial-model semantics because no model call occurred.

The distinct top-level `error`, non-200 transport, abort, and cancellation paths remain unobserved. Anthropic SSE has no standard `cancelled` stop reason.

## Thread history and record-map sufficiency

### New-thread capture

The automatic response's thread record lists 10 message IDs and returns 10 `thread_message` records. Their step types cover config, context, user, instruction state, full-record-map marker, three tool results, title, and assistant inference. For this one newly created turn, the returned records are sufficient to order the observed Notion steps.

They are still not a full Anthropic prompt because they omit Notion's hidden system instructions, complete tool definitions, server-side retrieval policy, and any context inserted outside these records.

### Continuation capture

The explicit continuation is decisively incomplete as standalone history:

- Request: `isPartialTranscript: true` and only `config`, `context`, `updated-config`, and current `user` steps.
- Returned thread record: 14 ordered message IDs.
- Returned `thread_message` records: only 3 records (`config`, `agent-turn-full-record-map`, `agent-inference`).

The record map is therefore a sparse update, not a full conversation export. The wrapper field named `role: "editor"` is a Notion record permission role, not a conversational `user`/`assistant` role and must never be mapped as one.

To reconstruct continuation history, an adapter would need one of:

- a canonical ledger maintained from thread creation;
- all prior `thread_message` records from Notion's record cache/sync traffic;
- a documented full-thread export endpoint; or
- an explicit user-provided history.

None is fully present in the standalone continuation request/response pair.

## Context compaction feasibility

### What SSE conversion does not do

Context compaction is an **input-history operation**. Converting output NDJSON into SSE does not by itself compact anything. The next Anthropic request still needs a complete, ordered message history or a deliberate summary replacing part of it.

### Current Anthropic server-side contract

Anthropic's current server-side compaction contract requires more than aggregate usage:

- The beta flow uses `anthropic-beta: compact-2026-01-12` and adds a `compact_20260112` edit under `context_management.edits`, optionally with `instructions`, `pause_after_compaction`, and an `{type:"input_tokens",value:...}` trigger. The documented default is 150,000 input tokens and the minimum configurable trigger is 50,000.
- A compaction produces a `compaction` content block with nullable summary `content` and nullable opaque `encrypted_content`. Any non-null opaque value must be round-tripped verbatim.
- Streaming uses the ordinary content-block lifecycle and can carry one `compaction_delta` containing the complete summary and opaque state; a pause-after-compaction flow can finish with `stop_reason: "compaction"`.
- The beta start message additionally requires nullable `context_management` and `diagnostics`. The beta `message_delta` event additionally carries top-level nullable `context_management`; this is distinct from `delta.container` and from the stop fields.
- Both beta start and delta usage shapes add nullable `fallback_credit` and `iterations`. `iterations` is a typed ledger rather than a copy of the top-level totals.
- Beta `usage.iterations` distinguishes `message` sampling iterations from `compaction` iterations. A compaction iteration's token cost is separate from the context size it closed and is excluded from top-level usage totals.

No captured Notion request or response has these fields. A Notion terminal token total cannot synthesize summary content, opaque state, an iteration ledger, or a truthful compaction stop reason.

Anthropic's client does not have to supply a live token count on every request or text delta; the Anthropic server can count the submitted history and evaluate the trigger. The problem here is different: the standalone Notion continuation does not contain that complete history, while its usage total arrives only after generation and includes server-managed context whose tokenizer and composition are not exposed. An adapter limited to this standalone capture can compact only by retaining and counting its own target-model ledger before the next request.

Recovered Notion code proves a different internal feature surface. Module 974336 in `DNUtl-aded9c38b3afccc3.5619f5ab715080cf.js` defines `ai_agent_progressive_transcript_compression_threshold` with `threshold: 0.9`, `createSummaryThreshold: 0.5`, and `updateSummaryInterval: 0.2`. Module 286564 in `92549-5e2927c3bb373299.d40f9b206d0e7460.js` reduces `agent-transcript-summary`, `summarize-transcript`, `summarize-transcript-record-map`, `summarize-transcript-error`, and `activate-transcript-compaction` steps. This is strong evidence for a Notion-managed transcript-summarization surface, not evidence of Anthropic's wire contract.

The latest hook forced `createSummaryThreshold=0.01`, `updateSummaryInterval=0.005`, `compactThreshold=0.02`, and `recentSearchToolResultsToKeep=-1` on four requests. Those are instrumented values, not product defaults. No summary or activation marker appeared. That absence does not complete the compaction test: the long content became prior history only on the next request, and both following requests were rejected by quota before any model call. A successful post-long-history request was not captured. The correct status remains **not observed / insufficient capture**.

### Compaction from the captured Notion request alone

**Verdict for these standalone captures: not feasible with semantic fidelity.** Missing inputs include:

- Prior messages in partial continuation requests.
- Hidden Notion system/developer instructions.
- Complete tool definitions and unresolved tool state.
- Full retrieved document/search contents and their inclusion order.
- Per-message or preflight target-model token counts.
- A documented way to submit an adapter-generated compacted summary back into Notion's server-managed thread context.

Notion's final `inputTokens` is useful as after-the-fact pressure telemetry, but it arrives too late and cannot identify which earlier content is safe to remove.

### Compaction with an adapter-owned ledger

**Verdict: feasible as a new adapter feature, not a lossless translation.** It requires the adapter to own the conversation from its first turn and store a normalized ledger independently of Notion.

The ledger should preserve:

- user and assistant text blocks;
- original Notion step IDs in a private correlation table;
- ordered tool-use/tool-result pairs once their semantics are proven;
- model/effort selection and terminal outcome;
- source provenance and hashes for any summary;
- non-message control state separately from conversational content.

A safe compaction policy would:

1. Count or estimate tokens using the **target Anthropic model**, not Notion's reported count.
2. Trigger before the target context limit with reserved output/tool headroom.
3. Preserve system instructions, current user input, recent turns, unresolved tool calls/results, safety constraints, and user-stated requirements verbatim.
4. Summarize only a closed prefix of older completed turns.
5. Store summary provenance, covered message range, hash, source token estimate, and compactor model/version.
6. Revalidate tool pairing and role alternation after replacement.
7. Keep the original ledger locally for audit/rollback.
8. Insert the summary according to an explicit adapter policy in the next Anthropic request; do not pretend Notion supplied it.

No faithful compaction push-back path is evidenced by the observed request schema. That is a limit of these captures, not proof that other Notion states or builds lack an internal resume/compaction path. A separate Anthropic-facing agent can use Notion captures as input if the adapter owns and normalizes the history.

### Live evidence needed to settle Notion compaction

The current five successful text turns and two quota outcomes cannot decide Notion's broader compaction behavior. A decisive live trace would need a successful request after the long history and preserve, without private content, the ordered step-type and field schemas for:

- summary creation and later summary update;
- `activate-transcript-compaction` and any pre/post-compaction record-map changes;
- the next resumed request, showing whether compacted state or a server-side handle is supplied;
- any opaque state, trigger/limit fields, stop/outcome signal, and per-iteration usage;
- interruption, retry, or `summarize-transcript-error` behavior; and
- enough before/after history metadata to prove what was retained, replaced, or server-rehydrated.

Only then could an adapter test whether Notion's native steps have a lossless mapping to Anthropic beta `compaction` blocks/deltas or merely a product-specific summarization workflow. Until then the correct status is **not observed / insufficient capture**, not **Notion cannot do it**.

## Agent and CLI viability

**Text-stream CLI: viable.** A client that only renders assistant text, observes qualified Notion usage, and treats completion as adapter policy can consume the projected SDK 0.121.0 stream.

**General Anthropic agent loop: not viable from a standalone captured response.** A real loop must branch on native stop causes, execute model-selected tools, preserve exact tool-use/result pairing, retain thinking signatures and redacted blocks, resend complete ordered history, and carry any container or opaque context state. The five successful text traces do not contain those fields. Wire-valid JSON does not repair that semantic deficit.

**Stateful terminating gateway: conditionally viable.** It must own the canonical conversation ledger from turn one; preserve roles, tools, signatures, redacted/opaque blocks, and target response IDs exactly; tokenize for the target model; distinguish source telemetry from target billing; and introduce any summary or Anthropic compaction request as explicit new gateway behavior. Its downstream stream can be SDK-compatible, but it is not a transparent Notion-to-Anthropic translation.

## Transparent-proxy verdict

Transparent compaction is **not possible** in a stateless NDJSON-to-SSE response proxy. Such a proxy sees neither the full continuation history nor the tool/signature/opaque state needed to prove a valid next request, and it cannot derive Anthropic compaction blocks, stop semantics, or iteration usage from Notion's terminal counters.

Compaction becomes possible only when the component is a **stateful terminating gateway** that owns the full ledger and deliberately invokes or implements a target-side compaction policy. That changes request semantics and creates new state. It should be presented and audited as gateway behavior, never as a lossless wire conversion.

## Converter state machine

### Recommended mode: buffered, text-only, strict

```text
state = INIT
notion_state = []
text_chunks = []
metadata = {}
record_store = {}
failure = null

for each decoded Notion NDJSON event:
    if event.type == "patch-start":
        require state == INIT
        notion_state = deep_copy(event.data.s)
        if notion_state contains premium-feature-unavailable:
            failure = application_quota_failure
            state = FAILED
            break
        state = COLLECTING

    else if event.type == "patch":
        require state == COLLECTING
        for op in event.v:
            apply_notions_patch(notion_state, op)

            if op appends an agent-inference:
                require exactly one text block for strict mode
                remember inference step identity
                append initial block content to text_chunks

            else if op.o == "x" and op.p is that inference content path:
                append op.v to text_chunks

            else if op targets final inference metadata:
                store model, usage, timing, limits, and failover metadata

            else if op appends agent-tool-result:
                store in side metadata; do not emit Anthropic tool_use

    else if event.type == "record-map":
        merge sparse records into record_store
        if response state contains premium-feature-unavailable:
            failure = application_quota_failure
            state = FAILED
            break

    else if event.type == "patch-sync":
        require state == COLLECTING
        verify notion_state equals event.data.s
        verify concat(text_chunks) equals final inference text
        require final model and token metadata for strict usage mode
        state = COMPLETE

    else if event.type == "error":
        failure = {code: event.code, message: event.message}
        state = FAILED
        break

    else:
        retain unknown event in side log; do not invent SSE semantics

if state == COMPLETE:
    msg_id = generate_stable_private_mapping(inference_step_id)
    model_label = adapter_model_label(final_model_alias)

    emit message_start(msg_id, model_label,
                       input_tokens=final.inputTokens,
                       output_tokens=initial_provider_value_or_zero)
    emit content_block_start(index=0, type="text")
    for chunk in text_chunks:
        emit content_block_delta(index=0, text_delta=chunk)
    emit content_block_stop(index=0)
    emit message_delta(stop_reason=adapter_success_policy,
                       input_tokens=final.inputTokens,
                       cache_read_input_tokens=final.cachedTokensRead,
                       cache_creation_input_tokens=final.cachedTokensCreated,
                       output_tokens=final.outputTokens)
    emit message_stop()

else if state == FAILED:
    if SSE has not started:
        return mapped non-200 Anthropic JSON error
    else:
        emit error(type="api_error", message=safe_message)
        close stream without message_stop

else:
    fail closed: incomplete Notion stream
```

### Live mode differences

A live adapter can emit `message_start` and text deltas as soon as `agent-inference` appears, but it must choose a model label and initial input usage before Notion reveals final metadata. It should explicitly advertise the first-frame values as estimated/non-authoritative outside the Anthropic wire object. At the terminal delta it can emit all captured Notion usage counters; the Anthropic TypeScript SDK 0.121.0 accumulator applies those to the final message. The earlier frame itself remains unchanged, and the late final model alias cannot be corrected through `message_delta`.

### Tool-capable extension

Do not implement it from the current auto-load trace. After a genuine model-tool trace exists, require a paired state machine:

```text
assistant tool decision
  -> tool_use content block with stable toolu_ ID
  -> message_delta(stop_reason="tool_use")
  -> message_stop
application executes tool
  -> next Anthropic request has user tool_result referencing that toolu_ ID
```

If Notion combines invocation and result into one event without a visible model decision boundary, a standard Anthropic round trip remains lossy.

## Verdict matrix

| Capability | Verdict | Conditions |
|---|---|---|
| Simple text to Anthropic-shaped SSE | **Yes** | Use one `agent-inference` text block and a version-pinned lifecycle projection |
| Simple text with accurate usage and model from the first SSE event | **Yes, buffered only** | Wait for final Notion metadata, then replay chunks |
| Low-latency live text SSE | **Yes, lossy initial metadata** | Emit terminal input/cache/output corrections; the first-frame usage and model remain estimated or adapter-defined |
| Genuine Anthropic provider semantics | **No** | Captured models are Notion aliases and provider calls are hidden |
| Input-token accounting | **Partial** | Final Notion total can correct the accumulated message, but is late and may use a different tokenizer/context |
| Output-token accounting | **Good for the captured Notion total** | Map final total to `message_delta.usage.output_tokens`; it is not per chunk or proven Anthropic-equivalent |
| Cache accounting | **Numerically present, semantics unverified** | Terminal correction is possible; similar field names do not prove Anthropic cache-billing semantics |
| Tool-use SSE | **Not proven** | Captured tools are auto-load results, not model tool decisions |
| Quota error projection | **Required, mapping policy-specific** | Two live HTTP-200 NDJSON quota failures must become downstream errors; target type/status and retryability are not captured |
| Top-level error/abort projection | **Static path only** | Browser code exposes stream, non-200, and abort branches, but those live states were not captured |
| Stop reason | **Synthetic only** | Successful Notion completion does not identify the model's stop cause |
| Thinking and signatures | **Not observed; proof unsupported** | Request effort exists, but the five successful responses expose no reasoning content or signatures |
| Standalone continuation request | **No** | A partial Notion request omits canonical prior history and hidden context |
| Reproduce these captured Notion turns as native Anthropic server compaction | **No from these captures** | The evidence lacks compaction control/state blocks, opaque state, stop semantics, iteration usage, and full history; broader Notion behavior remains untested |
| Adapter-owned manual compaction | **Feasible as new behavior** | Requires a canonical ledger, target-model tokenization, tool-pair preservation, and summary provenance from turn one |
| Fresh Anthropic compaction on a different backend | **Feasible as new behavior** | If the adapter owns complete history and actually calls Anthropic, Anthropic can create new compaction state; this is not recovered Notion behavior |

## Bottom line

The five captured successful text turns contain enough information to project their text as Anthropic-shaped SSE and end with captured Notion-reported token/cache integers. The two quota turns contain enough information to classify application failure, not to choose an Anthropic-native error taxonomy. None of these artifacts contains the complete state needed to reproduce genuine Anthropic semantics, make the first event fully source-accurate without buffering, continue the captured partial thread statelessly, or round-trip the turns as native Anthropic compaction. This is a conclusion about the evidence set, not a global impossibility claim about Notion. For these artifacts, a reliable agent adapter must keep its own canonical history and treat Notion's identifiers, cache counters, patch state, and final usage as a separate private sidecar. That adapter may implement manual compaction or invoke Anthropic to create fresh compaction state, but either is new adapter/backend behavior rather than a lossless translation of the observed streams.
