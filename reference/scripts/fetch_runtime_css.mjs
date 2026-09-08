#!/usr/bin/env node

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REFERENCE_DIR = path.resolve(SCRIPT_DIR, "..");
const BROWSER_CODE_DIR = path.join(REFERENCE_DIR, "assets", "browser-code");
const EMBEDDED_FILES_DIR = path.join(BROWSER_CODE_DIR, "files");
const OUTPUT_DIR = path.join(BROWSER_CODE_DIR, "runtime-css");
const OUTPUT_FILES_DIR = path.join(OUTPUT_DIR, "files");
const MANIFEST_PATH = path.join(OUTPUT_DIR, "runtime-css-manifest.json");
const BASE_URL = "https://app.notion.com/_assets/";
const CONCURRENCY = Math.max(1, Math.min(16, Number(process.env.NOTIONIZE_FETCH_CONCURRENCY || 8)));

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

function parseObjectPairs(source) {
  const result = new Map();
  for (const match of source.matchAll(/(?:^|[{,])(\d+):"([^"]+)"/g)) {
    result.set(match[1], match[2]);
  }
  return result;
}

function extractCssCatalog(runtimeSource) {
  const start = runtimeSource.indexOf("d.miniCssF=e=>");
  const end = runtimeSource.indexOf(",d.g=", start);
  if (start < 0 || end < 0) throw new Error("Could not locate the Rspack CSS resolver");
  const resolver = runtimeSource.slice(start + "d.miniCssF=e=>".length, end);
  const nameStartMarker = "(({";
  const nameEndMarker = "})[e]||e)";
  const hashStartMarker = '+"-"+({';
  const hashEndMarker = '})[e]+".css"';
  const nameStart = resolver.indexOf(nameStartMarker);
  const nameEnd = resolver.indexOf(nameEndMarker, nameStart);
  const hashStart = resolver.indexOf(hashStartMarker, nameEnd);
  const hashEnd = resolver.indexOf(hashEndMarker, hashStart);
  if ([nameStart, nameEnd, hashStart, hashEnd].some((offset) => offset < 0)) {
    throw new Error("The Rspack CSS resolver has an unexpected shape");
  }
  const names = parseObjectPairs(resolver.slice(nameStart + 2, nameEnd + 1));
  const hashes = parseObjectPairs(
    resolver.slice(hashStart + hashStartMarker.length - 1, hashEnd + 1),
  );
  return [...hashes.entries()]
    .map(([chunkId, hash]) => ({
      chunk_id: chunkId,
      filename: `${names.get(chunkId) || chunkId}-${hash}.css`,
    }))
    .sort((left, right) => Number(left.chunk_id) - Number(right.chunk_id));
}

async function findRuntime() {
  const names = (await fs.readdir(EMBEDDED_FILES_DIR)).filter(
    (name) => name.startsWith("app-") && name.endsWith(".js"),
  );
  if (names.length !== 1) throw new Error(`Expected one app runtime, found ${names.length}`);
  return path.join(EMBEDDED_FILES_DIR, names[0]);
}

async function fetchEntry(entry) {
  if (
    !/^[A-Za-z0-9_@.+/-]+\.css$/.test(entry.filename) ||
    entry.filename.startsWith("/") ||
    entry.filename.includes("..") ||
    path.posix.normalize(entry.filename) !== entry.filename
  ) {
    throw new Error(`Unsafe CSS filename for chunk ${entry.chunk_id}`);
  }
  const destination = path.join(OUTPUT_FILES_DIR, entry.filename);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try {
    const existing = await fs.readFile(destination);
    if (existing.length) {
      return {
        ...entry,
        file: path.relative(OUTPUT_DIR, destination),
        source: "existing",
        status: 200,
        bytes: existing.length,
        sha256: sha256(existing),
      };
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const response = await fetch(new URL(entry.filename, BASE_URL), {
    redirect: "error",
    headers: {
      Accept: "text/css,*/*;q=0.1",
      "User-Agent": "Notionize-static-archive/1.0",
    },
  });
  if (!response.ok) throw new Error(`${entry.filename}: HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!/text\/css|text\/plain/i.test(contentType)) {
    throw new Error(`${entry.filename}: unexpected content type ${contentType}`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (!body.length) throw new Error(`${entry.filename}: empty response`);
  const temporary = `${destination}.partial`;
  await fs.writeFile(temporary, body, { mode: 0o644 });
  await fs.rename(temporary, destination);
  return {
    ...entry,
    file: path.relative(OUTPUT_DIR, destination),
    source: "downloaded",
    status: response.status,
    content_type: contentType,
    bytes: body.length,
    sha256: sha256(body),
  };
}

async function mapConcurrent(entries, worker, concurrency) {
  const output = new Array(entries.length);
  let cursor = 0;
  async function run() {
    while (cursor < entries.length) {
      const index = cursor++;
      output[index] = await worker(entries[index]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, run));
  return output;
}

const runtimePath = await findRuntime();
const runtimeBytes = await fs.readFile(runtimePath);
const catalog = extractCssCatalog(runtimeBytes.toString("utf8"));
await fs.mkdir(OUTPUT_FILES_DIR, { recursive: true });
const entries = await mapConcurrent(catalog, fetchEntry, CONCURRENCY);
const manifest = {
  schema_version: 1,
  privacy_boundary:
    "Public immutable CSS assets only; no browser session state, signed URLs, request bodies, or private responses.",
  source_runtime: path.relative(REFERENCE_DIR, runtimePath),
  source_runtime_sha256: sha256(runtimeBytes),
  base_url: BASE_URL,
  totals: {
    advertised_css_chunks: catalog.length,
    archived_css_chunks: entries.length,
    downloaded_css_chunks: entries.filter((entry) => entry.source === "downloaded").length,
    reused_css_chunks: entries.filter((entry) => entry.source === "existing").length,
    archived_bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
  },
  entries,
};
await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify(manifest.totals));
