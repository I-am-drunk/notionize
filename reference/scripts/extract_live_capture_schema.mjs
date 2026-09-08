#!/usr/bin/env node

import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  brotliDecompressSync,
  gunzipSync,
  inflateSync,
} from "node:zlib";

const referenceRoot = path.resolve(import.meta.dirname, "..");
const captureName = "notionize-live-2026-08-27T02-55-16.407Z.json";
const inputPath = path.resolve(
  process.argv[2] || path.join(referenceRoot, "captures", "raw", captureName),
);
const outputPath = path.resolve(
  process.argv[3]
    || path.join(referenceRoot, "captures", "sanitized", `${captureName.slice(0, -5)}.schema.json`),
);
const privacyScanPath = path.resolve(
  process.argv[4]
    || path.join(referenceRoot, "analysis", "live-capture-privacy-scan.json"),
);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const typeOf = (value) => value === null
  ? "null"
  : Array.isArray(value)
    ? "array"
    : typeof value;

const phaseAllowlist = new Set([
  "hook-installed",
  "request",
  "response-start",
  "response-chunk",
  "response-end",
]);
const endpointMarkers = [
  "agent-transcript-summary",
  "activate-transcript-compaction",
  "summary-inference",
  "runInferenceTranscript",
];
const transcriptTypeAllowlist = new Set([
  "config",
  "user",
  "agent-inference",
  "agent-turn-full-record-map",
  "agent-transcript-summary",
  "summarize-transcript",
  "summarize-transcript-record-map",
  "summarize-transcript-error",
  "activate-transcript-compaction",
  "summary-inference",
]);
const responseTypeAllowlist = new Set([
  "patch-start",
  "patch",
  "record-map",
  "patch-sync",
  "agent-inference",
  "agent-turn-full-record-map",
  "agent-transcript-summary",
  "summarize-transcript",
  "summarize-transcript-record-map",
  "summarize-transcript-error",
  "activate-transcript-compaction",
  "summary-inference",
  "config",
  "user",
  "text",
  "workflow",
  "everything",
]);
const relevantFieldAllowlist = new Set([
  "activationMode",
  "before",
  "after",
  "compaction",
  "compactThreshold",
  "contextConfig",
  "contextManagementConfiguration",
  "createSummaryThreshold",
  "updateSummaryInterval",
  "enableUserSessionContext",
  "useContextualCoreDocsAutoLoad",
  "usage_summary",
  "agent_inference_count",
  "completion_count",
  "input_tokens",
  "output_tokens",
  "cached_input_tokens_created",
  "cached_input_tokens_read",
  "credits_by_type_unit",
  "basic_ai_credits",
  "exempt_ai_credits",
  "premium_ai_credits",
  "preview_ai_credits",
  "cachedTokensCreated",
  "cachedTokensRead",
  "inputTokens",
  "outputTokens",
  "maxContextTokens",
  "maxInputTokens",
  "serverPostSubmitTimeToFirstTokenMs",
  "serverTimeToFirstTokenMs",
]);

function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function sortedObject(map) {
  return Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)));
}

function collectRelevantFields(value, scope, aggregate) {
  if (Array.isArray(value)) {
    for (const item of value) collectRelevantFields(item, scope, aggregate);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [field, child] of Object.entries(value)) {
    if (relevantFieldAllowlist.has(field)) {
      const key = `${scope}\u0000${field}`;
      if (!aggregate.has(key)) {
        aggregate.set(key, {
          scope,
          field,
          occurrences: 0,
          valueTypes: new Set(),
        });
      }
      const item = aggregate.get(key);
      item.occurrences += 1;
      item.valueTypes.add(typeOf(child));
    }
    collectRelevantFields(child, scope, aggregate);
  }
}

function collectAllowedTypeValues(value, counts) {
  if (Array.isArray(value)) {
    for (const item of value) collectAllowedTypeValues(item, counts);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [field, child] of Object.entries(value)) {
    if (field === "type" && typeof child === "string" && responseTypeAllowlist.has(child)) {
      increment(counts, child);
    }
    collectAllowedTypeValues(child, counts);
  }
}

function headerValue(headers, sought) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return "";
  const match = Object.entries(headers).find(([name]) => name.toLowerCase() === sought);
  return match ? String(match[1]).toLowerCase() : "";
}

function classifyMime(raw) {
  return [
    "application/x-ndjson",
    "application/json",
    "text/event-stream",
    "text/plain",
  ].find((mime) => raw.includes(mime)) || "other-or-missing";
}

