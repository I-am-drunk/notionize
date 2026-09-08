#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error("usage: node sanitize_live_capture.mjs RAW_CAPTURE OUTPUT_SCHEMA");
  process.exit(2);
}

if (path.resolve(inputPath) === path.resolve(outputPath)) {
  throw new Error("input and output paths must differ");
}
const rawStat = fs.lstatSync(inputPath);
if (!rawStat.isFile() || rawStat.isSymbolicLink()) {
  throw new Error("raw capture must be a regular, non-symlink file");
}
const rawMode = (rawStat.mode & 0o777).toString(8).padStart(3, "0");
if (rawMode !== "600") {
  throw new Error(`raw capture must be mode 0600; observed ${rawMode}`);
}

const rawBytes = fs.readFileSync(inputPath);
const capture = JSON.parse(rawBytes.toString("utf8"));
if (!Array.isArray(capture.events)) throw new Error("capture.events must be an array");

const SAFE_PHASES = new Set([
  "fetch-error",
  "hook-error",
  "hook-installed",
  "request",
  "response-chunk",
  "response-end",
  "response-start",
]);

const EXACT_MARKERS = [
  "agent-transcript-summary",
  "activate-transcript-compaction",
  "summary-inference",
  "summarize-transcript",
  "summarize-transcript-error",
  "premium-feature-unavailable",
  "error",
];

const SAFE_NDJSON_TYPES = new Set([
  "patch-start",
  "patch",
  "record-map",
  "patch-sync",
  "error",
]);

const SAFE_STEP_TYPES = new Set([
  "activate-transcript-compaction",
  "agent-debug-error",
  "agent-inference",
  "agent-instruction-state",
  "agent-record-map",
  "agent-records-updated",
  "agent-search-query-generation",
  "agent-tool-result",
  "agent-transcript-summary",
  "agent-turn-full-record-map",
  "agent-turn-start",
  "config",
  "context",
  "cumulative",
  "debug-inference",
  "error",
  "eval-result",
  "everything",
  "premium-feature-unavailable",
  "product",
  "patch",
  "patch-start",
  "patch-sync",
  "record-map",
  "retry",
  "summarize-transcript",
  "summarize-transcript-error",
  "summarize-transcript-record-map",
  "text",
  "title",
  "tool-use",
  "unavailable",
  "updated-config",
  "user",
  "user-injected",
  "wait",
  "workflow",
]);

const SAFE_STATUS_VALUES = new Set([
  "aborted",
  "cancelled",
  "completed",
  "error",
  "failed",
  "in_progress",
  "pending",
  "rejected",
  "unavailable",
]);

const RELEVANT_FIELDS = new Set([
  "activationMode",
  "agent_inference_count",
  "basic_ai_credits",
  "cachedTokensCreated",
  "cachedTokensRead",
  "cached_input_tokens_created",
  "cached_input_tokens_read",
  "completion_count",
  "compactThreshold",
  "contextManagementConfiguration",
  "createSummaryThreshold",
  "credits_by_type_unit",
  "error",
  "exempt_ai_credits",
  "finishedAt",
  "inputTokens",
  "input_tokens",
  "isModelFailover",
  "lastStepId",
  "maxContextTokens",
  "maxInputTokens",
  "maxToolResultTokens",
  "model",
  "outputTokens",
  "output_tokens",
  "previousAttemptValues",
  "premium_ai_credits",
  "preview_ai_credits",
  "recentSearchToolResultsToKeep",
  "runningSummaryText",
  "stopReason",
  "summary",
  "summaryStepId",
  "transcriptContextUsage",
  "transcriptTokenCount",
  "type",
  "updateSummaryInterval",
  "usage_summary",
]);

const USAGE_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cachedTokensRead",
  "cachedTokensCreated",
  "maxContextTokens",
  "maxInputTokens",
  "transcriptTokenCount",
  "transcriptContextUsage",
];

function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function increment(record, key, amount = 1) {
  record[key] = (record[key] || 0) + amount;
}

function safeType(type, allowlist, fallback) {
  return typeof type === "string" && allowlist.has(type) ? type : fallback;
}

function decodeResponse(events) {
  const chunkEvents = events
    .filter((event) => event.phase === "response-chunk")
    .sort((a, b) => (a.chunkIndex || 0) - (b.chunkIndex || 0));
  const chunks = chunkEvents.map((event) => Buffer.from(event.bytesBase64 || "", "base64"));
  return { chunkEvents, chunks, bytes: Buffer.concat(chunks) };
}

