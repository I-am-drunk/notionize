#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REFERENCE_DIR = path.resolve(SCRIPT_DIR, "..");
const RUNTIME_DIR = path.join(REFERENCE_DIR, "assets", "browser-code", "runtime-chunks");
const FILES_DIR = path.join(RUNTIME_DIR, "files");
const MANIFEST_PATH = path.join(RUNTIME_DIR, "runtime-chunk-manifest.json");
const OUTPUT_PATH = path.join(REFERENCE_DIR, "analysis", "full-runtime-static-audit.json");
const API_CSV_PATH = path.join(REFERENCE_DIR, "analysis", "full-runtime-ai-api-events.csv");
const MODEL_CSV_PATH = path.join(REFERENCE_DIR, "analysis", "full-runtime-model-evidence.csv");
const PROVIDER_CSV_PATH = path.join(
  REFERENCE_DIR,
  "analysis",
  "full-runtime-provider-evidence.csv",
);
const SUMMARY_PATH = path.join(
  REFERENCE_DIR,
  "analysis",
  "full-runtime-static-audit.md",
);
const MODEL_ROSTER_PATH = path.join(REFERENCE_DIR, "analysis", "model-roster.json");
const CSS_DIR = path.join(REFERENCE_DIR, "assets", "browser-code", "runtime-css");
const CSS_MANIFEST_PATH = path.join(CSS_DIR, "runtime-css-manifest.json");
const REFERENCED_ASSETS_DIR = path.join(
  REFERENCE_DIR,
  "assets",
  "browser-code",
  "referenced-assets",
);
const REFERENCED_ASSETS_MANIFEST_PATH = path.join(
  REFERENCED_ASSETS_DIR,
  "referenced-assets-manifest.json",
);

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function walkFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(fullPath) : [fullPath];
  });
}

function increment(map, key, file, amount = 1) {
  if (!map.has(key)) map.set(key, { total_occurrences: 0, files: new Map() });
  const value = map.get(key);
  value.total_occurrences += amount;
  value.files.set(file, (value.files.get(file) || 0) + amount);
}

