# Capture intake

This archive discovers captures dynamically. A new owner-only raw `*.har` placed directly in `reference/har/` is picked up without editing a Python file. Files ending in `.sanitized.har` are always excluded from raw discovery.

Run the commands below from `/Users/irene/Documents/Notionize`.

## Intake a new capture

1. Save the capture with a unique, descriptive raw name such as `ai-probe-model-effort.har`. Do not use `.sanitized.har` for a raw file.

2. Make the raw capture owner-only before any pipeline script reads it:

   ```sh
   chmod 600 reference/har/ai-probe-model-effort.har
   ```

3. Create its sanitized derivative. For one known file:

   ```sh
   python3 reference/har/sanitize_har.py \
     reference/har/ai-probe-model-effort.har
   ```

   To ingest every newly arrived raw capture that lacks a derivative:

   ```sh
   python3 reference/har/sanitize_har.py --discover --missing-only
   ```

   The output is named `ai-probe-model-effort.sanitized.har`. The sanitizer never overwrites the raw source; it validates in memory, writes a mode-`0600` temporary file, reloads and revalidates it, then atomically installs the derivative.

4. Run the local regression check:

   ```sh
   python3 reference/scripts/check_capture_pipeline.py
   ```

   This uses temporary synthetic captures to verify discovery, sanitized exclusion, missing-pair failure, mode and symlink rejection, malformed-HAR rejection, sanitizer validation, raw/sanitized protocol parity, and duplicate inference-transaction detection. It then performs the same pair/parity checks read-only against the current archive.

5. Rebuild derived catalogs:

   ```sh
   python3 reference/scripts/catalog_har_endpoints.py
   python3 reference/scripts/extract_inference_protocol.py
   ```

6. Regenerate the archive inventory/checksum manifest only after every capture and derived report is final.

## Discovery and safety rules

- Discovery is non-recursive and deterministic. Only files directly under `reference/har/` whose names end in `.har` are candidates.
- `.sanitized.har` is excluded case-insensitively. A sanitized-looking file can never be fed back into the sanitizer as a raw input.
- Every raw and sanitized HAR must be a regular, non-symlink file with exact mode `0600`. Unsafe permissions or a HAR-named symlink stop the pipeline with a filename-only error.
- Control characters and case-insensitive raw-name collisions are rejected.
- The inference extractor requires a derived `<raw-stem>.sanitized.har` for every discovered raw capture. It fails rather than silently omitting a newly arrived or unsanitized capture.
- Every loaded file must be valid JSON with a HAR object, `.log` object, `.log.entries` array, and request/response objects for every entry.
- `--discover --missing-only` is intentionally incremental. To re-sanitize all raw captures after sanitizer logic changes, omit `--missing-only`:

  ```sh
  python3 reference/har/sanitize_har.py --discover
  ```

## Preserved validations

Sanitization removes credential/session headers and HAR cookie objects, redacts structured identifiers, and preserves timing, body shapes, response prose, model values, and event types. The derivative is reloaded as JSON and checked again before replacement.

Inference extraction independently builds the same privacy-safe summary from each raw/sanitized pair and requires exact equality. A mismatch aborts the report. Inference transactions are fingerprinted with SHA-256 over request `postData.text` and the decoded response stream; duplicates remain in coverage but are annotated with `duplicate_of` rather than counted as distinct transactions.

Endpoint catalog outputs never copy headers, cookies, query values, request bodies, or response bodies. They retain only endpoint structure and aggregate transport metadata.

## Expected failure modes

- **Missing sanitized partner:** run the sanitizer for the named raw capture, then rerun the regression.
- **Mode is not `0600`:** inspect ownership, then use `chmod 600` if the file is the intended local capture.
- **Malformed HAR:** re-export the capture; do not hand-edit the raw archive.
- **Raw/sanitized summary mismatch:** stop and inspect sanitizer/extractor compatibility. Do not bypass the comparison.
- **More than one `runInferenceTranscript` entry in one HAR:** supported. The protocol extractor records each entry separately under `captures[].inference_entries[]`, assigns a per-entry outcome, and deduplicates only when both request and decoded-response SHA-256 values match. If entry counts or raw/sanitized summaries diverge, stop and inspect the pair rather than collapsing the transactions.
- **Duplicate transaction:** this is not an error. The report records the earlier capture in `duplicate_of` and preserves both capture files for provenance.

Raw HARs, screenshots containing account/workspace context, and captured signed-in HTML remain private local evidence even when pattern scans pass. Use sanitized derivatives for analysis or sharing.