function parseNdjson(buffer) {
  const parsed = [];
  let unparsed = 0;
  for (const line of buffer.toString("utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      parsed.push(JSON.parse(line));
    } catch {
      unparsed += 1;
    }
  }
  return { parsed, unparsed };
}

function collectStringStats(value) {
  const lengths = [];
  const visit = (current) => {
    if (typeof current === "string") {
      lengths.push(current.length);
    } else if (Array.isArray(current)) {
      current.forEach(visit);
    } else if (current && typeof current === "object") {
      Object.values(current).forEach(visit);
    }
  };
  visit(value);
  return {
    string_count: lengths.length,
    total_characters: lengths.reduce((sum, length) => sum + length, 0),
    maximum_string_characters: lengths.length ? Math.max(...lengths) : 0,
  };
}

function collectNestedTypeCounts(values) {
  const counts = {};
  const visit = (current) => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (!current || typeof current !== "object") return;
    if (Object.hasOwn(current, "type")) {
      increment(counts, safeType(current.type, SAFE_STEP_TYPES, "__OTHER_STEP_TYPE__"));
    }
    Object.values(current).forEach(visit);
  };
  values.forEach(visit);
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function collectStatuses(values) {
  const counts = {};
  const visit = (current) => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (!current || typeof current !== "object") return;
    if (typeof current.status === "string") {
      increment(counts, SAFE_STATUS_VALUES.has(current.status) ? current.status : "__OTHER_STATUS__");
    }
    Object.values(current).forEach(visit);
  };
  values.forEach(visit);
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function collectRelevantFieldSchema(value, scope) {
  const fields = new Map();
  const visit = (current) => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (!current || typeof current !== "object") return;
    for (const [key, child] of Object.entries(current)) {
      if (RELEVANT_FIELDS.has(key)) {
        const entry = fields.get(key) || { occurrences: 0, types: new Set() };
        entry.occurrences += 1;
        entry.types.add(valueType(child));
        fields.set(key, entry);
      }
      visit(child);
    }
  };
  visit(value);
  return [...fields.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([field, entry]) => ({
      scope,
      field,
      occurrences: entry.occurrences,
      value_types: [...entry.types].sort(),
    }));
}

function collectModelCalls(values) {
  const bestByInternalKey = new Map();
  let anonymousCounter = 0;
  const visit = (current) => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (!current || typeof current !== "object") return;
    if (["agent-inference", "agent-transcript-summary", "summary-inference"].includes(current.type)) {
      const internalKey = typeof current.id === "string" ? current.id : `anonymous-${anonymousCounter++}`;
      const score = USAGE_FIELDS.reduce(
        (sum, field) => sum + (typeof current[field] === "number" ? 1 : 0),
        0,
      );
      const existing = bestByInternalKey.get(internalKey);
      if (!existing || score > existing.score) bestByInternalKey.set(internalKey, { score, value: current });
    }
    Object.values(current).forEach(visit);
  };
  values.forEach(visit);
  return [...bestByInternalKey.values()].map(({ value }, index) => {
    const usage = {};
    for (const field of USAGE_FIELDS) {
      if (typeof value[field] === "number") usage[field] = value[field];
    }
    return {
      ordinal: index + 1,
      step_type: safeType(value.type, SAFE_STEP_TYPES, "__OTHER_STEP_TYPE__"),
      model_present: typeof value.model === "string",
      usage,
      finished_at_present: typeof value.finishedAt === "number",
      previous_attempt_count: Array.isArray(value.previousAttemptValues)
        ? value.previousAttemptValues.length
        : null,
      output_block_type_counts: collectNestedTypeCounts([value.value || []]),
    };
  });
}

function headerClass(events, headerName, fallback = "unknown") {
  const values = events
    .map((event) => event.headers?.[headerName])
    .filter((value) => typeof value === "string");
  if (!values.length) return fallback;
  if (headerName === "content-type") {
    if (values.some((value) => value.toLowerCase().startsWith("application/x-ndjson"))) {
      return "application/x-ndjson";
    }
    if (values.some((value) => value.toLowerCase().startsWith("application/json"))) {
      return "application/json";
    }
  }
  if (headerName === "content-encoding") {
    if (values.includes("zstd")) return "zstd";
    if (values.includes("gzip")) return "gzip";
    if (values.includes("br")) return "br";
  }
  return "other";
}