function classifyEncoding(raw) {
  return ["br", "gzip", "deflate", "identity"].find((encoding) => raw.includes(encoding))
    || "none";
}

function decodeResponse(bytes, encoding) {
  if (encoding === "br") return brotliDecompressSync(bytes);
  if (encoding === "gzip") return gunzipSync(bytes);
  if (encoding === "deflate") return inflateSync(bytes);
  return bytes;
}

function parseNdjson(text) {
  const nonempty = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const values = [];
  let failures = 0;
  for (const line of nonempty) {
    try {
      values.push(JSON.parse(line));
    } catch {
      failures += 1;
    }
  }
  return { nonempty, values, failures };
}

function markerLocations(events, decodedTargetResponse) {
  const result = Object.fromEntries(endpointMarkers.map((marker) => [marker, {
    url_event_count: 0,
    request_body_event_count: 0,
    decoded_chunk_event_count: 0,
    target_response_occurrences: 0,
  }]));
  for (const event of events) {
    for (const marker of endpointMarkers) {
      if (typeof event?.url === "string" && event.url.includes(marker)) {
        result[marker].url_event_count += 1;
      }
      if (typeof event?.bodyText === "string" && event.bodyText.includes(marker)) {
        result[marker].request_body_event_count += 1;
      }
      if (typeof event?.bytesBase64 === "string") {
        const decoded = Buffer.from(event.bytesBase64, "base64").toString("utf8");
        if (decoded.includes(marker)) result[marker].decoded_chunk_event_count += 1;
      }
    }
  }
  for (const marker of endpointMarkers) {
    result[marker].target_response_occurrences = decodedTargetResponse
      .split(marker).length - 1;
  }
  return result;
}

const sourceBytes = await readFile(inputPath);
const sourceStat = await stat(inputPath);
const sourceMode = (sourceStat.mode & 0o777).toString(8).padStart(3, "0");
if (sourceMode !== "600") {
  throw new Error(`raw capture must be mode 0600; observed ${sourceMode}`);
}

const capture = JSON.parse(sourceBytes.toString("utf8"));
if (!capture || typeof capture !== "object" || Array.isArray(capture)) {
  throw new Error("live capture must have an object root");
}
if (!Array.isArray(capture.events)) throw new Error("live capture has no events array");

const phaseStats = new Map();
for (const event of capture.events) {
  const phase = typeof event?.phase === "string" && phaseAllowlist.has(event.phase)
    ? event.phase
    : "__OTHER_PHASE__";
  if (!phaseStats.has(phase)) {
    phaseStats.set(phase, {
      event_count: 0,
      target_event_count: 0,
      with_url_count: 0,
      with_body_text_count: 0,
      with_bytes_count: 0,
      with_context_config_count: 0,
    });
  }
  const item = phaseStats.get(phase);
  item.event_count += 1;
  if (event?.target === true) item.target_event_count += 1;
  if (typeof event?.url === "string") item.with_url_count += 1;
  if (typeof event?.bodyText === "string") item.with_body_text_count += 1;
  if (typeof event?.bytesBase64 === "string") item.with_bytes_count += 1;
  if (event?.contextConfig && typeof event.contextConfig === "object") {
    item.with_context_config_count += 1;
  }
}

const targetEvents = capture.events.filter((event) => event?.target === true);
const targetRequest = targetEvents.find((event) => event.phase === "request");
const targetStart = targetEvents.find((event) => event.phase === "response-start");
const targetChunks = targetEvents
  .filter((event) => event.phase === "response-chunk")
  .sort((a, b) => Number(a.chunkIndex ?? 0) - Number(b.chunkIndex ?? 0));
if (!targetRequest || !targetStart || targetChunks.length === 0) {
  throw new Error("capture lacks a complete targeted request/response sequence");
}

let requestBody;
try {
  requestBody = JSON.parse(targetRequest.bodyText);
} catch {
  throw new Error("target request body is not valid JSON");
}

const encoding = classifyEncoding(headerValue(targetStart.headers, "content-encoding"));
const mime = classifyMime(headerValue(targetStart.headers, "content-type"));
const capturedResponseBytes = Buffer.concat(
  targetChunks.map((event) => Buffer.from(event.bytesBase64, "base64")),
);
const decodedResponseBytes = decodeResponse(capturedResponseBytes, encoding);
const decodedResponseText = decodedResponseBytes.toString("utf8");
const ndjson = parseNdjson(decodedResponseText);
if (ndjson.failures !== 0) {
  throw new Error(`target response contains ${ndjson.failures} unparseable non-empty lines`);
}

