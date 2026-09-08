#!/usr/bin/env node

import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_HAR = "/Users/irene/Documents/Notionize/reference/har/baseline-full.har";
const DEFAULT_OUTPUT = "/Users/irene/Documents/Notionize/reference/assets/browser-code";

const harPath = path.resolve(process.argv[2] || DEFAULT_HAR);
const outputRoot = path.resolve(process.argv[3] || DEFAULT_OUTPUT);
const filesRoot = path.join(outputRoot, "files");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const REDACTED_MAIN_DOCUMENT_URL = "__REDACTED_MAIN_DOCUMENT_URL__";

function catalogUrl(item) {
  return item.kind === "main-document" ? REDACTED_MAIN_DOCUMENT_URL : item.url;
}

function csvCell(value) {
  const rendered = value === null || value === undefined ? "" : String(value);
  return `"${rendered.replaceAll('"', '""')}"`;
}

function toCsv(rows, columns) {
  return [
    columns.map(csvCell).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\n") + "\n";
}

function normalizedMime(rawMime) {
  return String(rawMime || "").split(";", 1)[0].trim().toLowerCase();
}

function extensionForMime(mime) {
  if (mime === "text/css") return ".css";
  if (mime === "text/html" || mime === "application/xhtml+xml") return ".html";
  return ".js";
}

function safeBasename(url, kind, mime) {
  if (kind === "main-document") return `main-document${extensionForMime(mime)}`;
  let basename = "asset";
  try {
    basename = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) || "asset");
  } catch {
    // Retain the safe fallback when a malformed URL appears in a HAR.
  }
  basename = basename.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!basename) basename = "asset";
  const expectedExtension = extensionForMime(mime);
  if (!basename.toLowerCase().endsWith(expectedExtension)) basename += expectedExtension;
  return basename;
}

function decodeBody(content) {
  if (!content || typeof content.text !== "string") return null;
  if (String(content.encoding || "").toLowerCase() === "base64") {
    return Buffer.from(content.text.replace(/\s+/g, ""), "base64");
  }
  return Buffer.from(content.text, "utf8");
}