const phaseCounts = {};
for (const event of capture.events) {
  const phase = typeof event.phase === "string" && SAFE_PHASES.has(event.phase)
    ? event.phase
    : "__OTHER_PHASE__";
  const entry = phaseCounts[phase] || {
    event_count: 0,
    target_event_count: 0,
    with_url_count: 0,
    with_body_text_count: 0,
    with_bytes_count: 0,
    with_context_config_count: 0,
  };
  entry.event_count += 1;
  if (event.target === true) entry.target_event_count += 1;
  if (typeof event.url === "string") entry.with_url_count += 1;
  if (typeof event.bodyText === "string") entry.with_body_text_count += 1;
  if (typeof event.bytesBase64 === "string") entry.with_bytes_count += 1;
  if (event.contextConfig && typeof event.contextConfig === "object") {
    entry.with_context_config_count += 1;
  }
  phaseCounts[phase] = entry;
}

const sessionOrdinals = new Map();
for (const event of capture.events) {
  if (!sessionOrdinals.has(event.sessionId)) sessionOrdinals.set(event.sessionId, sessionOrdinals.size + 1);
}
const sessions = [...sessionOrdinals].map(([sessionId, ordinal]) => ({
  ordinal,
  event_count: capture.events.filter((event) => event.sessionId === sessionId).length,
  target_request_count: capture.events.filter(
    (event) => event.sessionId === sessionId && event.target === true && event.phase === "request",
  ).length,
}));

const targetRequests = capture.events.filter(
  (event) => event.target === true && event.phase === "request",
);

const transactions = targetRequests.map((request, index) => {
  const events = capture.events.filter((event) => event.requestId === request.requestId);
  const { chunkEvents, chunks, bytes } = decodeResponse(events);
  const { parsed, unparsed } = parseNdjson(bytes);
  let body = null;
  try {
    body = JSON.parse(request.bodyText);
  } catch {
    body = null;
  }
  const transcript = Array.isArray(body?.transcript) ? body.transcript : [];
  const transcriptTypeCounts = {};
  const transcriptOrder = transcript.map((entry, entryIndex) => {
    const type = safeType(entry?.type, SAFE_STEP_TYPES, "__OTHER_TRANSCRIPT_TYPE__");
    increment(transcriptTypeCounts, type);
    return { index: entryIndex, type, value_type: valueType(entry?.value) };
  });
  const userEntries = transcript.filter((entry) => entry?.type === "user");
  const requestText = typeof request.bodyText === "string" ? request.bodyText : "";
  const responseText = bytes.toString("utf8");
  const markerCounts = Object.fromEntries(
    EXACT_MARKERS.map((marker) => [marker, {
      request_body_occurrences: requestText.split(marker).length - 1,
      decoded_response_occurrences: responseText.split(marker).length - 1,
    }]),
  );
  const eventSequence = parsed.map((event) =>
    safeType(event?.type, SAFE_NDJSON_TYPES, "__OTHER_NDJSON_EVENT__"),
  );
  const eventTypeCounts = {};
  eventSequence.forEach((type) => increment(eventTypeCounts, type));
  const starts = events.filter((event) => event.phase === "response-start");
  const ends = events.filter((event) => event.phase === "response-end");
  const nestedTypeCounts = collectNestedTypeCounts(parsed);
  const modelCalls = collectModelCalls(parsed);
  const quotaMarkerObserved = markerCounts["premium-feature-unavailable"]
    .decoded_response_occurrences > 0;
  const hasTerminalPatchSync = eventSequence.at(-1) === "patch-sync";
  const outcomeClass = quotaMarkerObserved
    ? "application-level-quota-failure"
    : modelCalls.length > 0 && hasTerminalPatchSync
      ? "success"
      : "other-or-incomplete";
  const requestContextConfig = body?.debugOverrides?.contextManagementConfiguration;
  const effectiveContextConfig = requestContextConfig && typeof requestContextConfig === "object"
    ? Object.fromEntries(
        [
          "recentSearchToolResultsToKeep",
          "maxToolResultTokens",
          "compactThreshold",
          "createSummaryThreshold",
          "updateSummaryInterval",
        ]
          .filter((field) => typeof requestContextConfig[field] === "number")
          .map((field) => [field, requestContextConfig[field]]),
      )
    : {};

  return {
    ordinal: index + 1,
    session_ordinal: sessionOrdinals.get(request.sessionId),
    endpoint_class: "runInferenceTranscript",
    request: {
      body_json_parsed: body !== null,
      body_bytes: typeof request.bodyText === "string" ? Buffer.byteLength(request.bodyText) : 0,
      body_rewritten: request.bodyRewritten === true,
      create_thread: typeof body?.createThread === "boolean" ? body.createThread : null,
      is_partial_transcript:
        typeof body?.isPartialTranscript === "boolean" ? body.isPartialTranscript : null,
      transcript_entry_count: transcript.length,
      transcript_type_counts: Object.fromEntries(
        Object.entries(transcriptTypeCounts).sort(([a], [b]) => a.localeCompare(b)),
      ),
      transcript_order: transcriptOrder,
      user_payload_string_statistics: collectStringStats(userEntries.map((entry) => entry.value)),
      effective_context_management_configuration: effectiveContextConfig,
    },
    response: {
      outcome_class: outcomeClass,
      http_statuses: starts
        .map((event) => event.status)
        .filter((status) => Number.isInteger(status)),
      response_header_content_type_class: headerClass(starts, "content-type"),
      response_header_content_encoding_class: headerClass(starts, "content-encoding", "none"),
      captured_body_state: "decoded-fetch-response-stream",
      response_start_count: starts.length,
      response_end_count: ends.length,
      captured_chunk_count: chunks.length,
      captured_byte_count: bytes.length,
      parsed_ndjson_event_count: parsed.length,
      unparsed_line_count: unparsed,
      event_sequence: eventSequence,
      event_type_counts: Object.fromEntries(
        Object.entries(eventTypeCounts).sort(([a], [b]) => a.localeCompare(b)),
      ),
      allowlisted_nested_type_counts: nestedTypeCounts,
      allowlisted_status_counts: collectStatuses(parsed),
      exact_marker_counts: markerCounts,
      model_calls: modelCalls,
      has_terminal_patch_sync: hasTerminalPatchSync,
      capture_integrity: {
        chunk_indexes_contiguous: chunkEvents.every(
          (event, chunkIndex) => event.chunkIndex === chunkIndex,
        ),
        chunk_byte_lengths_match: chunkEvents.every(
          (event, chunkIndex) => event.byteLength === chunks[chunkIndex].length,
        ),
        response_end_chunk_count_matches: ends.length === 1
          && ends[0].chunkCount === chunks.length,
        response_end_total_bytes_matches: ends.length === 1
          && ends[0].totalBytes === bytes.length,
      },
    },
    relevant_field_schema: [
      ...collectRelevantFieldSchema(body || {}, "request_body"),
      ...collectRelevantFieldSchema(parsed, "decoded_response"),
    ],
  };
});

