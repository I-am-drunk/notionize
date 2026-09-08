# Notionize reference archive

This directory contains the evidence and reproducible derivatives supporting `../NOTION_AI_BROWSER_AND_ENDPOINT_ARCHIVE.md`.

## Start here

1. Read `../NOTION_AI_BROWSER_AND_ENDPOINT_ARCHIVE.md` for the consolidated architectural result; its capture totals predate the latest HAR/runtime additions.
2. Read `analysis/coverage-audit.md` for current counts, evidence overlap, and remaining gaps.
3. Read `analysis/full-runtime-static-audit.md` for verified runtime coverage and the distinction between static callsites and observed traffic.
4. Read `analysis/live-capture-state-coverage.md` for the latest four-request instrumented hook evidence and `analysis/live-capture-compaction-findings.md` for the compaction verdict.
5. Read `analysis/har-semantics.md` for the original deep request/stream analysis and `analysis/inference-protocol-findings.md` plus `inference-protocol.json` for the current six-HAR, seven-entry scope.
6. Read `analysis/stream-field-compatibility.md` and its JSON matrix for streaming, token/cache, stop/error, tool, reasoning, continuation, and compaction boundaries.
7. Use `analysis/network-endpoints.json`, `analysis/network-summary.json`, and `analysis/ai-endpoints.json` for the current six-HAR network catalog.
8. Run the offline buffered text-only proof in `tools/notion-anthropic-sse/`; it documents rather than hides lossy semantics.
9. Treat `analysis/ARCHIVE_MANIFEST.sha256` as a point-in-time snapshot until the final inventory rebuild described below.

## Handling tiers

### Restricted private evidence

- `har/*.har` without `.sanitized` — cookies, identifiers, prompts, response prose, record maps, and analytics may be present.
- `captures/raw/*.json` — live-hook URLs, identifiers, and request/response body material may be present.
- `screenshots/ai-gpt56-network.png` — visibly contains account/page context.
- `assets/browser-code/files/main-document.*.html` — signed-in boot/page content.

These artifacts are mode `0600` and must remain local unless manually redacted and reviewed.

### Privacy-reduced derivatives

- `har/*.sanitized.har`
- `analysis/inference-protocol.json`
- `analysis/stream-field-compatibility.{json,md}`
- `captures/sanitized/*.schema.json`
- `analysis/live-capture-privacy-scan.json`
- `analysis/live-capture-latest-privacy-scan.json`
- endpoint/model catalogs and Markdown analyses

Sanitized HARs remove HAR cookie objects and recognized credential/session headers, and the capture pipeline checks bearer/JWT/Notion-token patterns; response prose is deliberately preserved, so review before sharing. The sanitized live-hook schema derivatives are stricter: they emit allowlisted structure, counts, and selected numeric metrics without URLs, identifiers, headers, cookies, arbitrary body strings, or model aliases.

### Vendor browser code

`assets/browser-code/files/` contains the baseline HAR recovery, including one restricted HTML document. `assets/browser-code/runtime-chunks/files/`, `runtime-css/files/`, and `referenced-assets/files/` contain the verified expanded runtime archive. The code/assets are archived for local analysis and hashing; their presence does not grant redistribution rights.

## Directory map

```text
reference/
├── README.md
├── analysis/
│   ├── ARCHIVE_MANIFEST.sha256
│   ├── archive-inventory.json
│   ├── coverage-audit.md
│   ├── ai-endpoints.{json,csv}
│   ├── network-endpoints.{json,csv}
│   ├── network-summary.json
│   ├── model-roster.{json,csv}
│   ├── full-runtime-static-audit.{json,md}
│   ├── full-runtime-ai-api-events.csv
│   ├── full-runtime-model-evidence.csv
│   ├── full-runtime-provider-evidence.csv
│   ├── inference-protocol.json
│   ├── inference-protocol-findings.md
│   ├── stream-field-compatibility.{json,md}
│   ├── anthropic-sse-compatibility.md
│   ├── har-semantics.md
│   ├── browser-transport-static-analysis.md
│   ├── static-assets-findings.md
│   ├── live-capture-state-coverage.md
│   ├── live-capture-compaction-findings.md
│   ├── live-capture-privacy-scan.json
│   ├── live-capture-latest-privacy-scan.json
│   ├── redaction-report.md
│   └── final-validation.md
├── assets/browser-code/
│   ├── files/                       # baseline HAR recovery
│   ├── asset-manifest.{json,csv}
│   ├── runtime-chunks/
│   │   ├── runtime-chunk-manifest.json
│   │   └── files/                   # 2,149 JavaScript chunks
│   ├── runtime-css/
│   │   ├── runtime-css-manifest.json
│   │   └── files/                   # 35 CSS chunks
│   └── referenced-assets/
│       ├── referenced-assets-manifest.json
│       └── files/                   # 198 public assets
├── har/
│   ├── six raw *.har files
│   ├── six paired *.sanitized.har files
│   └── sanitize_har.py
├── captures/
│   ├── raw/                         # owner-only live-hook exports
│   └── sanitized/                   # schema-only derivatives
├── screenshots/
│   └── ai-gpt56-network.png
├── tools/
│   └── notion-anthropic-sse/
│       ├── adapter.py
│       ├── test_adapter.py
│       ├── README.md
│       └── fixtures/
└── scripts/
    ├── extract_static_assets.mjs
    ├── scan_full_runtime.mjs
    ├── catalog_har_endpoints.py
    ├── extract_model_roster.py
    ├── extract_inference_protocol.py
    ├── check_capture_pipeline.py
    ├── sanitize_live_capture.mjs
    ├── audit_live_capture.mjs
    └── build_archive_inventory.py
```

