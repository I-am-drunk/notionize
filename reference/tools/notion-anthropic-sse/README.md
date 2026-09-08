# Notion NDJSON to Anthropic SSE proof adapter

This offline proof converts a privacy-safe Notion `agent-inference` NDJSON stream into deterministic, synthetic Anthropic-shaped Messages SSE pinned to the `@anthropic-ai/sdk` 0.121.0 contract. It is not an authentic Anthropic provider response. It performs no network requests and does not read cookies, headers, identifiers, or `record-map` contents.

## Run

From this directory:

```sh
python3 adapter.py fixtures/simple-text.ndjson
python3 adapter.py fixtures/simple-text.ndjson \
  --sse-out converted.sse \
  --fidelity-out converted-fidelity.json
python3 -m unittest -v test_adapter.py
```

Only use redacted or synthetic input. The included fixture and goldens contain synthetic text and control data.

## Accepted scope

The strict input lifecycle is `patch-start`, zero or more `patch` events, one `record-map`, then terminal `patch-sync`. Patch paths are applied from the protocol document root, including `/s/...`. The proof accepts Notion `a` and `x` operations; an `a` operation with no `v` member clears its target, while an explicit JSON null remains a value. It requires exactly one appended `agent-inference` and exactly one text content block. Incremental chunks must reproduce the terminal text, and the fully reconstructed state must equal `patch-sync.data.s`.

The adapter buffers through `patch-sync`, then emits `message_start`, one text content block, terminal `message_delta`, and `message_stop`. The message ID is fixed for deterministic proof output. The model is labeled `notion/<alias>` so it is not mistaken for an Anthropic model identifier.

Known Notion summary, compaction, and failure transcript steps are rejected even if the same stream also contains an otherwise convertible text inference. The check runs after every patch operation, so a semantic marker cannot be hidden by clearing it before `patch-sync`. Pre-inference `agent-tool-result` control steps remain reconstructible side state and are deliberately omitted rather than fabricated as Anthropic model tool calls.

## Fidelity limits

- Input and cache counts are Notion-reported terminal metadata retimed into buffered `message_start`; cache semantics are unverified.
- Mapping Notion `inputTokens` to Anthropic `input_tokens` is structural only. It is not proven to be Anthropic's uncached-token category, so the Anthropic rule that total input equals input plus cache-created plus cache-read tokens must not be applied as provider-authentic accounting.
- Terminal `message_delta.usage` repeats the cumulative input/cache totals and supplies final output usage so current Anthropic SDK streams can overwrite the initial usage object with complete totals.
- Notion context/input limits, timing fields, and failover metadata have no equivalent in this proof stream and are dropped; preserve them separately if downstream policy needs them.
- Required SDK fields for which the Notion source provides no evidence—message/delta `container` and `stop_details`, text-block `citations`, plus detailed usage, geography, server-tool, cache-creation, and service-tier metadata—are emitted explicitly as null. Required nullable cache-count keys are also retained when a source counter is unavailable.
- `end_turn` is an adapter policy because the observed Notion stream has no equivalent stop reason.
- Thinking, signatures, tool use, compaction, errors, cancellation, request/history conversion, and lossless round trips are unsupported.
- `agent-tool-result` control steps are retained only in reconstructed Notion state and never fabricated as Anthropic `tool_use` blocks.

Unsupported or incomplete input fails closed with exit status 2 in CLI use. The tests explicitly cover non-text blocks including `compaction`, and verify that an in-stream Notion error is rejected before any synthetic success SSE is rendered. Machine-readable limitations are written with `--fidelity-out` and are pinned by the golden fixture.
