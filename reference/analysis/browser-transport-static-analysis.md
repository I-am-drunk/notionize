# Browser transport static analysis

## Scope

This note correlates the live HAR observations with the exact minified browser code recovered from the baseline capture. It documents only code present in the archived files; it does not infer unobserved backend behavior. Identifiers below are webpack module IDs and minified local names, so they are build-specific.

## Inference wrapper

The archived `ActionBarUI` chunk contains the sole literal `runInferenceTranscript` symbol in the captured assets. Module `855225` exports an async wrapper that:

1. Accepts `environment`, request `data`, `userId`, `tracking`, an optional `AbortSignal`, and an `onResponse` callback.
2. Calls `environment.api.callStreamApi` with `eventName: "runInferenceTranscript"`.
3. Adds workspace/cell-navigation headers derived from `data.spaceId`.
4. On a successful response, verifies that the returned value is async-iterable.
5. Iterates every decoded event, immediately forwards it to `onResponse`, and also accumulates it in an array.
6. Converts an in-stream event whose `type` is `error` into `{error: {message, code}}`.
7. Distinguishes an aborted request from other HTTP failures.

This matches the live request path `POST /api/v3/runInferenceTranscript` and explains why the UI can update once per NDJSON event while retaining the complete event list for terminal handling.

Evidence file:

- `reference/assets/browser-code/files/ActionBarUI-3af4c749ef60c361.a6a2c3747583f6d8.js`
- SHA-256: `a6a2c3747583f6d87f28ea55eab7a03d652d4323aeb3fb46a76fc5b56e910d17`

## Generic API request construction

Module `154109` in the archived main application chunk builds Notion API requests. For a supplied `eventName`, it constructs the URL as the configured API root plus `/<eventName>`, uses `POST`, serializes `data` as JSON, and optionally adds only three tracking query parameters: `throttledMs`, `src`, and `trigger`.

The header builder adds, when applicable:

- Notion client/platform version headers.
- `X-Notion-User-Flow` tracking context.
- `x-notion-active-user-header`.
- Active workspace/cell headers such as `x-notion-space-id` or the short-ID alternative.
- Caller-supplied headers.

This is consistent with the HAR: inference uses cookie-backed same-origin authentication plus Notion active-user/workspace headers rather than a browser-visible vendor API key.

Evidence file:

- `reference/assets/browser-code/files/app-336b936d762cd279.4e905c19dea9370f.js`
- SHA-256: `4e905c19dea9370fac1c6e540a9106c687e97cb12776f6daed535e4c0d8a9291`

## Fetch and NDJSON decoding

Module `219228` in the archived `ClientFramework` chunk implements the transport used by `callStreamApi`:

- For JSON-stream requests it sets `Content-Type: application/json` and `Accept: application/x-ndjson`.
- It calls `fetch` with `credentials: "same-origin"`, the serialized body, caller `AbortSignal`, and optional `keepalive`.
- Only HTTP status 200 enters the success parser; other statuses take the structured failure path.
- A response requested as `jsonStream` remains streaming only when the response `Content-Type` is exactly `application/x-ndjson`; otherwise the code falls back to ordinary JSON parsing.
- The streaming parser reads `response.body.getReader()`, incrementally decodes UTF-8 with `TextDecoder`, buffers a partial trailing line, splits on newline boundaries, trims empty lines, and yields `JSON.parse(line)` for each complete line.
- At EOF it parses one final non-empty buffered line.
- Parser failure cancels the reader; an abort becomes a distinct status-0 `AbortedError` result.

The browser relies on the Fetch implementation to transparently decompress the HAR-observed `Content-Encoding: zstd` body before this UTF-8 line parser runs.

Evidence file:

- `reference/assets/browser-code/files/ClientFramework-42e7bfb754ab4885.b5377cd8e42d5dfe.js`
- SHA-256: `b5377cd8e42d5dfe0d48de1988ce841a5c3e15242d2c34e077534643f1d70661`

## Correlation with live behavior

The static implementation and both live inference traces agree on the end-to-end browser path:

```text
UI transcript/config builder
  -> runInferenceTranscript wrapper
  -> callStreamApi(format = jsonStream)
  -> POST same-origin /api/v3/runInferenceTranscript
  -> Fetch returns application/x-ndjson
  -> incremental UTF-8 newline parser
  -> async iterator
  -> onResponse(event) for live UI/state updates
  -> accumulated terminal event list
```

The captured stream event semantics (`patch-start`, `patch`, `record-map`, `patch-sync`) are established by the HARs. Their literal dispatch implementation was not present in the loaded static chunks, so this archive does not claim to contain the complete patch reducer or every lazy-loaded AI module.

## Security and architecture conclusion

The captured browser is a client of Notion's own `/api/v3` facade. It submits transcript/configuration state and consumes a Notion NDJSON state-patch stream. No archived browser code or observed request establishes direct browser-to-model-provider authentication. Provider selection, exact upstream request transformation, system prompts, and provider response handling remain behind Notion's server boundary.