## Rebuild order

Run from the repository's `reference/` directory:

```sh
python3 har/sanitize_har.py --discover
python3 scripts/check_capture_pipeline.py

node scripts/extract_static_assets.mjs \
  har/baseline-full.har \
  assets/browser-code

python3 scripts/catalog_har_endpoints.py
python3 scripts/extract_model_roster.py
python3 scripts/extract_inference_protocol.py
node scripts/scan_full_runtime.mjs
(cd tools/notion-anthropic-sse && python3 -m unittest -v test_adapter.py)
python3 tools/notion-anthropic-sse/validate_har_replay.py
python3 scripts/build_archive_inventory.py
```

The checked-in `inference-protocol.json` covers all six paired HARs and supports multiple inference entries per HAR, including the three-entry live-session HAR. Rebuild/audit the four-request live-hook schema separately using the commands in `analysis/live-capture-state-coverage.md`; its hook-only short success is intentionally not folded into the HAR dataset.

The inventory builder must run last because it snapshots every other deliverable.

## Integrity check

From the Notionize repository root:

```sh
shasum -a 256 -c reference/analysis/ARCHIVE_MANIFEST.sha256
```

The manifest intentionally excludes itself and the generated inventory file to avoid recursive hashes. See the inventory metadata for its exact rules.

The manifest and inventory were rebuilt only after the sixth HAR, expanded runtime/CSS/referenced-asset archive, live-hook artifacts, compatibility updates, sanitizer hardening, and final documentation were complete. A passing check therefore validates the current archived paths listed by the manifest. Future edits require rebuilding both integrity files again.

## Coverage boundary

The expanded browser-code archive is complete only relative to one captured runtime manifest: 2,149/2,149 advertised JavaScript chunks, 35/35 advertised CSS chunks, and 198/198 directly referenced public assets are present and hash/byte verified. The baseline HAR recovery remains a different, narrower set of 225 embedded responses representing 222 unique bodies. Neither set proves coverage of other builds, cohorts, bootstrap/service-worker-only bodies, server code, or future assets.

The six raw HARs contribute 1,190 catalog observations, 418 unique method/endpoint pairs, and 23 hosts. They contain seven `runInferenceTranscript` observations, but observation count is not distinct-turn count: the settled-session HAR duplicates one historical transaction. Separately, the latest live hook records four instrumented target requests across two hook sessions—two successes and two application-level quota failures. Hook targets 2–4 are the same requests as the three live-session HAR entries (request starts align within 156 ms), target 1 is hook-only, and the earlier one-target hook artifact is target 1 again. These overlapping source counts must not be added.

The full-runtime static scan catalogs 1,098 literal client API event/method callsite pairs, including 131 high-signal AI-named pairs, 164 broader AI-adjacent pairs, and 14 streaming pairs. A static callsite proves shipped client code, not an observed request or implemented server route. Provider/model strings likewise prove client metadata only: zero OpenRouter lexemes in this runtime are bounded client-side negative evidence, and no captured browser request establishes direct provider routing or credentials.

All four latest instrumented requests carry context-management thresholds, yet no compaction/summary activation marker or before/after compaction transition was observed. The current conclusion is **configuration observed; runtime compaction unobserved**.

The proof adapter's 24 tests pass. `tools/notion-anthropic-sse/validate_har_replay.py` reproduces the content-silent whole-HAR check: across all six sanitized HARs it converts five successful observations (four distinct successes plus one duplicate) into a buffered text-only Anthropic-style SSE projection and rejects both quota bodies before emitting any SSE frame. It does not establish provider authenticity, request/history conversion, native tool/reasoning/compaction semantics, application-error/cancellation parity, or a lossless round trip.

The archive is not a complete copy of Notion, every endpoint, every AI model/mode, every account/region experiment, or any private server-to-provider behavior.
