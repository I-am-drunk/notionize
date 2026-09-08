# Making compaction work: recovered mechanism + concrete design

The Notionize brief asks, using Claude Code's "history too big → compact" behavior as the
reference, how to make context management actually work for Notion's AI. This note (1)
documents the compaction mechanism recovered from the client, (2) explains why the earlier
live-capture never observed it firing, and (3) gives a concrete, parameterized design to
make it fire correctly and behave well — plus how an external stream consumer should handle
it.

All identifiers/values below are verified in the archived runtime chunks (prettified copies
under `reference/desktop-decompile/web-runtime-pretty/`).

## 1. The mechanism Notion actually ships: progressive transcript compression

Notion already implements a three-stage context-management ladder called **progressive
transcript compression** (Statsig config `ai_agent_progressive_transcript_compression_threshold`).
Confirmed from the transcript reducer (chunk 92549), the config resolver (chunk 38161), and
the i18n labels (chunk 26775):

| Stage | Transcript step type | i18n definition |
|---|---|---|
| Create summary | `summarize-transcript` (request) → `agent-transcript-summary` (result) | "Request issued to generate a summary of the transcript so far." / "Running summary of the conversation produced by the agent." |
| Update summary | new `agent-transcript-summary` with same `lastStepId` | replaces the prior summary in place |
| Compact | `activate-transcript-compaction` | "Applies the latest transcript summary to reduce context size." |

