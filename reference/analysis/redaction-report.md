# HAR redaction report

Generated 2026-08-27 from local files only. Raw HAR evidence was read but never modified.

## Current outputs

| Sanitized HAR | Entries | Bytes | SHA-256 |
|---|---:|---:|---|
| `ai-probe-auto.sanitized.har` | 37 | 743,815 | `aa7f6330fa24f810310abb66b9d0c35a37e87e693d269581b01b65d41041e65c` |
| `ai-probe-gpt56-sol-medium.sanitized.har` | 31 | 399,178 | `b82dc64bdb88b52530cc28ffe2ce70c6bc146074bdd0f9ebd1c07ab16f157329` |
| `ai-probe-gpt56-sol-no-thinking.sanitized.har` | 44 | 710,061 | `09ff40903a0a46a2897770ddecc24abb5cb3d44cfc14881f9d80112c7fa244e8` |
| `ai-session-settled-full.sanitized.har` | 239 | 6,522,524 | `46f293c5d4d45f7e06edf665a8a5bf5686f75b1b6cc445be5fda4c351ec9b689` |
| `baseline-full.sanitized.har` | 317 | 37,217,467 | `b25b27e77d976867cb5292a6088c7d1b36eaee1ea3edc8ca21775b593e76ba2f` |
| `notion-live-session-2026-08-27.sanitized.har` | 522 | 38,582,035 | `cfd5e6a6a04d99fbf4251f4064d8717a7dbf8205dff0fd524359719b67b50501` |

All six sanitized HARs remain owner-only (`0600`). They are analytical derivatives, not public-release artifacts.

## Aggregate sanitizer result

Across 1,190 entries, deterministic regeneration:

- removed 5,226 recognized credential/session/trace headers;
- removed 19,058 structured HAR cookie objects;
- rewrote URL/query/form/structured-body identifiers with stable per-file placeholders;
- preserved entry/page timing and protected response semantics required by the protocol extractor;
- redacted explicit credential-shaped substrings in two otherwise opaque request bodies and nine otherwise opaque response documents; and
- finished with zero recognized sensitive headers and zero HAR cookie objects.

The opaque-body safeguard matters because third-party exporters can label textual telemetry or multipart content as `application/octet-stream`. The sanitizer now applies bearer/JWT/API-token pattern redaction even when the surrounding body cannot be structurally decoded. A regression test covers this case.

## Supported body formats

The sanitizer handles:

- JSON and JSON-valued query parameters;
- NDJSON and SSE-style line streams;
- form-encoded request bodies;
- textual base64 responses;
- HTML/XML credential patterns;
- opaque text credential patterns;
- URL/query values, header lists, HAR cookie arrays, dynamic JSON keys, and common identifier fields.

It preserves response prose, model values, and event-type values when needed for evidence, except that explicit credential patterns take priority. It does not write a source-to-placeholder reversal map.

## Validation

Reproduction:

```sh
python3 reference/har/sanitize_har.py --discover
python3 reference/scripts/check_capture_pipeline.py
```

Observed validation:

- six raw/sanitized pairs discovered;
- byte-for-byte deterministic sanitized regeneration;
- all pairs reload as JSON;
- raw/sanitized privacy-safe inference summaries match for every pair;
- five capture-pipeline regression tests pass, including multi-entry outcome handling and opaque request credential redaction;
- bearer, JWT, and explicit Notion/API-token scans report zero hits in all sanitized HARs and schema-only hook derivatives.

## Limits

Pattern and schema checks cannot prove anonymity. Arbitrary prose, an unusual identifier, or an unrecognized secret format can evade automatic rules. Hostnames and non-identifier path text remain available for endpoint analysis. Response prose is deliberately retained in sanitized HARs, so raw and sanitized HARs must both be reviewed before any external sharing.
