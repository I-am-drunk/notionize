#!/usr/bin/env node

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REFERENCE_DIR = path.resolve(SCRIPT_DIR, "..");
const RUNTIME_DIR = path.join(REFERENCE_DIR, "assets", "browser-code", "runtime-chunks");
const RUNTIME_FILES_DIR = path.join(RUNTIME_DIR, "files");
const OUTPUT_DIR = path.join(REFERENCE_DIR, "assets", "browser-code", "referenced-assets");
const OUTPUT_FILES_DIR = path.join(OUTPUT_DIR, "files");
const MANIFEST_PATH = path.join(OUTPUT_DIR, "referenced-assets-manifest.json");
const BASE_URL = "https://app.notion.com/_assets/";
const CONCURRENCY = Math.max(1, Math.min(24, Number(process.env.NOTIONIZE_FETCH_CONCURRENCY || 12)));
const MAX_ATTEMPTS = 3;

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function isSafeRelativeAsset(value) {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_@.+/-]+\.(?:gif|js|json|mjs|png|riv|wasm|woff2)$/.test(value) &&
    !value.startsWith("/") &&
    !value.includes("..") &&
    path.posix.normalize(value) === value
  );
}

async function discoverAssets() {
  const sources = new Map();
  const filenames = (await fs.readdir(RUNTIME_FILES_DIR)).filter((name) => name.endsWith(".js"));
  for (const filename of filenames) {
    const source = await fs.readFile(path.join(RUNTIME_FILES_DIR, filename), "utf8");
    for (const match of source.matchAll(
      /(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?p\+"([A-Za-z0-9_@.+/-]+\.(?:gif|js|json|mjs|png|riv|wasm|woff2))"/g,
    )) {
      if (!isSafeRelativeAsset(match[1])) continue;
      if (!sources.has(match[1])) sources.set(match[1], new Set());
      sources.get(match[1]).add(filename);
    }
    for (const match of source.matchAll(
      /["']([A-Za-z][A-Za-z0-9_-]*Worker-[a-f0-9]{16,}\.js)["']/g,
    )) {
      if (!isSafeRelativeAsset(match[1])) continue;
      if (!sources.has(match[1])) sources.set(match[1], new Set());
      sources.get(match[1]).add(filename);
    }
  }
  return [...sources]
    .map(([asset, sourceFiles]) => ({ asset, source_files: [...sourceFiles].sort() }))
    .sort((left, right) => left.asset.localeCompare(right.asset));
}

async function fetchAsset(entry) {
  const destination = path.join(OUTPUT_FILES_DIR, entry.asset);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try {
    const existing = await fs.readFile(destination);
    if (existing.length) {
      return {
        ...entry,
        file: path.relative(OUTPUT_DIR, destination),
        status: 200,
        source: "existing",
        bytes: existing.length,
        sha256: sha256(existing),
      };
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const url = new URL(entry.asset, BASE_URL);
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "error",
        headers: { "User-Agent": "Notionize-static-archive/1.0" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") || "";
      if (/text\/html/i.test(contentType)) throw new Error(`unexpected content type ${contentType}`);
      const body = Buffer.from(await response.arrayBuffer());
      if (!body.length) throw new Error("empty response body");
      const temporary = `${destination}.partial`;
      await fs.writeFile(temporary, body, { mode: 0o644 });
      await fs.rename(temporary, destination);
      return {
        ...entry,
        file: path.relative(OUTPUT_DIR, destination),
        status: response.status,
        source: "downloaded",
        content_type: contentType,
        bytes: body.length,
        sha256: sha256(body),
      };
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) await sleep(250 * 2 ** (attempt - 1));
    }
  }
  return {
    ...entry,
    file: null,
    status: null,
    source: "failed",
    error: String(lastError?.message || lastError),
    bytes: 0,
    sha256: null,
  };
}

async function mapConcurrent(entries, worker, concurrency) {
  const output = new Array(entries.length);
  let cursor = 0;
  let completed = 0;
  async function run() {
    while (cursor < entries.length) {
      const index = cursor++;
      output[index] = await worker(entries[index]);
      completed += 1;
      if (completed % 50 === 0 || completed === entries.length) {
        process.stdout.write(`processed ${completed}/${entries.length}\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, run));
  return output;
}

const discovered = await discoverAssets();
await fs.mkdir(OUTPUT_FILES_DIR, { recursive: true });
const entries = await mapConcurrent(discovered, fetchAsset, CONCURRENCY);
const failed = entries.filter((entry) => entry.source === "failed");
const extensionCounts = {};
for (const entry of entries) {
  const extension = path.extname(entry.asset).slice(1).toLowerCase();
  extensionCounts[extension] = (extensionCounts[extension] || 0) + 1;
}
const manifest = {
  schema_version: 1,
  privacy_boundary:
    "Public immutable assets referenced by archived JavaScript only; no browser state, signed URLs, private records, cookies, or request bodies.",
  discovery:
    "Literal Rspack public-path exports plus hashed Monaco worker filenames found in all archived runtime chunks.",
  base_url: BASE_URL,
  totals: {
    discovered_assets: discovered.length,
    archived_assets: entries.length - failed.length,
    downloaded_assets: entries.filter((entry) => entry.source === "downloaded").length,
    reused_assets: entries.filter((entry) => entry.source === "existing").length,
    failed_assets: failed.length,
    archived_bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    extension_counts: Object.fromEntries(Object.entries(extensionCounts).sort(([a], [b]) => a.localeCompare(b))),
  },
  entries,
};
await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify(manifest.totals));
if (failed.length) process.exitCode = 1;