Supporting steps: `summarize-transcript-record-map` ("Record map gathered while preparing
the transcript summary.") and `summarize-transcript-error`.

### 1.1 Reducer behavior (chunk 92549)

A summary step carries `{ lastStepId, summary }`. On arrival:

```js
if (type === "agent-transcript-summary") {
  const i = findLastIndex(s => s.type === "agent-transcript-summary" && s.lastStepId === step.lastStepId);
  if (i !== -1) {
    const prevNonEmpty = prev.summary.trim().length > 0;
    const newNonEmpty  = step.summary.trim().length > 0;
    if (!(prevNonEmpty && !newNonEmpty)) list[i] = step; // replace unless clobbering with empty
    return list;
  }
  list.push({ ...step });                                // else append
}
```

So summaries are keyed by `lastStepId`: the same coverage point is **updated in place** as
the turn proceeds; a new coverage point **appends** a new summary. `activate-transcript-
compaction` is appended as a marker; downstream rendering uses the latest non-empty
`agent-transcript-summary` (chunk 38161 scans for `type === "agent-transcript-summary" &&
summary.trim().length > 0` from the end) as the compacted context.

## 2. The five knobs (`contextManagementConfiguration`)

Schema (chunk 6132), an optional sub-object of the thread config; all numeric:

| Knob | Meaning | Units |
|---|---|---|
| `compactThreshold` | usage fraction at which to compact (apply summary, drop raw history) | 0–1 of context window |
| `createSummaryThreshold` | usage fraction at which to first create a summary | 0–1 |
| `updateSummaryInterval` | how often to refresh the running summary | 0–1 step of window |
| `maxToolResultTokens` | per-tool-result truncation cap | tokens |
| `recentSearchToolResultsToKeep` | how many recent search tool-results to keep verbatim | count (`-1` = all) |

### 2.1 Resolution order and defaults (chunk 38161, verified)

```js
clamp = x => Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : undefined;

// compactThreshold u:
u = clamp(cfg.compactThreshold)
  ?? clamp(Statsig("ai_agent_progressive_transcript_compression_threshold", "threshold"))
  ?? 1;                                            // DEFAULT 1.0

resolved = {
  compactThreshold:      u,
  createSummaryThreshold: cfg.createSummaryThreshold ?? Statsig(...,"createSummaryThreshold") ?? Math.max(0, u - 0.1),
  updateSummaryInterval:  cfg.updateSummaryInterval  ?? Statsig(...,"updateSummaryInterval")  ?? 0.1,
};
```

Priority: **client `contextManagementConfiguration` → Statsig dynamic config → hardcoded
default.** Context window (chunk 38161): `maxInputTokens ?? maxContextTokens ?? 272000`
tokens. Other observed literals: `createSummaryThreshold: 0.5`, `updateSummaryInterval:
0.2`, `maxToolResultTokens: 50000`, `recentSearchToolResultsToKeep: -1`.

The debug HUD renders the absolute trigger points as `threshold * window`, e.g. "Next
compact: `round(compactThreshold * 272000)` tokens".

## 3. Why live compaction was never observed (root cause)

The archive's verdict was **"configuration observed; runtime compaction unobserved."** With
the mechanism recovered, the cause is now explainable, not mysterious:

1. **The default `compactThreshold` is `1.0`.** Absent a Statsig override or a client
   config, compaction only triggers at ~100% of a 272k-token window. Normal sessions never
   reach that, so no `activate-transcript-compaction` ever appears.
2. **`createSummaryThreshold` defaults to `compactThreshold − 0.1` ≈ 0.9.** Summaries also
   only begin near the ceiling by default.
3. **The forced-low-threshold attempts hit quota first.** The two long-history probes
   returned HTTP-200 `premium-feature-unavailable` (credit rate-limit) **before** inference
   ran, so the turn never reached a point where a summary/compaction step could be emitted.
4. **Production requests don't send the knobs.** `contextManagementConfiguration` appears
   only in the debug-config chunk; the store initializes all five fields to `void 0`
   (chunk 38161 lines 670–674). Real behavior is therefore whatever the Statsig config says,
   which the client cannot see in a static capture.

None of this means compaction is broken. It means the trigger is (a) server-controlled via
Statsig and (b) defaulted high, and the capture conditions never crossed it on a
credit-eligible account.

## 4. Design: make Notion's built-in compaction fire and behave well

Goal: a Claude-Code-like experience — the agent summarizes and compacts proactively so long
histories keep working, without truncating important recent context. Everything here uses
the shipped knobs; no protocol changes are required.

### 4.1 Recommended thresholds

For a 272k window, set the client `contextManagementConfiguration` (or the equivalent
Statsig config) to a **summarize-early, compact-before-limit** ladder:

| Knob | Recommended | Rationale |
|---|---|---|
| `createSummaryThreshold` | **0.5** | Start the running summary at half-full so a good summary already exists before pressure builds. Matches an observed literal. |
| `updateSummaryInterval` | **0.1** | Refresh every ~27k tokens (10%) so the summary tracks recent turns. |
| `compactThreshold` | **0.8** | Compact at ~218k/272k — well before the hard limit and before quota-adjacent failures, leaving headroom for the final answer. |
| `maxToolResultTokens` | **50000** | Cap giant tool outputs (search dumps, file reads) so a single result can't blow the window. |
| `recentSearchToolResultsToKeep` | **5** | Keep the last few search results verbatim; older ones fold into the summary. (`-1` keeps all — avoid for long sessions.) |

Invariant to preserve: `createSummaryThreshold < compactThreshold`, and both in `(0,1)`; the
resolver clamps to `[0,1]` but does not enforce the ordering, so choose them consistently
(a summary must exist before compaction applies it).

### 4.2 The ladder in operation

1. At 50% usage → `summarize-transcript` request fires mid-turn; result is an
   `agent-transcript-summary { lastStepId, summary }`.
2. Every +10% → a new `agent-transcript-summary` with the **same** `lastStepId` replaces the
   previous one (rolling update), so the summary stays current at ~O(1) transcript cost.
3. At 80% usage → `activate-transcript-compaction`: the latest non-empty summary becomes the
   compacted context and raw pre-summary steps stop being resent, dropping token usage back
   down. The session continues instead of erroring at the limit.
4. Throughout, tool results are truncated to `maxToolResultTokens` and only the last
   `recentSearchToolResultsToKeep` search results are kept raw.

### 4.3 Where to set it

- **Preferred (no bypass concerns):** if you control the account, request that Notion enable
  the Statsig config `ai_agent_progressive_transcript_compression_threshold` with the values
  above for your space. This is the intended production path and is server-authoritative.
- **Client-config path:** the thread config accepts `contextManagementConfiguration` with
  these fields, so a Notion-web/desktop client can send them per-thread. This is the same
  path the debug UI uses; it is an override, not an exploit, and it does not change metering
  (see §6).

## 5. How an external consumer should handle compaction (adapter design)

The repo's `tools/notion-anthropic-sse/` adapter projects Notion's NDJSON patch stream into
Anthropic-style SSE. Today it fails closed on summary/compaction states. To make external
consumers robust to long sessions, handle the three step types explicitly:

- **`agent-transcript-summary`**: treat as authoritative context replacement keyed by
  `lastStepId`. Maintain a single "current summary" slot per `lastStepId`; replace on update
  (mirroring the reducer's replace-unless-empty rule). Do **not** emit it as assistant
  message text.
- **`activate-transcript-compaction`**: on this marker, drop the raw steps up to the summary's
  `lastStepId` from any locally reconstructed history and substitute the current summary. This
  keeps a re-sent history within the window, matching server behavior.
- **`summarize-transcript` / `-record-map` / `-error`**: lifecycle/telemetry; surface
  `-error` as a non-fatal warning and continue with the last good summary.

Because Anthropic's own API has a server-side context-compaction/`context_management` concept,
an adapter can map Notion's compacted transcript onto that shape, but it must be labelled
**synthetic** unless a real compaction transition is captured — consistent with this
archive's existing fidelity discipline.

### 5.1 If you build your own harness (Claude-Code-style)

When wrapping the raw `runInferenceTranscript` stream (rather than relying on Notion's
server ladder), replicate the ladder locally: track running token usage against the 272k
window; at `createSummaryThreshold` issue a summary turn; refresh every `updateSummaryInterval`;
at `compactThreshold` replace history with the summary before the next request. This is
exactly what Claude Code does when it reports "history too big" and compacts — the recovered
Notion knobs give you the same three control points.

## 6. Interaction with usage metering (important caveat)

Compaction reduces *tokens per request*, which reduces cost and latency, but it does **not**
bypass credit metering. Eligibility (`getAIUsageEligibilityV2`) and the rate-limit verdict
(`creditRateLimitVerdict`) are enforced server-side per `spaceId` before inference streams
(see `notion-ai-integration-research.md` §5). A well-tuned ladder keeps sessions *working*
and *cheaper*; it does not grant free usage. The two archived quota HARs show enforcement
firing regardless of transcript size.

## 7. Validation plan

To move the archive verdict from "unobserved" to "observed," capture on a credit-eligible
account with these knobs set and record a session that crosses `createSummaryThreshold`:

1. Set `contextManagementConfiguration = { createSummaryThreshold: 0.5, updateSummaryInterval:
   0.1, compactThreshold: 0.8, maxToolResultTokens: 50000, recentSearchToolResultsToKeep: 5 }`.
2. Drive a long tool-heavy session until usage passes 50%, then 80%.
3. Confirm in the NDJSON stream: a `summarize-transcript` request, one or more
   `agent-transcript-summary` results (with a rolling `lastStepId`), and at 80% an
   `activate-transcript-compaction`, followed by a **drop** in `transcriptTokenCount`.
4. Re-run the sanitizer and extend `inference-protocol.json` with the summary/compaction
   observation; only then update the top-level verdict.

Until such a capture exists, the honest status remains **mechanism fully recovered
statically; live activation still unobserved** — but the recovery makes clear the feature is
present, server-gated, and tunable, and gives exact values to make it fire.
