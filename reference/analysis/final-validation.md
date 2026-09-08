# Final archive validation

Validated locally on 2026-08-27. Raw evidence was never modified and no authenticated request was replayed.

## Result

**PASS with explicit evidence limits.** The archive regenerates, all captured success streams reconstruct exactly, both HTTP-200 quota streams are classified as errors, all archived runtime manifests verify, the compatibility proof fails closed outside its narrow subset, private evidence retains owner-only modes, and the final checksum manifest verifies every listed file.

## Reproducibility gate

The following generators were run twice and compared:

| Generator/output family | Determinism check |
|---|---|
| Six sanitized HARs | Byte-for-byte identical |
| Full-runtime static JSON/Markdown/CSVs | Byte-for-byte identical |
| Inference protocol | Identical after excluding only `generated_at` |
| Network catalogs | Identical after excluding only `generated_at` |
| Model roster | Identical after excluding only `generated_at` |
| Latest live-hook schema and privacy audit | Byte-for-byte identical |

The dynamic timestamp exclusions are metadata-only; all substantive fields matched.

## Syntax and table validation

- 56 JSON/HAR artifacts parsed successfully.
- 9 CSV artifacts parsed successfully and were non-empty.
- Python source used by the sanitizer, capture pipeline, protocol extractor, adapter replay, and tests compiled successfully.
- The JavaScript full-runtime scanner and live-capture sanitizer/auditor completed successfully.

## Capture pipeline and privacy

All six raw HARs and all six sanitized counterparts are regular owner-only files with mode `0600`. All three raw live-hook captures are also `0600`. The signed-in HTML document and private network screenshot are `0600`.

Sanitizer validation over 1,190 HAR entries reports:

- zero remaining recognized sensitive-header names;
- zero remaining HAR cookie objects;
- zero bearer-token pattern hits in sanitized HAR/schema derivatives;
- zero JWT pattern hits in sanitized HAR/schema derivatives; and
- zero explicit Notion/API-token pattern hits in sanitized HAR/schema derivatives.

The final privacy sweep found two JWT-shaped values inside otherwise opaque request bodies whose exporter MIME was `application/octet-stream`. The sanitizer was hardened to apply explicit bearer/JWT/API-token redaction even when an opaque text body cannot be structurally decoded. All six derivatives were regenerated, the scan then returned zero, and a dedicated regression test was added. Raw HARs were unchanged.

Five capture-pipeline tests pass. They cover:

- dynamic raw/sanitized discovery and pairing;
- multi-entry inference outcomes, including success, quota error, and incomplete state;
- duplicate transaction detection without collapsing entries;
- rejection of public modes, symlinks, malformed HARs, and sanitized-as-raw inputs; and
- explicit credential redaction in opaque request bodies.

The latest schema-only live-hook audit passes with four targets, 584 capture events, complete chunk/byte reconciliation, two successes, two application-level quota failures, no unknown structural enums, and zero hits in its URL/path/identifier/email/token/cookie/forbidden-key scans.

## Runtime archive integrity

| Archive set | Expected | Present | Bytes | Result |
|---|---:|---:|---:|---|
| Runtime JavaScript | 2,149 | 2,149 | 93,843,729 | Pass |
| Runtime CSS | 35 | 35 | 386,883 | Pass |
| Directly referenced assets | 198 | 198 | 26,277,470 | Pass |

Every manifest path, byte count, and SHA-256 revalidated. The static audit then reproduced 1,098 literal client API event/method pairs, 131 high-signal AI-named pairs, 164 broader AI-adjacent pairs, 14 streaming pairs, zero quoted OpenRouter occurrences, and exact runtime matches for all 31 roster aliases.

## Inference protocol validation

`inference-protocol.json` schema version 2 covers six raw/sanitized pairs and supports multiple inference entries per HAR.

| Check | Result |
|---|---:|
| HAR inference observations | 7 |
| Successful observations | 5 |
| Application-error observations | 2 |
| Distinct HAR transactions after deduplication | 6 |
| Duplicate observations | 1 |
| HTTP-error observations | 0 |
| Raw/sanitized safe-summary matches | 6 / 6 |
| Successful patch replays matching `patch-sync` | 5 / 5 |
| Quota streams with no sync/inference/usage | 2 / 2 |

The five successful observations represent four distinct HAR successes because one historical success was exported twice. The live hook adds one hook-only short success; after reconciling source overlap, the complete evidence set represents five distinct successes and two distinct quota failures.

## Anthropic projection validation

The offline adapter test suite passes 24/24 tests. It verifies patch semantics, exact event order, text reconstruction, terminal usage correction, explicit null contract fields, deterministic output, fidelity warnings, and fail-closed handling for malformed lifecycle, errors, compaction/summary states, failure states, non-text/multiple inference, state mismatch, moved/replaced inference, and post-inference tool results.

The content-silent HAR replay script inspected all six sanitized HARs:

| Replay result | Count |
|---|---:|
| Inference entries found | 7 |
| Successful entries converted | 5 |
| Terminal usage matches | 5 |
| Quota entries rejected before SSE | 2 |
| Unexpected outcomes | 0 |

SSE event counts for the five converted observations were 9, 9, 10, 9, and 8. No prompt or response text was printed or written by the validator.

This validates SDK-0.121.0-shaped text projection, not provider authenticity. Stop reason, provider identity, cache/billing semantics, native thinking/tools, complete continuation history, and compaction remain synthetic, unsupported, or unobserved as documented in the compatibility report.

## Final checksum step

After every report, script, sanitizer derivative, and compatibility artifact was finalized, the inventory builder regenerated:

- `analysis/archive-inventory.json`; and
- `analysis/ARCHIVE_MANIFEST.sha256`.

The integrity files exclude themselves from recursive hashing. The final inventory contains 2,688 hashed files totaling 321,124,439 bytes. Running the manifest check from the Notionize root reports 2,688/2,688 listed files as `OK`. Any future edit requires rebuilding both files.

## Remaining caveats

- A finite captured runtime proves completeness only against that manifest, not all Notion builds or server code.
- Sanitized HARs preserve response prose and remain private-by-default despite passing pattern checks.
- Static API/provider/model strings prove shipped client metadata, not live invocation or private upstream routing.
- The forced low compaction thresholds produced no live compaction marker, but the only post-long-history attempts failed at quota before inference. Runtime compaction remains **not observed / insufficient capture**.
- The archive contains no source-authentic stop reason, Anthropic compaction block, thinking signature, or demonstrated model-selected tool lifecycle.
