#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const [rawPath, schemaPath, reportPath] = process.argv.slice(2);
if (!rawPath || !schemaPath || !reportPath) {
  console.error("usage: node audit_live_capture.mjs RAW_CAPTURE SCHEMA_JSON AUDIT_JSON");
  process.exit(2);
}

const scriptDirectory = path.dirname(new URL(import.meta.url).pathname);
const sanitizerPath = path.join(scriptDirectory, "sanitize_live_capture.mjs");
const rawStat = fs.lstatSync(rawPath);
const schemaStat = fs.lstatSync(schemaPath);
const rawMode = (rawStat.mode & 0o777).toString(8).padStart(3, "0");
const schemaMode = (schemaStat.mode & 0o777).toString(8).padStart(3, "0");

const rawBytes = fs.readFileSync(rawPath);
const schemaBytes = fs.readFileSync(schemaPath);
const raw = JSON.parse(rawBytes.toString("utf8"));
const schema = JSON.parse(schemaBytes.toString("utf8"));

const temporaryDirectory = fs.mkdtempSync(
  path.join(path.dirname(path.resolve(reportPath)), ".live-capture-audit-"),
);
const regeneratedPath = path.join(temporaryDirectory, path.basename(schemaPath));
let regenerationMatches = false;
try {
  const result = spawnSync(process.execPath, [sanitizerPath, rawPath, regeneratedPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) throw new Error("sanitizer regeneration failed");
  regenerationMatches = fs.readFileSync(regeneratedPath).equals(schemaBytes);
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

const forbiddenPatterns = {
  absolute_user_path: /\/Users\/[A-Za-z0-9._-]+\//gi,
  url: /https?:\/\//gi,
  uuid: /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
  compact_identifier: /\b[0-9a-f]{32}\b/gi,
  email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  jwt: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  bearer_value: /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  notion_token: /\b(?:token_v2|ntn)_[A-Za-z0-9_-]{8,}\b/gi,
  serialized_cookie: /\b(?:cookie|set-cookie)\s*[:=]/gi,
};
const serialized = schemaBytes.toString("utf8");
const patternHits = Object.fromEntries(
  Object.entries(forbiddenPatterns).map(([name, expression]) => [
    name,
    [...serialized.matchAll(expression)].length,
  ]),
);

const safeTranscriptTypes = new Set([
  "config",
  "context",
  "updated-config",
  "user",
]);
const safeNdjsonTypes = new Set([
  "patch-start",
  "patch",
  "record-map",
  "patch-sync",
  "error",
]);
const safeModelCallTypes = new Set([
  "agent-inference",
  "agent-transcript-summary",
  "summary-inference",
]);
const safeValueTypes = new Set([
  "array",
  "boolean",
  "null",
  "number",
  "object",
  "string",
  "undefined",
]);
const safeRelevantFields = new Set([
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

function isAllowedString(pathName, value) {
  if (pathName === "$.source.filename") {
    return /^notionize-live-[0-9TZ.-]+\.json$/.test(value)
      || value === "__REDACTED_SOURCE_FILENAME__.json";
  }
  if (pathName === "$.source.sha256") return /^[0-9a-f]{64}$/.test(value);
  if (pathName === "$.source.raw_file_mode") return value === "600";
  if (/\.endpoint_class$/.test(pathName)) return value === "runInferenceTranscript";
  if (/\.transcript_order\[\d+\]\.type$/.test(pathName)) {
    return safeTranscriptTypes.has(value) || value === "__OTHER_TRANSCRIPT_TYPE__";
  }
  if (/\.transcript_order\[\d+\]\.value_type$/.test(pathName)) {
    return safeValueTypes.has(value);
  }
  if (/\.response\.outcome_class$/.test(pathName)) {
    return ["success", "application-level-quota-failure", "other-or-incomplete"].includes(value);
  }
  if (/\.response_header_content_type_class$/.test(pathName)) {
    return ["application/x-ndjson", "application/json", "other", "unknown"].includes(value);
  }
  if (/\.response_header_content_encoding_class$/.test(pathName)) {
    return ["zstd", "gzip", "br", "none", "other", "unknown"].includes(value);
  }
  if (/\.captured_body_state$/.test(pathName)) {
    return value === "decoded-fetch-response-stream";
  }
  if (/\.event_sequence\[\d+\]$/.test(pathName)) {
    return safeNdjsonTypes.has(value) || value === "__OTHER_NDJSON_EVENT__";
  }
  if (/\.model_calls\[\d+\]\.step_type$/.test(pathName)) {
    return safeModelCallTypes.has(value) || value === "__OTHER_STEP_TYPE__";
  }
  if (/\.relevant_field_schema\[\d+\]\.scope$/.test(pathName)) {
    return value === "request_body" || value === "decoded_response";
  }
  if (/\.relevant_field_schema\[\d+\]\.field$/.test(pathName)) {
    return safeRelevantFields.has(value);
  }
  if (/\.relevant_field_schema\[\d+\]\.value_types\[\d+\]$/.test(pathName)) {
    return safeValueTypes.has(value);
  }
  return false;
}

let unexpectedStringValueCount = 0;
let forbiddenKeyCount = 0;
function inspectStrings(value, pathName = "$") {
  if (typeof value === "string") {
    if (!isAllowedString(pathName, value)) unexpectedStringValueCount += 1;
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => inspectStrings(child, `${pathName}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (["url", "headers", "cookies", "bodyText", "bytesBase64", "requestId", "sessionId"].includes(key)) {
      forbiddenKeyCount += 1;
    }
    inspectStrings(child, `${pathName}.${key}`);
  }
}
inspectStrings(schema);

const transactions = Array.isArray(schema.target_transactions) ? schema.target_transactions : [];
const targetRequestCount = Array.isArray(raw.events)
  ? raw.events.filter((event) => event?.target === true && event?.phase === "request").length
  : -1;
const outcomeCounts = {};
const framingCounts = {};
const markerPresence = {};
let unknownStructuralEnumCount = 0;
let allCaptureIntegrityChecksPass = true;
let allNdjsonLinesParsed = true;
for (const transaction of transactions) {
  const outcome = transaction?.response?.outcome_class || "missing";
  outcomeCounts[outcome] = (outcomeCounts[outcome] || 0) + 1;
  const framing = transaction?.response?.response_header_content_type_class || "missing";
  framingCounts[framing] = (framingCounts[framing] || 0) + 1;
  allCaptureIntegrityChecksPass &&= Object.values(
    transaction?.response?.capture_integrity || {},
  ).every((value) => value === true);
  allNdjsonLinesParsed &&= transaction?.response?.unparsed_line_count === 0;
  for (const type of transaction?.response?.event_sequence || []) {
    if (type.startsWith("__OTHER_")) unknownStructuralEnumCount += 1;
  }
  for (const [type, count] of Object.entries(
    transaction?.response?.allowlisted_nested_type_counts || {},
  )) {
    if (type.startsWith("__OTHER_")) unknownStructuralEnumCount += count;
  }
  for (const [marker, locations] of Object.entries(
    transaction?.response?.exact_marker_counts || {},
  )) {
    const observed = Object.values(locations).some((count) => count > 0);
    markerPresence[marker] = markerPresence[marker] === true || observed;
  }
}

const structuralAssertions = {
  raw_is_regular_non_symlink_file: rawStat.isFile() && !rawStat.isSymbolicLink(),
  raw_capture_mode_0600: rawMode === "600",
  sanitized_artifact_mode_0644: schemaMode === "644",
  source_byte_count_matches: schema?.source?.bytes === rawBytes.length,
  source_digest_matches:
    schema?.source?.sha256 === crypto.createHash("sha256").update(rawBytes).digest("hex"),
  capture_event_count_matches: schema?.capture_schema?.event_count === raw?.events?.length,
  target_transaction_count_matches: transactions.length === targetRequestCount,
  deterministic_regeneration_matches: regenerationMatches,
  all_capture_integrity_checks_pass: allCaptureIntegrityChecksPass,
  all_ndjson_lines_parsed: allNdjsonLinesParsed,
  no_unknown_structural_enums: unknownStructuralEnumCount === 0,
  no_forbidden_serialized_keys: forbiddenKeyCount === 0,
  all_string_values_path_allowlisted: unexpectedStringValueCount === 0,
  no_arbitrary_model_aliases: !/"model_alias"\s*:/.test(serialized),
};
const passed = Object.values(patternHits).every((count) => count === 0)
  && Object.values(structuralAssertions).every((value) => value === true);

const report = {
  audit_version: 1,
  raw_capture: path.basename(rawPath),
  sanitized_artifact: path.basename(schemaPath),
  sanitized_artifact_sha256: crypto.createHash("sha256").update(schemaBytes).digest("hex"),
  transaction_count: transactions.length,
  outcome_counts: Object.fromEntries(Object.entries(outcomeCounts).sort()),
  framing_counts: Object.fromEntries(Object.entries(framingCounts).sort()),
  exact_marker_presence: Object.fromEntries(Object.entries(markerPresence).sort()),
  privacy_pattern_hits: patternHits,
  privacy_counters: {
    unexpected_string_value_count: unexpectedStringValueCount,
    forbidden_serialized_key_count: forbiddenKeyCount,
    unknown_structural_enum_count: unknownStructuralEnumCount,
  },
  structural_assertions: structuralAssertions,
  passed,
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o644 });
fs.chmodSync(reportPath, 0o644);
console.log(JSON.stringify({
  audit: path.basename(reportPath),
  transactions: transactions.length,
  passed,
}));
if (!passed) process.exitCode = 1;
