# Static browser-asset findings

Generated from `reference/har/baseline-full.har` on 2026-08-26 (America/Toronto).

## Scope and privacy boundary

This pass extracted embedded JavaScript, CSS, and HTML response bodies under `https://app.notion.com/_assets/`, plus the first `app.notion.com` HTML document in the HAR. It did not read or copy request headers, cookies, request bodies, or private JSON API response bodies. The extractor accesses only the request URL and the response status/content fields needed for code recovery.

Base64-encoded HAR bodies are supported and decoded before hashing. None of the 225 selected responses declared base64 encoding in this capture.

## Capture inventory

| MIME | Responses | Embedded | Unique hashes | Decoded bytes | Unique bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| `text/javascript` | 222 | 222 | 219 | 15,386,640 | 15,343,906 |
| `text/css` | 2 | 2 | 2 | 125,481 | 125,481 |
| `text/html` | 1 | 1 | 1 | 1,274,390 | 1,274,390 |
| **Total** | **225** | **225** | **222** | **16,786,511** | **16,743,777** |

Three JavaScript responses were exact byte duplicates and point to the first stored file for their SHA-256. Every manifest entry was independently rehashed against its stored file; all 225 mappings passed.

## Literal `/api/v3` strings

Seven distinct literal strings were present after normalizing escaped slash forms (`\/`, `\u002f`, and `\x2f`):

- `/api/v3`
- `/api/v3/`
- `/api/v3/authValidate`
- `/api/v3/getSkilljarProfile`
- `/api/v3/queryCollectionHTML?src=content_preview`
- `/api/v3/recordClientLoadAttempt`
- `/api/v3/recordClientLoadComplete`

Each occurred once in one unique file. None of these seven literal paths is explicitly AI-named. This does not rule out AI endpoints: a route can be assembled dynamically, passed as an operation name, or live in a lazy-loaded asset absent from this HAR.

## AI-related lexical candidates

The static identifier scan found 1,641 unique candidate symbols. Category membership overlaps:

| Category | Unique candidate symbols |
| --- | ---: |
| inference | 46 |
| transcript | 143 |
| model | 212 |
| agent | 726 |
| bounded AI naming forms | 615 |

Higher-signal names in the capture include `ai_inference`, `current_inference_id`, `inferenceContext`, `runInferenceTranscript`, `createAndNavigateToInferenceTranscriptWithConfig`, `openNewAgentChat`, `agent_service`, `ai_chat`, `ai_research_mode`, and `ai_connectors`. These are static lexical findings, not confirmed HTTP endpoint names. The JSON catalog records every matching symbol, category, occurrence count, and source file; the CSV is a flattened index.

Broad terms such as `model` and `agent` naturally produce false positives (for example, data models and browser user-agent code). The catalog intentionally preserves these candidates for later correlation with live request traces rather than claiming they are all AI implementation code.

## Reproducible outputs

- Extracted, content-addressed bodies: `reference/assets/browser-code/files/`
- Complete manifests: `asset-manifest.json` and `asset-manifest.csv`
- Literal route catalogs: `api-v3-endpoints.json` and `api-v3-endpoints.csv`
- AI-symbol catalogs: `ai-symbols.json` and `ai-symbols.csv`
- Compact totals: `scan-summary.json`
- Re-runnable extractor: `reference/scripts/extract_static_assets.mjs`

## Coverage limits

- This is a faithful extraction of one HAR, not proof that every current Notion asset was loaded.
- Lazy-loaded chunks, code reached only by other product states, service-worker cache entries, and assets omitted from the HAR remain outside this snapshot.
- Minification and runtime string construction can hide complete endpoint paths from a literal scan.
- No semantic claim should be made from a symbol alone; correlate candidates with authorized live network traces and response behavior.