function countLiteral(source, literal, caseInsensitive = false) {
  if (!literal) return 0;
  const haystack = caseInsensitive ? source.toLowerCase() : source;
  const needle = caseInsensitive ? literal.toLowerCase() : literal;
  let count = 0;
  let cursor = 0;
  while ((cursor = haystack.indexOf(needle, cursor)) >= 0) {
    count += 1;
    cursor += needle.length;
  }
  return count;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countIdentifier(source, identifier) {
  return [...source.matchAll(new RegExp(`(?<![A-Za-z0-9_$])${escapeRegExp(identifier)}(?![A-Za-z0-9_$])`, "g"))]
    .length;
}

// Only short ordinary single- and double-quoted strings are retained, and only
// in memory. The scanner never writes arbitrary source strings to an output.
function countShortStringLiterals(source, maximumLength = 160) {
  const counts = new Map();
  for (let cursor = 0; cursor < source.length; cursor += 1) {
    const quote = source[cursor];
    if (quote !== '"' && quote !== "'") continue;
    let value = "";
    let escaped = false;
    let terminated = false;
    let valid = true;
    let end = cursor + 1;
    for (; end < source.length; end += 1) {
      const character = source[end];
      if (escaped) {
        escaped = false;
        if (value.length <= maximumLength) value += `\\${character}`;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === quote) {
        terminated = true;
        break;
      }
      if (character === "\n" || character === "\r") {
        valid = false;
        break;
      }
      if (value.length <= maximumLength) value += character;
    }
    if (terminated) cursor = end;
    if (terminated && valid && value.length <= maximumLength) {
      counts.set(value, (counts.get(value) || 0) + 1);
    }
  }
  return counts;
}

function countQuotedLexeme(stringCounts, lexeme) {
  const expression = new RegExp(
    `(?<![A-Za-z0-9])${escapeRegExp(lexeme)}(?![A-Za-z0-9])`,
    "gi",
  );
  let count = 0;
  for (const [value, occurrences] of stringCounts) {
    expression.lastIndex = 0;
    const matches = [...value.matchAll(expression)].length;
    count += matches * occurrences;
  }
  return count;
}

function countExactString(stringCounts, value) {
  return stringCounts.get(value) || 0;
}

function renderAggregate(map) {
  return [...map]
    .map(([name, value]) => ({
      name,
      total_occurrences: value.total_occurrences,
      file_count: value.files.size,
      files: [...value.files]
        .map(([file, occurrences]) => ({ file, occurrences }))
        .sort((left, right) => left.file.localeCompare(right.file)),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function classifyApiEvent(name) {
  const rules = [
    ["explicit_ai_segment", /(?:AI|Ai|ai)(?=[A-Z0-9]|$)/],
    ["agent", /Agent(?=[A-Z0-9]|$)/],
    ["inference", /Inference(?=[A-Z0-9]|$)/],
    ["transcript_or_transcription", /Transcript(?:ion)?(?=[A-Z0-9]|$)/],
    ["model", /Model(?:s)?(?=[A-Z0-9]|$)/],
    ["prompt", /Prompt(?=[A-Z0-9]|$)/],
    ["summary", /Summary(?=[A-Z0-9]|$)/],
    ["completion", /Completion(?=[A-Z0-9]|$)/],
    ["assistant", /Assistant(?=[A-Z0-9]|$)/],
    ["research", /Research(?=[A-Z0-9]|$)/],
    ["ai_vendor_or_eval", /(?:Claude|Braintrust|CursorAgent|EvalAgent)(?=[A-Z0-9]|$)/],
    ["workflow_credit", /(?:WorkflowCredit|CreditRateLimit)(?=[A-Z0-9]|$)/],
  ];
  return rules.filter(([, expression]) => expression.test(name)).map(([tag]) => tag);
}

const PROVIDER_LEXEMES = [
  ["OpenRouter", "openrouter", "distinctive provider name"],
  ["Anthropic", "anthropic", "provider name or model identifier segment"],
  ["OpenAI", "openai", "provider name or model identifier segment"],
  ["AWS Bedrock", "bedrock", "provider platform name"],
  ["Amazon", "amazon", "ambiguous generic company/platform name"],
  ["Google Vertex", "vertex", "ambiguous product/geometry word"],
  ["Gemini", "gemini", "model family or product name"],
  ["Fireworks", "fireworks", "provider name; also an ordinary plural noun"],
  ["Baseten", "baseten", "distinctive provider name"],
  ["DeepSeek", "deepseek", "distinctive model/provider name"],
  ["Kimi", "kimi", "model family or name"],
  ["xAI", "xai", "provider name"],
  ["Mistral", "mistral", "model/provider name; also an ordinary noun"],
  ["Cohere", "cohere", "provider name; also an ordinary verb"],
];

const FIELD_GROUPS = {
  transport_and_framing: [
    ["stream API wrapper", "callStreamApi"],
    ["JSON stream mode", "jsonStream"],
    ["EventSource", "EventSource"],
    ["ReadableStream", "ReadableStream"],
    ["TextDecoder", "TextDecoder"],
    ["reader acquisition", "getReader"],
  ],
  token_usage_and_limits: [
    ["input tokens", "inputTokens"],
    ["output tokens", "outputTokens"],
    ["cached tokens read", "cachedTokensRead"],
    ["cached tokens created", "cachedTokensCreated"],
    ["cache read input tokens", "cacheReadInputTokens"],
    ["cache creation input tokens", "cacheCreationInputTokens"],
    ["prompt tokens", "promptTokens"],
    ["completion tokens", "completionTokens"],
    ["reasoning tokens", "reasoningTokens"],
    ["thinking tokens", "thinkingTokens"],
    ["max context tokens", "maxContextTokens"],
    ["max input tokens", "maxInputTokens"],
    ["transcript token count", "transcriptTokenCount"],
    ["transcript context usage", "transcriptContextUsage"],
    ["server time to first token", "serverTimeToFirstTokenMs"],
    ["server post-submit time to first token", "serverPostSubmitTimeToFirstTokenMs"],
    ["usage summary", "usage_summary"],
  ],
  compaction_and_summary_fields: [
    ["context management configuration", "contextManagementConfiguration"],
    ["compact threshold", "compactThreshold"],
    ["create summary threshold", "createSummaryThreshold"],
    ["update summary interval", "updateSummaryInterval"],
    ["activation mode", "activationMode"],
    ["summary step id", "summaryStepId"],
    ["running summary text", "runningSummaryText"],
    ["activate transcript compaction", "activateTranscriptCompaction"],
    ["provider-native compaction supported", "providerNativeCompactionSupported"],
    ["model default compaction thresholds", "modelDefaultCompactionThresholds"],
    ["default compaction threshold tokens", "defaultCompactionThresholdTokens"],
    ["compaction threshold tokens", "compactionThresholdTokens"],
    ["post compaction", "postCompaction"],
  ],
  failure_retry_and_cancel_fields: [
    ["abort signal field", "abortSignal"],
    ["AbortSignal interface", "AbortSignal"],
    ["previous attempt values", "previousAttemptValues"],
    ["model failover", "isModelFailover"],
    ["retry inference", "retryInference"],
    ["cancellation token", "cancellationToken"],
  ],
  tool_and_thinking_fields: [
    ["reasoning effort", "reasoningEffort"],
    ["assistant is reasoning", "assistantIsReasoning"],
    ["tool name", "toolName"],
    ["tool type", "toolType"],
    ["tool use id", "toolUseId"],
    ["tool call id", "toolCallId"],
    ["tool input", "toolInput"],
    ["tool result", "toolResult"],
    ["auto-load phase", "autoLoadPhase"],
  ],
};

const STRING_VALUE_GROUPS = {
  streaming_formats_and_event_values: [
    ["NDJSON MIME", "application/x-ndjson"],
    ["SSE MIME", "text/event-stream"],
    ["patch start", "patch-start"],
    ["patch", "patch"],
    ["patch sync", "patch-sync"],
    ["record map", "record-map"],
  ],
  compaction_and_summary_event_values: [
    ["agent transcript summary", "agent-transcript-summary"],
    ["activate transcript compaction", "activate-transcript-compaction"],
    ["summary inference", "summary-inference"],
    ["summarize transcript", "summarize-transcript"],
  ],
  failure_retry_cancel_tool_thinking_values: [
    ["error", "error"],
    ["retry", "retry"],
    ["aborted", "aborted"],
    ["canceled", "canceled"],
    ["cancelled", "cancelled"],
    ["thinking", "thinking"],
    ["tool use", "tool-use"],
    ["agent tool result", "agent-tool-result"],
    ["registered tool call", "registered-tool-call"],
    ["registered tool output", "registered-tool-output"],
    ["registered tool error", "registered-tool-error"],
    ["premium unavailable", "premium-feature-unavailable"],
    ["agent debug error", "agent-debug-error"],
  ],
};

function safeRelativeFile(value) {
  if (typeof value !== "string") return null;
  const normalized = value.replaceAll("\\", "/");
  if (
    path.posix.isAbsolute(normalized) ||
    normalized.split("/").includes("..") ||
    !/^[A-Za-z0-9._/-]+$/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function safeToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(value)
    ? value
    : null;
}

function renderEntry(map, key, extra = {}) {
  const value = map.get(key) || { total_occurrences: 0, files: new Map() };
  return {
    ...extra,
    total_occurrences: value.total_occurrences,
    file_count: value.files.size,
    files: [...value.files]
      .map(([file, occurrences]) => ({ file, occurrences }))
      .sort((left, right) => left.file.localeCompare(right.file)),
  };
}

function loadKnownModelRoster() {
  if (!fs.existsSync(MODEL_ROSTER_PATH)) return [];
  const parsed = JSON.parse(fs.readFileSync(MODEL_ROSTER_PATH, "utf8"));
  if (!Array.isArray(parsed.models)) return [];
  const byModel = new Map();
  for (const entry of parsed.models) {
    const model = safeToken(entry?.model);
    if (!model) continue;
    byModel.set(model, {
      model,
      provider: safeToken(entry?.modelProvider),
      family: safeToken(entry?.modelFamily),
    });
  }
  return [...byModel.values()].sort((left, right) => left.model.localeCompare(right.model));
}

function looksLikePublicModelIdentifier(value) {
  if (
    typeof value !== "string" ||
    value.length < 3 ||
    value.length > 96 ||
    !/[0-9]/.test(value) ||
    !/^[A-Za-z0-9][A-Za-z0-9._+:/-]*$/.test(value) ||
    value.includes("://") ||
    value.includes("@")
  ) {
    return false;
  }
  return /^(?:(?:anthropic|openai|google|vertex|fireworks|baseten|amazon|aws|meta|xai|x-ai|mistral|cohere|deepseek|kimi|qwen|glm)[/:_-])?(?:claude|gpt|gemini|grok|llama|mistral|deepseek|kimi|qwen|glm|o1|o3|o4)(?:[._+:/-][A-Za-z0-9._+:/-]+)$/i.test(
    value,
  );
}

function verifyArchiveManifest(archiveDirectory, archiveManifest) {
  let verifiedBytes = 0;
  let missingFiles = 0;
  let hashMismatches = 0;
  let byteMismatches = 0;
  let unsafeManifestPaths = 0;
  for (const entry of archiveManifest.entries || []) {
    const relativeFile = safeRelativeFile(entry.file);
    if (!relativeFile) {
      unsafeManifestPaths += 1;
      continue;
    }
    const absoluteFile = path.resolve(archiveDirectory, relativeFile);
    if (!absoluteFile.startsWith(`${path.resolve(archiveDirectory)}${path.sep}`)) {
      unsafeManifestPaths += 1;
      continue;
    }
    if (!fs.existsSync(absoluteFile)) {
      missingFiles += 1;
      continue;
    }
    const body = fs.readFileSync(absoluteFile);
    verifiedBytes += body.length;
    if (typeof entry.bytes === "number" && entry.bytes !== body.length) byteMismatches += 1;
    if (typeof entry.sha256 === "string" && entry.sha256 !== sha256(body)) hashMismatches += 1;
  }
  return {
    manifest_entries: (archiveManifest.entries || []).length,
    verified_bytes: verifiedBytes,
    missing_files: missingFiles,
    hash_mismatches: hashMismatches,
    byte_mismatches: byteMismatches,
    unsafe_manifest_paths: unsafeManifestPaths,
    all_entries_verified:
      missingFiles === 0 &&
      hashMismatches === 0 &&
      byteMismatches === 0 &&
      unsafeManifestPaths === 0,
  };
}

function extensionOf(relativeFile) {
  const extension = path.extname(relativeFile).slice(1).toLowerCase();
  return /^[a-z0-9]+$/.test(extension) ? extension : "unknown";
}

function safeSourceFiles(entry) {
  if (!Array.isArray(entry.source_files)) return [];
  return entry.source_files
    .map((file) => safeRelativeFile(file))
    .filter(Boolean)
    .sort();
}

function archiveIndex(archiveManifest) {
  return (archiveManifest.entries || [])
    .map((entry) => {
      const localFile = safeRelativeFile(entry.file);
      if (!localFile) return null;
      return {
        local_file: localFile,
        extension: extensionOf(localFile),
        content_type:
          typeof entry.content_type === "string" &&
          /^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+$/.test(entry.content_type)
            ? entry.content_type
            : null,
        bytes: Number.isSafeInteger(entry.bytes) ? entry.bytes : null,
        sha256: /^[a-f0-9]{64}$/.test(entry.sha256 || "") ? entry.sha256 : null,
        source_files: safeSourceFiles(entry),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.local_file.localeCompare(right.local_file));
}

function javascriptAssetCatalog(assetIndex) {
  return assetIndex
    .filter((entry) => entry.extension === "js" || entry.extension === "mjs")
    .map((entry) => {
      const baseName = path.basename(entry.local_file);
      return {
        ...entry,
        role: /worker/i.test(baseName) ? "worker_named_asset" : "javascript_module_or_unknown",
        role_evidence: "local archived filename only; execution and worker semantics not inspected",
      };
    });
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const cssManifest = JSON.parse(fs.readFileSync(CSS_MANIFEST_PATH, "utf8"));
const referencedAssetsManifest = JSON.parse(
  fs.readFileSync(REFERENCED_ASSETS_MANIFEST_PATH, "utf8"),
);
const knownModels = loadKnownModelRoster();
const knownModelNames = new Set(knownModels.map((entry) => entry.model));
const files = walkFiles(FILES_DIR).filter((file) => file.endsWith(".js")).sort();
const manifestByFile = new Map(
  manifest.entries
    .filter((entry) => typeof entry.file === "string")
    .map((entry) => [entry.file.replaceAll("\\", "/"), entry]),
);

const literalEndpoints = new Map();
const apiEvents = new Map();
const providerMatches = new Map();
const fieldMatches = new Map();
const stringValueMatches = new Map();
const knownModelMatches = new Map();
const publicModelCandidateMatches = new Map();
let totalBytes = 0;
let hashMismatches = 0;
let byteMismatches = 0;
let filesMissingFromManifest = 0;

for (const absolutePath of files) {
  const relativeFile = path.relative(RUNTIME_DIR, absolutePath).replaceAll("\\", "/");
  const body = fs.readFileSync(absolutePath);
  const source = body.toString("utf8");
  const shortStrings = countShortStringLiterals(source);
  totalBytes += body.length;
  const manifestEntry = manifestByFile.get(relativeFile);
  if (!manifestEntry) filesMissingFromManifest += 1;
  else {
    if (manifestEntry.sha256 !== sha256(body)) hashMismatches += 1;
    if (manifestEntry.bytes !== body.length) byteMismatches += 1;
  }

  const normalized = source
    .replaceAll("\\/", "/")
    .replace(/\\u002f/gi, "/")
    .replace(/\\x2f/gi, "/");
  for (const match of normalized.matchAll(
    /\/api\/v3(?:\/[A-Za-z0-9._~!$&()*+,;=:@%-]*)*/g,
  )) {
    const endpoint = match[0].replace(/[),;:'"}]+$/g, "");
    increment(literalEndpoints, endpoint, relativeFile);
  }

  for (const match of source.matchAll(
    /\.api\.(callStreamApi|callCellCompatibleApi|callApi)\(\{\s*eventName\s*:\s*(["'])([A-Za-z0-9_]+)\2/g,
  )) {
    increment(apiEvents, `${match[3]}\u0000${match[1]}`, relativeFile);
  }

  for (const [name, lexeme] of PROVIDER_LEXEMES) {
    const count = countQuotedLexeme(shortStrings, lexeme);
    if (count) increment(providerMatches, name, relativeFile, count);
  }

  for (const [groupName, fields] of Object.entries(FIELD_GROUPS)) {
    for (const [label, field] of fields) {
      const count = countIdentifier(source, field);
      if (count) increment(fieldMatches, `${groupName}\u0000${label}`, relativeFile, count);
    }
  }

  for (const [groupName, values] of Object.entries(STRING_VALUE_GROUPS)) {
    for (const [label, value] of values) {
      const count = countExactString(shortStrings, value);
      if (count) increment(stringValueMatches, `${groupName}\u0000${label}`, relativeFile, count);
    }
  }

  for (const model of knownModels) {
    const count = countExactString(shortStrings, model.model);
    if (count) increment(knownModelMatches, model.model, relativeFile, count);
  }

  for (const [value, occurrences] of shortStrings) {
    if (knownModelNames.has(value) || !looksLikePublicModelIdentifier(value)) continue;
    increment(publicModelCandidateMatches, value, relativeFile, occurrences);
  }
}

const allApiEvents = renderAggregate(apiEvents).map((entry) => {
  const [event, clientMethod] = entry.name.split("\u0000");
  const { name: _name, ...evidence } = entry;
  const classification = classifyApiEvent(event);
  const highSignalTags = new Set([
    "explicit_ai_segment",
    "agent",
    "inference",
    "assistant",
    "ai_vendor_or_eval",
  ]);
  const classificationStrength = classification.some((tag) => highSignalTags.has(tag))
    ? "high_signal_name"
    : classification.length
      ? "adjacent_or_ambiguous_name"
      : "unclassified";
  return {
    event,
    client_method: clientMethod,
    classification_strength: classificationStrength,
    classification_tags: classification,
    ...evidence,
  };
});
const namedAiApiEvents = allApiEvents.filter(
  (entry) => entry.classification_strength !== "unclassified",
);
const highSignalAiApiEvents = allApiEvents.filter(
  (entry) => entry.classification_strength === "high_signal_name",
);
const streamApiEvents = allApiEvents.filter((entry) => entry.client_method === "callStreamApi");
const namedAiStreamApiEvents = streamApiEvents.filter(
  (entry) => entry.classification_strength !== "unclassified",
);

const providers = PROVIDER_LEXEMES.map(([name, lexeme, ambiguity]) =>
  renderEntry(providerMatches, name, {
    provider: name,
    matched_lexeme: lexeme,
    match_semantics: "case-insensitive lexeme within a short quoted JavaScript string",
    interpretation_limit: ambiguity,
  }),
);

const fieldCatalogs = Object.fromEntries(
  Object.entries(FIELD_GROUPS).map(([groupName, fields]) => [
    groupName,
    fields.map(([label, field]) =>
      renderEntry(fieldMatches, `${groupName}\u0000${label}`, {
        label,
        field,
        match_semantics: "exact JavaScript identifier occurrence",
      }),
    ),
  ]),
);

const stringValueCatalogs = Object.fromEntries(
  Object.entries(STRING_VALUE_GROUPS).map(([groupName, values]) => [
    groupName,
    values.map(([label, value]) =>
      renderEntry(stringValueMatches, `${groupName}\u0000${label}`, {
        label,
        value,
        match_semantics: "exact short quoted JavaScript string",
      }),
    ),
  ]),
);

const knownModelEvidence = knownModels.map((model) =>
  renderEntry(knownModelMatches, model.model, {
    ...model,
    evidence_source:
      "Model identifier from the existing privacy-safe model roster, correlated to exact quoted strings in runtime chunks",
  }),
);
const publicModelCandidates = renderAggregate(publicModelCandidateMatches).map((entry) => {
  const { name: model, ...evidence } = entry;
  return {
    model,
    match_semantics: "heuristic public model-family string candidate; not a routing assertion",
    ...evidence,
  };
});

const cssIndex = archiveIndex(cssManifest);
const referencedAssetIndex = archiveIndex(referencedAssetsManifest);
const referencedJavascriptAssets = javascriptAssetCatalog(referencedAssetIndex);
const workerNamedAssets = referencedJavascriptAssets.filter(
  (entry) => entry.role === "worker_named_asset",
);
const wasmAssets = referencedAssetIndex.filter((entry) => entry.extension === "wasm");

const runtimeArchiveVerified =
  files.length === manifest.totals.advertised_chunks &&
  totalBytes === manifest.totals.archived_bytes &&
  hashMismatches === 0 &&
  byteMismatches === 0 &&
  filesMissingFromManifest === 0;
const cssArchiveVerification = verifyArchiveManifest(CSS_DIR, cssManifest);
const referencedAssetVerification = verifyArchiveManifest(
  REFERENCED_ASSETS_DIR,
  referencedAssetsManifest,
);

const audit = {
  schema_version: 2,
  scope:
    "Every JavaScript chunk advertised by the captured Notion Rspack runtime, plus archived runtime CSS, directly referenced public assets, and correlation with the existing privacy-safe model roster.",
  privacy_boundary: {
    included:
      "Local archive filenames, hashes, byte counts, code identifiers, short allowlisted protocol values, provider lexemes, model identifiers, and literal API pathnames without query strings.",
    excluded:
      "Source snippets, prompts, request or response payloads, full URLs, query strings, headers, cookies, credentials, user/account identifiers, and arbitrary quoted strings.",
  },
  evidence_rules: {
    direct_api_callsite:
      "A literal eventName directly passed as the first property to callApi, callCellCompatibleApi, or callStreamApi proves a shipped client callsite reference. It does not prove execution, request success, or server implementation.",
    literal_path:
      "A literal /api/v3 pathname proves only that the pathname occurs in archived code. Queries are deliberately excluded.",
    field_or_value_occurrence:
      "An exact identifier or quoted value is lexical evidence only. Object membership, schema shape, and runtime state transitions require separate control-flow or live evidence.",
    provider_or_model_occurrence:
      "A provider/model string proves client awareness or metadata only. It does not prove the active upstream provider, deployed model, direct browser-to-provider traffic, or routing behavior.",
    referenced_asset:
      "A verified manifest entry proves the public asset was archived and referenced by at least one runtime chunk according to the manifest. Identifier signals do not prove the asset executed.",
    absence:
      "Zero literal occurrences in all archived browser chunks is client-side negative evidence only, never proof about private server code.",
  },
  archive_verification: {
    runtime_chunks: {
      advertised_js_chunks: manifest.totals.advertised_chunks,
      scanned_js_files: files.length,
      scanned_js_bytes: totalBytes,
      manifest_archived_bytes: manifest.totals.archived_bytes,
      hash_mismatches: hashMismatches,
      byte_mismatches: byteMismatches,
      files_missing_from_manifest: filesMissingFromManifest,
      all_advertised_chunks_verified: runtimeArchiveVerified,
    },
    runtime_css: {
      totals: cssManifest.totals,
      ...cssArchiveVerification,
    },
    referenced_assets: {
      totals: referencedAssetsManifest.totals,
      ...referencedAssetVerification,
    },
  },
  api_surface: {
    literal_api_v3_paths: renderAggregate(literalEndpoints),
    direct_client_api_event_callsite_pairs: allApiEvents.length,
    high_signal_ai_named_pairs: highSignalAiApiEvents.length,
    ai_or_adjacent_named_pairs: namedAiApiEvents.length,
    all_streaming_pairs: streamApiEvents.length,
    ai_or_adjacent_named_streaming_pairs: namedAiStreamApiEvents.length,
    high_signal_ai_named: highSignalAiApiEvents,
    ai_or_adjacent_named: namedAiApiEvents,
    all_streaming: streamApiEvents,
    ai_or_adjacent_named_streaming: namedAiStreamApiEvents,
  },
  provider_lexeme_evidence: providers,
  model_evidence: {
    roster_source: "analysis/model-roster.json",
    roster_models_checked: knownModels.length,
    roster_models_with_runtime_occurrences: knownModelEvidence.filter(
      (entry) => entry.total_occurrences > 0,
    ).length,
    known_roster_models: knownModelEvidence,
    additional_public_model_string_candidates: publicModelCandidates,
  },
  exact_identifier_catalogs: fieldCatalogs,
  exact_quoted_value_catalogs: stringValueCatalogs,
  archived_asset_catalogs: {
    runtime_css: cssIndex,
    referenced_asset_index: referencedAssetIndex,
    referenced_javascript_assets: referencedJavascriptAssets,
    worker_named_assets: workerNamedAssets,
    wasm_assets: wasmAssets,
  },
};

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(audit, null, 2)}\n`, { mode: 0o644 });

const apiCsvRows = [
  [
    "event",
    "client_method",
    "classification_strength",
    "classification_tags",
    "total_occurrences",
    "file_count",
    "files",
  ],
  ...namedAiApiEvents.map((entry) => [
    entry.event,
    entry.client_method,
    entry.classification_strength,
    entry.classification_tags.join("; "),
    entry.total_occurrences,
    entry.file_count,
    entry.files.map((file) => `${file.file} (${file.occurrences})`).join("; "),
  ]),
];
fs.writeFileSync(
  API_CSV_PATH,
  `${apiCsvRows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`,
  { mode: 0o644 },
);

const modelCsvRows = [
  ["model", "provider", "family", "evidence_kind", "total_occurrences", "file_count", "files"],
  ...knownModelEvidence.map((entry) => [
    entry.model,
    entry.provider,
    entry.family,
    "existing_roster_exact_quoted_runtime_correlation",
    entry.total_occurrences,
    entry.file_count,
    entry.files.map((file) => `${file.file} (${file.occurrences})`).join("; "),
  ]),
  ...publicModelCandidates.map((entry) => [
    entry.model,
    "",
    "",
    "heuristic_public_model_string_candidate",
    entry.total_occurrences,
    entry.file_count,
    entry.files.map((file) => `${file.file} (${file.occurrences})`).join("; "),
  ]),
];
fs.writeFileSync(
  MODEL_CSV_PATH,
  `${modelCsvRows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`,
  { mode: 0o644 },
);

const providerCsvRows = [
  [
    "provider",
    "matched_lexeme",
    "total_occurrences",
    "file_count",
    "interpretation_limit",
    "files",
  ],
  ...providers.map((entry) => [
    entry.provider,
    entry.matched_lexeme,
    entry.total_occurrences,
    entry.file_count,
    entry.interpretation_limit,
    entry.files.map((file) => `${file.file} (${file.occurrences})`).join("; "),
  ]),
];
fs.writeFileSync(
  PROVIDER_CSV_PATH,
  `${providerCsvRows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`,
  { mode: 0o644 },
);

const openRouterEvidence = providers.find((entry) => entry.provider === "OpenRouter");
const fieldEvidence = (group, field) =>
  fieldCatalogs[group].find((entry) => entry.field === field);
const valueEvidence = (group, value) =>
  stringValueCatalogs[group].find((entry) => entry.value === value);
const protocolHighlights = [
  ["callStreamApi", "exact identifier", fieldEvidence("transport_and_framing", "callStreamApi")],
  ["application/x-ndjson", "exact quoted value", valueEvidence("streaming_formats_and_event_values", "application/x-ndjson")],
  ["text/event-stream", "exact quoted value", valueEvidence("streaming_formats_and_event_values", "text/event-stream")],
  ["patch-start", "exact quoted value", valueEvidence("streaming_formats_and_event_values", "patch-start")],
  ["patch-sync", "exact quoted value", valueEvidence("streaming_formats_and_event_values", "patch-sync")],
  ["inputTokens", "exact identifier", fieldEvidence("token_usage_and_limits", "inputTokens")],
  ["outputTokens", "exact identifier", fieldEvidence("token_usage_and_limits", "outputTokens")],
  ["cachedTokensRead", "exact identifier", fieldEvidence("token_usage_and_limits", "cachedTokensRead")],
  ["cachedTokensCreated", "exact identifier", fieldEvidence("token_usage_and_limits", "cachedTokensCreated")],
  ["contextManagementConfiguration", "exact identifier", fieldEvidence("compaction_and_summary_fields", "contextManagementConfiguration")],
  ["compactThreshold", "exact identifier", fieldEvidence("compaction_and_summary_fields", "compactThreshold")],
  ["runningSummaryText", "exact identifier", fieldEvidence("compaction_and_summary_fields", "runningSummaryText")],
  ["previousAttemptValues", "exact identifier", fieldEvidence("failure_retry_and_cancel_fields", "previousAttemptValues")],
  ["isModelFailover", "exact identifier", fieldEvidence("failure_retry_and_cancel_fields", "isModelFailover")],
  ["retryInference", "exact identifier", fieldEvidence("failure_retry_and_cancel_fields", "retryInference")],
  ["reasoningEffort", "exact identifier", fieldEvidence("tool_and_thinking_fields", "reasoningEffort")],
  ["agent-tool-result", "exact quoted value", valueEvidence("failure_retry_cancel_tool_thinking_values", "agent-tool-result")],
  ["registered-tool-call", "exact quoted value", valueEvidence("failure_retry_cancel_tool_thinking_values", "registered-tool-call")],
];
const summaryLines = [
  "# Full runtime static audit",
  "",
  "## Scope and evidence boundary",
  "",
  `This audit verified and scanned all ${files.length.toLocaleString("en-US")} archived runtime JavaScript chunks (${totalBytes.toLocaleString("en-US")} bytes), ${cssIndex.length} runtime CSS chunks, and ${referencedAssetIndex.length} directly referenced public assets. It records static occurrences, not runtime execution or private server behavior.`,
  "",
  "No source snippets, prompts, payloads, full URLs, queries, headers, cookies, credentials, or user/account identifiers are copied into the generated catalogs.",
  "",
  "## Static callsites versus observed traffic",
  "",
  "A direct client API event in this audit means only that an archived bundle contains a literal `eventName` at a recognized API-wrapper callsite. It is not an observed request, response, successful invocation, or server endpoint implementation.",
  "",
  "Likewise, provider/model lexemes and protocol fields are shipped-client string evidence, not proof of the active upstream route or model. Observed traffic belongs to the separate sanitized HAR/live-capture analyses and is not counted or replayed here.",
  "",
  "## Precise findings",
  "",
  `- Runtime archive integrity: ${runtimeArchiveVerified ? "verified" : "FAILED"}; CSS archive integrity: ${cssArchiveVerification.all_entries_verified ? "verified" : "FAILED"}; referenced-asset integrity: ${referencedAssetVerification.all_entries_verified ? "verified" : "FAILED"}.`,
  `- Direct literal client API callsite pairs: ${allApiEvents.length}; high-signal AI-named pairs: ${highSignalAiApiEvents.length}; broader AI-adjacent/ambiguous named pairs: ${namedAiApiEvents.length}.`,
  `- Direct streaming callsite pairs: ${streamApiEvents.length}; AI-named or adjacent streaming pairs: ${namedAiStreamApiEvents.length}.`,
  `- Literal query-free /api/v3 pathnames: ${renderAggregate(literalEndpoints).length}. These are independent of the event-name callsite catalog because the generic client can construct routes dynamically.`,
  `- OpenRouter quoted-lexeme occurrences: ${openRouterEvidence.total_occurrences} across ${openRouterEvidence.file_count} files. Zero is negative evidence for these archived browser chunks only.`,
  `- Existing roster model identifiers checked: ${knownModels.length}; exact quoted runtime matches: ${knownModelEvidence.filter((entry) => entry.total_occurrences > 0).length}.`,
  `- Referenced JavaScript/module assets: ${referencedJavascriptAssets.length}; filename-evident worker assets: ${workerNamedAssets.length}; WASM assets: ${wasmAssets.length}; runtime CSS assets: ${cssIndex.length}.`,
  "",
  "## Protocol string and field highlights",
  "",
  "| Candidate | Match | Occurrences | Files |",
  "| --- | --- | ---: | ---: |",
  ...protocolHighlights.map(
    ([name, matchKind, evidence]) =>
      `| ${name} | ${matchKind} | ${evidence.total_occurrences} | ${evidence.file_count} |`,
  ),
  "",
  "The two MIME values above have no exact quoted occurrence in this runtime-chunk archive. That does not override transport evidence in other archived client files or live captures; it only bounds this chunk set.",
  "",
  "## Provider lexeme occurrences",
  "",
  "| Lexeme | Occurrences | Files | Interpretation |",
  "| --- | ---: | ---: | --- |",
  ...providers.map(
    (entry) =>
      `| ${entry.provider} | ${entry.total_occurrences} | ${entry.file_count} | ${entry.interpretation_limit} |`,
  ),
  "",
  "## False-positive controls and limits",
  "",
  "- Provider evidence is counted only as a bounded lexeme inside short quoted strings; broad case-insensitive source substrings are not treated as provider proof.",
  "- AI event classification uses camel-case segments, so an embedded sequence such as the `Ai` in `Airtable` is not AI evidence.",
  "- Generic model, prompt, transcript, summary, and workflow-credit names remain labeled adjacent or ambiguous rather than high-signal.",
  "- Exact fields and state values are lexical candidates. They are not presented as reconstructed object schemas or demonstrated state machines.",
  "- Provider/model names in browser code do not establish upstream routing, model deployment, credentials, or direct browser-to-provider traffic.",
  "",
  "## Generated catalogs",
  "",
  "- `full-runtime-static-audit.json`: complete static catalog and verified local asset indexes.",
  "- `full-runtime-ai-api-events.csv`: AI-named and AI-adjacent direct client API callsite candidates.",
  "- `full-runtime-model-evidence.csv`: existing-roster correlations and heuristic public-model candidates.",
  "- `full-runtime-provider-evidence.csv`: provider lexeme counts, including explicit zero-count evidence.",
  "",
];
fs.writeFileSync(SUMMARY_PATH, `${summaryLines.join("\n")}\n`, { mode: 0o644 });

console.log(
  JSON.stringify({
    js_files: files.length,
    js_bytes: totalBytes,
    runtime_hashes_ok: runtimeArchiveVerified,
    high_signal_ai_api_events: highSignalAiApiEvents.length,
    ai_or_adjacent_api_events: namedAiApiEvents.length,
    stream_api_events: streamApiEvents.length,
    openrouter_quoted_lexeme_occurrences: openRouterEvidence.total_occurrences,
    known_models_with_runtime_occurrences: knownModelEvidence.filter(
      (entry) => entry.total_occurrences > 0,
    ).length,
    output: path.basename(OUTPUT_PATH),
  }),
);
