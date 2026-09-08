# Full runtime static audit

## Scope and evidence boundary

This audit verified and scanned all 2,149 archived runtime JavaScript chunks (93,843,729 bytes), 35 runtime CSS chunks, and 198 directly referenced public assets. It records static occurrences, not runtime execution or private server behavior.

No source snippets, prompts, payloads, full URLs, queries, headers, cookies, credentials, or user/account identifiers are copied into the generated catalogs.

## Static callsites versus observed traffic

A direct client API event in this audit means only that an archived bundle contains a literal `eventName` at a recognized API-wrapper callsite. It is not an observed request, response, successful invocation, or server endpoint implementation.

Likewise, provider/model lexemes and protocol fields are shipped-client string evidence, not proof of the active upstream route or model. Observed traffic belongs to the separate sanitized HAR/live-capture analyses and is not counted or replayed here.

## Precise findings

- Runtime archive integrity: verified; CSS archive integrity: verified; referenced-asset integrity: verified.
- Direct literal client API callsite pairs: 1098; high-signal AI-named pairs: 131; broader AI-adjacent/ambiguous named pairs: 164.
- Direct streaming callsite pairs: 14; AI-named or adjacent streaming pairs: 9.
- Literal query-free /api/v3 pathnames: 8. These are independent of the event-name callsite catalog because the generic client can construct routes dynamically.
- OpenRouter quoted-lexeme occurrences: 0 across 0 files. Zero is negative evidence for these archived browser chunks only.
- Existing roster model identifiers checked: 31; exact quoted runtime matches: 31.
- Referenced JavaScript/module assets: 5; filename-evident worker assets: 3; WASM assets: 2; runtime CSS assets: 35.

## Protocol string and field highlights

| Candidate | Match | Occurrences | Files |
| --- | --- | ---: | ---: |
| callStreamApi | exact identifier | 31 | 20 |
| application/x-ndjson | exact quoted value | 0 | 0 |
| text/event-stream | exact quoted value | 0 | 0 |
| patch-start | exact quoted value | 3 | 2 |
| patch-sync | exact quoted value | 6 | 2 |
| inputTokens | exact identifier | 26 | 5 |
| outputTokens | exact identifier | 27 | 6 |
| cachedTokensRead | exact identifier | 17 | 5 |
| cachedTokensCreated | exact identifier | 10 | 3 |
| contextManagementConfiguration | exact identifier | 26 | 1 |
| compactThreshold | exact identifier | 12 | 2 |
| runningSummaryText | exact identifier | 11 | 2 |
| previousAttemptValues | exact identifier | 5 | 1 |
| isModelFailover | exact identifier | 0 | 0 |
| retryInference | exact identifier | 3 | 1 |
| reasoningEffort | exact identifier | 115 | 20 |
| agent-tool-result | exact quoted value | 115 | 35 |
| registered-tool-call | exact quoted value | 1 | 1 |

The two MIME values above have no exact quoted occurrence in this runtime-chunk archive. That does not override transport evidence in other archived client files or live captures; it only bounds this chunk set.

## Provider lexeme occurrences

| Lexeme | Occurrences | Files | Interpretation |
| --- | ---: | ---: | --- |
| OpenRouter | 0 | 0 | distinctive provider name |
| Anthropic | 495 | 34 | provider name or model identifier segment |
| OpenAI | 530 | 56 | provider name or model identifier segment |
| AWS Bedrock | 31 | 8 | provider platform name |
| Amazon | 14 | 4 | ambiguous generic company/platform name |
| Google Vertex | 105 | 15 | ambiguous product/geometry word |
| Gemini | 255 | 28 | model family or product name |
| Fireworks | 339 | 23 | provider name; also an ordinary plural noun |
| Baseten | 144 | 22 | distinctive provider name |
| DeepSeek | 113 | 16 | distinctive model/provider name |
| Kimi | 136 | 15 | model family or name |
| xAI | 51 | 22 | provider name |
| Mistral | 13 | 4 | model/provider name; also an ordinary noun |
| Cohere | 6 | 3 | provider name; also an ordinary verb |

## False-positive controls and limits

- Provider evidence is counted only as a bounded lexeme inside short quoted strings; broad case-insensitive source substrings are not treated as provider proof.
- AI event classification uses camel-case segments, so an embedded sequence such as the `Ai` in `Airtable` is not AI evidence.
- Generic model, prompt, transcript, summary, and workflow-credit names remain labeled adjacent or ambiguous rather than high-signal.
- Exact fields and state values are lexical candidates. They are not presented as reconstructed object schemas or demonstrated state machines.
- Provider/model names in browser code do not establish upstream routing, model deployment, credentials, or direct browser-to-provider traffic.

## Generated catalogs

- `full-runtime-static-audit.json`: complete static catalog and verified local asset indexes.
- `full-runtime-ai-api-events.csv`: AI-named and AI-adjacent direct client API callsite candidates.
- `full-runtime-model-evidence.csv`: existing-roster correlations and heuristic public-model candidates.
- `full-runtime-provider-evidence.csv`: provider lexeme counts, including explicit zero-count evidence.