const transcript = Array.isArray(requestBody.transcript) ? requestBody.transcript : [];
const transcriptTypeCounts = new Map();
const transcriptOrder = transcript.map((entry, index) => {
  const type = typeof entry?.type === "string" && transcriptTypeAllowlist.has(entry.type)
    ? entry.type
    : "__OTHER_TRANSCRIPT_TYPE__";
  increment(transcriptTypeCounts, type);
  return {
    index,
    type,
    value_type: typeOf(entry?.value),
  };
});

const responseEventSequence = ndjson.values.map((value) => (
  typeof value?.type === "string" && responseTypeAllowlist.has(value.type)
    ? value.type
    : "__OTHER_RESPONSE_EVENT_TYPE__"
));
const responseEventCounts = new Map();
for (const eventType of responseEventSequence) increment(responseEventCounts, eventType);

const responseTypeCounts = new Map();
for (const value of ndjson.values) collectAllowedTypeValues(value, responseTypeCounts);

const relevantFields = new Map();
collectRelevantFields(capture.events, "capture_event", relevantFields);
collectRelevantFields(requestBody, "request_body", relevantFields);
for (const value of ndjson.values) collectRelevantFields(value, "response_ndjson", relevantFields);
const relevantFieldSchema = [...relevantFields.values()]
  .map((item) => ({
    scope: item.scope,
    field: item.field,
    occurrences: item.occurrences,
    value_types: [...item.valueTypes].sort(),
  }))
  .sort((a, b) => a.scope.localeCompare(b.scope) || a.field.localeCompare(b.field));

const markers = markerLocations(capture.events, decodedResponseText);
const compactionStepObserved = [
  "agent-transcript-summary",
  "summarize-transcript",
  "summarize-transcript-record-map",
  "summarize-transcript-error",
  "activate-transcript-compaction",
  "summary-inference",
].some((type) => (responseTypeCounts.get(type) || 0) > 0
  || (transcriptTypeCounts.get(type) || 0) > 0);
const compactionMarkerObserved = [
  "agent-transcript-summary",
  "activate-transcript-compaction",
  "summary-inference",
].some((marker) => Object.values(markers[marker]).some((count) => count > 0));

const topLevelFields = [
  "schemaVersion",
  "currentSessionId",
  "database",
  "exportedAt",
  "events",
].filter((field) => Object.hasOwn(capture, field)).map((field) => ({
  field,
  value_type: typeOf(capture[field]),
}));

const recordMapEvent = ndjson.values.find((value) => value?.type === "record-map");
const threadRecords = recordMapEvent?.recordMap?.thread;
const messageRecords = recordMapEvent?.recordMap?.thread_message;