function countMatches(text, regex) {
  const counts = new Map();
  for (const match of text.matchAll(regex)) {
    const token = match[0];
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return counts;
}

function aiCategories(symbol) {
  const lower = symbol.toLowerCase();
  const categories = [];
  if (lower.includes("inference")) categories.push("inference");
  if (lower.includes("transcript")) categories.push("transcript");
  if (lower.includes("model")) categories.push("model");
  if (lower.includes("agent")) categories.push("agent");

  const aiToken = symbol === "ai"
    || symbol === "AI"
    || /^ai(?:[A-Z0-9_$]|_)/.test(symbol)
    || /(?:AI|Ai)$/.test(symbol)
    || /AI[A-Z0-9_$]/.test(symbol)
    || lower.includes("notionai")
    || lower.startsWith("ai_")
    || lower.endsWith("_ai")
    || lower.includes("_ai_");
  if (aiToken) categories.push("ai");
  return categories;
}

const rawHar = await readFile(harPath, "utf8");
const har = JSON.parse(rawHar);
const entries = Array.isArray(har?.log?.entries) ? har.log.entries : [];

const scriptMimes = new Set(["text/javascript", "application/javascript", "application/x-javascript"]);
const eligibleMimes = new Set([...scriptMimes, "text/css", "text/html", "application/xhtml+xml"]);
let mainDocumentSelected = false;

const selected = [];
for (let index = 0; index < entries.length; index += 1) {
  const entry = entries[index];
  // Deliberately access only URL plus response status/content. Request headers,
  // cookies, query parameter objects, and request bodies are never read.
  const url = typeof entry?.request?.url === "string" ? entry.request.url : "";
  const content = entry?.response?.content;
  const mime = normalizedMime(content?.mimeType);
  const isAppAsset = url.startsWith("https://app.notion.com/_assets/") && eligibleMimes.has(mime);
  const isMainDocument = !mainDocumentSelected
    && url.startsWith("https://app.notion.com/")
    && !url.startsWith("https://app.notion.com/_assets/")
    && (mime === "text/html" || mime === "application/xhtml+xml");
  if (!isAppAsset && !isMainDocument) continue;
  if (isMainDocument) mainDocumentSelected = true;
  selected.push({
    harEntryIndex: index,
    kind: isMainDocument ? "main-document" : "asset",
    url,
    status: Number(entry?.response?.status ?? 0),
    mime,
    content,
  });
}

await mkdir(filesRoot, { recursive: true });

const hashToFile = new Map();
const hashToFirstUrl = new Map();
const filenameToHash = new Map();
const manifestEntries = [];
const uniqueCode = [];

for (const item of selected) {
  const body = decodeBody(item.content);
  const embedded = body !== null;
  const digest = embedded ? sha256(body) : null;
  let relativeFile = null;
  let duplicateOf = null;

  if (embedded) {
    if (hashToFile.has(digest)) {
      relativeFile = hashToFile.get(digest);
      duplicateOf = hashToFirstUrl.get(digest);
    } else {
      const stem = safeBasename(item.url, item.kind, item.mime);
      const extension = path.extname(stem);
      const base = stem.slice(0, stem.length - extension.length);
      let filename = `${base}.${digest.slice(0, 16)}${extension}`;
      let discriminator = 1;
      while (filenameToHash.has(filename) && filenameToHash.get(filename) !== digest) {
        filename = `${base}.${digest.slice(0, 16)}-${discriminator}${extension}`;
        discriminator += 1;
      }
      filenameToHash.set(filename, digest);
      relativeFile = path.posix.join("files", filename);
      hashToFile.set(digest, relativeFile);
      hashToFirstUrl.set(digest, catalogUrl(item));
      await writeFile(
        path.join(outputRoot, relativeFile),
        body,
        item.kind === "main-document" ? { mode: 0o600 } : undefined,
      );
      uniqueCode.push({ item, body, digest, relativeFile });
    }
    if (item.kind === "main-document") {
      await chmod(path.join(outputRoot, relativeFile), 0o600);
    }
  }

  manifestEntries.push({
    har_entry_index: item.harEntryIndex,
    kind: item.kind,
    url: catalogUrl(item),
    mime: item.mime,
    status: item.status,
    embedded,
    content_encoding: item.content?.encoding || null,
    decoded_size: embedded ? body.length : null,
    sha256: digest,
    file: relativeFile,
    is_duplicate: duplicateOf !== null,
    duplicate_of_url: duplicateOf,
  });
}

const generatedAt = new Date().toISOString();
const manifest = {
  generated_at: generatedAt,
  source_har: path.basename(harPath),
  selection: "JavaScript/CSS/HTML responses under https://app.notion.com/_assets/ plus the first app.notion.com HTML document",
  privacy_boundary: "No request headers, cookies, request bodies, or non-code JSON response bodies were read or copied; the signed-in main-document URL is redacted and source files are recorded without absolute local paths.",
  totals: {
    selected_responses: manifestEntries.length,
    embedded_responses: manifestEntries.filter((entry) => entry.embedded).length,
    unique_content_hashes: hashToFile.size,
    duplicate_responses: manifestEntries.filter((entry) => entry.is_duplicate).length,
    decoded_bytes: manifestEntries.reduce((sum, entry) => sum + (entry.decoded_size || 0), 0),
    unique_decoded_bytes: uniqueCode.reduce((sum, entry) => sum + entry.body.length, 0),
  },
  entries: manifestEntries,
};

await writeFile(path.join(outputRoot, "asset-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
await writeFile(path.join(outputRoot, "asset-manifest.csv"), toCsv(manifestEntries, [
  "har_entry_index",
  "kind",
  "url",
  "mime",
  "status",
  "embedded",
  "content_encoding",
  "decoded_size",
  "sha256",
  "file",
  "is_duplicate",
  "duplicate_of_url",
]));

const endpointAggregate = new Map();
const symbolAggregate = new Map();
const endpointRegex = /\/api\/v3(?:\/[A-Za-z0-9._~!$&()*+,;=:@%{}[\]/?-]*)?/g;
const identifierRegex = /[A-Za-z_$][A-Za-z0-9_$]{1,127}/g;

for (const code of uniqueCode) {
  const text = code.body.toString("utf8");
  const scanText = text
    .replaceAll("\\/", "/")
    .replace(/\\u002f/gi, "/")
    .replace(/\\x2f/gi, "/");

  const endpointCounts = countMatches(scanText, endpointRegex);
  for (const [endpoint, occurrences] of endpointCounts) {
    if (!endpointAggregate.has(endpoint)) endpointAggregate.set(endpoint, { total: 0, files: [] });
    const aggregate = endpointAggregate.get(endpoint);
    aggregate.total += occurrences;
    aggregate.files.push({
      file: code.relativeFile,
      url: catalogUrl(code.item),
      occurrences,
    });
  }

  const localSymbols = new Map();
  for (const match of scanText.matchAll(identifierRegex)) {
    const symbol = match[0];
    const categories = aiCategories(symbol);
    if (categories.length === 0) continue;
    if (!localSymbols.has(symbol)) localSymbols.set(symbol, { occurrences: 0, categories: new Set() });
    const local = localSymbols.get(symbol);
    local.occurrences += 1;
    for (const category of categories) local.categories.add(category);
  }
  for (const [symbol, local] of localSymbols) {
    if (!symbolAggregate.has(symbol)) {
      symbolAggregate.set(symbol, { total: 0, categories: new Set(), files: [] });
    }
    const aggregate = symbolAggregate.get(symbol);
    aggregate.total += local.occurrences;
    for (const category of local.categories) aggregate.categories.add(category);
    aggregate.files.push({
      file: code.relativeFile,
      url: catalogUrl(code.item),
      occurrences: local.occurrences,
    });
  }
}

const endpoints = [...endpointAggregate.entries()]
  .map(([endpoint, value]) => ({
    endpoint,
    total_occurrences: value.total,
    file_count: value.files.length,
    files: value.files.sort((a, b) => a.file.localeCompare(b.file)),
  }))
  .sort((a, b) => a.endpoint.localeCompare(b.endpoint));

const symbols = [...symbolAggregate.entries()]
  .map(([symbol, value]) => ({
    symbol,
    categories: [...value.categories].sort(),
    total_occurrences: value.total,
    file_count: value.files.length,
    files: value.files.sort((a, b) => a.file.localeCompare(b.file)),
  }))
  .sort((a, b) => a.symbol.localeCompare(b.symbol));

const endpointCatalog = {
  generated_at: generatedAt,
  source_manifest: "asset-manifest.json",
  normalization: "Scanned literal /api/v3/ paths after decoding escaped slash forms (\\/, \\u002f, and \\x2f).",
  endpoint_count: endpoints.length,
  endpoints,
};
const symbolCatalog = {
  generated_at: generatedAt,
  source_manifest: "asset-manifest.json",
  methodology: "Identifier-like tokens were retained when they referenced inference, transcript, model, agent, or a bounded AI naming form.",
  symbol_count: symbols.length,
  symbols,
};

await writeFile(path.join(outputRoot, "api-v3-endpoints.json"), JSON.stringify(endpointCatalog, null, 2) + "\n");
await writeFile(path.join(outputRoot, "api-v3-endpoints.csv"), toCsv(endpoints.map((item) => ({
  endpoint: item.endpoint,
  total_occurrences: item.total_occurrences,
  file_count: item.file_count,
  files: item.files.map((file) => `${file.file} (${file.occurrences})`).join("; "),
})), ["endpoint", "total_occurrences", "file_count", "files"]));

await writeFile(path.join(outputRoot, "ai-symbols.json"), JSON.stringify(symbolCatalog, null, 2) + "\n");
await writeFile(path.join(outputRoot, "ai-symbols.csv"), toCsv(symbols.map((item) => ({
  symbol: item.symbol,
  categories: item.categories.join(";"),
  total_occurrences: item.total_occurrences,
  file_count: item.file_count,
  files: item.files.map((file) => `${file.file} (${file.occurrences})`).join("; "),
})), ["symbol", "categories", "total_occurrences", "file_count", "files"]));

const scanSummary = {
  generated_at: generatedAt,
  selected_responses: manifest.totals.selected_responses,
  embedded_responses: manifest.totals.embedded_responses,
  unique_files: manifest.totals.unique_content_hashes,
  duplicate_responses: manifest.totals.duplicate_responses,
  decoded_bytes: manifest.totals.decoded_bytes,
  unique_decoded_bytes: manifest.totals.unique_decoded_bytes,
  api_v3_endpoint_count: endpoints.length,
  ai_symbol_count: symbols.length,
  ai_category_counts: Object.fromEntries(["inference", "transcript", "model", "agent", "ai"].map((category) => [
    category,
    symbols.filter((item) => item.categories.includes(category)).length,
  ])),
};
await writeFile(path.join(outputRoot, "scan-summary.json"), JSON.stringify(scanSummary, null, 2) + "\n");

console.log(JSON.stringify(scanSummary, null, 2));