const artifact = {
  schema_artifact_version: 2,
  source: {
    filename: /^notionize-live-[0-9TZ.-]+\.json$/.test(path.basename(inputPath))
      ? path.basename(inputPath)
      : "__REDACTED_SOURCE_FILENAME__.json",
    sha256: crypto.createHash("sha256").update(rawBytes).digest("hex"),
    bytes: rawBytes.length,
    raw_file_mode: rawMode,
  },
  privacy_boundary: {
    schema_only: true,
    arbitrary_string_values_emitted: false,
    urls_emitted: false,
    identifiers_emitted: false,
    headers_or_cookies_emitted: false,
    request_or_response_body_text_emitted: false,
    structural_enum_values_are_allowlisted: true,
    allowlisted_numeric_usage_and_threshold_values_emitted: true,
    arbitrary_model_aliases_emitted: false,
  },
  capture_schema: {
    event_count: capture.events.length,
    phase_counts: Object.fromEntries(Object.entries(phaseCounts).sort(([a], [b]) => a.localeCompare(b))),
    sessions,
  },
  target_transactions: transactions,
};

const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
const forbiddenPatterns = [
  [/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i, "UUID"],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, "email"],
  [/https?:\/\//i, "URL"],
  [/\/Users\//, "local user path"],
  [/(?:cookie|authorization|x-notion-user-id|x-notion-space-id)\s*[=:]/i, "sensitive header"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/, "JWT"],
  [/\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/i, "bearer credential"],
  [/\b(?:token_v2|ntn)_[A-Za-z0-9_-]{8,}\b/i, "Notion credential"],
  [/\b[0-9a-f]{32}\b/i, "compact identifier"],
];
for (const [pattern, label] of forbiddenPatterns) {
  if (pattern.test(serialized)) throw new Error(`privacy check failed: ${label}`);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, serialized, { mode: 0o644 });
fs.chmodSync(outputPath, 0o644);
console.log(
  JSON.stringify({
    output: path.basename(outputPath),
    transactions: transactions.length,
    events: capture.events.length,
    privacy_checks: "passed",
  }),
);