const artifact = {
  schema_artifact_version: 1,
  source: {
    filename: path.basename(inputPath),
    sha256: sha256(sourceBytes),
    bytes: sourceBytes.length,
    raw_file_mode: sourceMode,
  },
  privacy_boundary: {
    schema_only: true,
    arbitrary_string_values_emitted: false,
    numeric_payload_values_emitted: false,
    urls_emitted: false,
    identifiers_emitted: false,
    headers_or_cookies_emitted: false,
    request_or_response_body_text_emitted: false,
    structural_enum_values_are_allowlisted: true,
  },
  capture_schema: {
    top_level_type: typeOf(capture),
    top_level_fields: topLevelFields,
    event_count: capture.events.length,
    phases: Object.fromEntries([...phaseStats].sort(([a], [b]) => a.localeCompare(b))),
  },
  target_transaction: {
    endpoint_class: typeof targetRequest.url === "string"
      && targetRequest.url.includes("runInferenceTranscript")
      ? "runInferenceTranscript"
      : "other-or-unknown",
    event_count: targetEvents.length,
    request_count: targetEvents.filter((event) => event.phase === "request").length,
    response_start_count: targetEvents.filter((event) => event.phase === "response-start").length,
    response_chunk_count: targetChunks.length,
    response_end_count: targetEvents.filter((event) => event.phase === "response-end").length,
    request: {
      body_json_parsed: true,
      transcript_entry_count: transcript.length,
      transcript_type_counts: sortedObject(transcriptTypeCounts),
      transcript_order: transcriptOrder,
    },
    response: {
      content_type_class: mime,
      content_encoding_class: encoding,
      captured_byte_count: capturedResponseBytes.length,
      decoded_byte_count: decodedResponseBytes.length,
      nonempty_line_count: ndjson.nonempty.length,
      parsed_ndjson_event_count: ndjson.values.length,
      unparsed_line_count: ndjson.failures,
      event_sequence: responseEventSequence,
      event_type_counts: sortedObject(responseEventCounts),
      allowlisted_nested_type_counts: sortedObject(responseTypeCounts),
      record_map_thread_record_count: threadRecords && typeof threadRecords === "object"
        ? Object.keys(threadRecords).length
        : 0,
      record_map_thread_message_record_count: messageRecords && typeof messageRecords === "object"
        ? Object.keys(messageRecords).length
        : 0,
    },
  },
  exact_marker_locations: markers,
  relevant_field_schema: relevantFieldSchema,
  evidence_verdicts: {
    compaction_configuration_fields_observed: [
      "compactThreshold",
      "createSummaryThreshold",
      "updateSummaryInterval",
    ].every((field) => relevantFieldSchema.some((item) => (
      item.scope === "request_body" && item.field === field
    ))),
    agent_transcript_summary_observed: Object.values(markers["agent-transcript-summary"])
      .some((count) => count > 0),
    activate_transcript_compaction_observed: Object.values(
      markers["activate-transcript-compaction"],
    ).some((count) => count > 0),
    summary_inference_observed: Object.values(markers["summary-inference"])
      .some((count) => count > 0),
    activation_mode_field_observed: relevantFieldSchema.some((item) => (
      item.field === "activationMode"
    )),
    compaction_step_type_observed: compactionStepObserved || compactionMarkerObserved,
    before_after_compaction_pair_observed: false,
    inference_token_fields_observed: [
      "inputTokens",
      "outputTokens",
      "cachedTokensCreated",
      "cachedTokensRead",
      "maxContextTokens",
      "maxInputTokens",
    ].every((field) => relevantFieldSchema.some((item) => (
      item.scope === "response_ndjson" && item.field === field
    ))),
    cumulative_usage_summary_observed: relevantFieldSchema.some((item) => (
      item.scope === "response_ndjson" && item.field === "usage_summary"
    )),
    compaction_behavior_verdict: compactionStepObserved || compactionMarkerObserved
      ? "compaction-related runtime structure observed"
      : "configuration observed; runtime compaction not observed",
  },
};

const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
const forbiddenPatterns = {
  absolute_user_path: /\/Users\/[A-Za-z0-9._-]+\//g,
  url: /https?:\/\//gi,
  uuid: /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
  compact_identifier: /\b[0-9a-f]{32}\b/gi,
  email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  jwt: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  bearer_value: /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  notion_token: /\b(?:token_v2|ntn)_[A-Za-z0-9_-]{8,}\b/gi,
};
const patternHits = Object.fromEntries(Object.entries(forbiddenPatterns).map(([name, regex]) => [
  name,
  [...serialized.matchAll(regex)].length,
]));
if (Object.values(patternHits).some((count) => count !== 0)) {
  throw new Error("schema artifact failed privacy scan");
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, serialized, { mode: 0o644 });
await chmod(outputPath, 0o644);

const privacyScan = {
  scan_version: 1,
  artifact: path.basename(outputPath),
  artifact_sha256: sha256(serialized),
  artifact_bytes: Buffer.byteLength(serialized),
  pattern_hits: patternHits,
  structural_assertions: {
    schema_only: artifact.privacy_boundary.schema_only,
    raw_capture_mode_0600: sourceMode === "600",
    arbitrary_string_values_omitted: !artifact.privacy_boundary.arbitrary_string_values_emitted,
    numeric_payload_values_omitted: !artifact.privacy_boundary.numeric_payload_values_emitted,
    urls_omitted: !artifact.privacy_boundary.urls_emitted,
    identifiers_omitted: !artifact.privacy_boundary.identifiers_emitted,
    headers_and_cookies_omitted: !artifact.privacy_boundary.headers_or_cookies_emitted,
    body_text_omitted: !artifact.privacy_boundary.request_or_response_body_text_emitted,
  },
  passed: Object.values(patternHits).every((count) => count === 0),
};
const privacySerialized = `${JSON.stringify(privacyScan, null, 2)}\n`;
await mkdir(path.dirname(privacyScanPath), { recursive: true });
await writeFile(privacyScanPath, privacySerialized, { mode: 0o644 });
await chmod(privacyScanPath, 0o644);

console.log(JSON.stringify({
  schema_artifact: path.basename(outputPath),
  privacy_scan: path.basename(privacyScanPath),
  event_count: artifact.capture_schema.event_count,
  target_ndjson_events: artifact.target_transaction.response.parsed_ndjson_event_count,
  privacy_scan_passed: privacyScan.passed,
  compaction_behavior_verdict: artifact.evidence_verdicts.compaction_behavior_verdict,
}, null, 2));
