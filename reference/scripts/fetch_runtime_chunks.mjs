#!/usr/bin/env node

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REFERENCE_DIR = path.resolve(SCRIPT_DIR, "..");
const BROWSER_CODE_DIR = path.join(REFERENCE_DIR, "assets", "browser-code");
const EMBEDDED_FILES_DIR = path.join(BROWSER_CODE_DIR, "files");
const OUTPUT_DIR = path.join(BROWSER_CODE_DIR, "runtime-chunks");
const OUTPUT_FILES_DIR = path.join(OUTPUT_DIR, "files");
const MANIFEST_PATH = path.join(OUTPUT_DIR, "runtime-chunk-manifest.json");
const BASE_URL = "https://app.notion.com/_assets/";
const CONCURRENCY = Math.max(1, Math.min(32, Number(process.env.NOTIONIZE_FETCH_CONCURRENCY || 12)));
const MAX_ATTEMPTS = 3;

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function parseObjectPairs(source) {
  const result = new Map();
  const pairPattern = /(?:^|[{,])(\d+):"([^"]+)"/g;
  for (const match of source.matchAll(pairPattern)) {
    result.set(match[1], match[2]);
  }
  return result;
}

function extractChunkCatalog(runtimeSource) {
  const resolverStart = runtimeSource.indexOf("d.u=e=>");
  const resolverEnd = runtimeSource.indexOf(",d.miniCssF=", resolverStart);
  if (resolverStart < 0 || resolverEnd < 0) {
    throw new Error("Could not locate the Rspack JavaScript chunk resolver");
  }

  const resolver = runtimeSource.slice(resolverStart + "d.u=e=>".length, resolverEnd);
  const nameStartMarker = "(({";
  const nameEndMarker = "})[e]||e)";
  const hashStartMarker = '+"-"+({';
  const hashEndMarker = '})[e]+".js"';
  const nameStart = resolver.indexOf(nameStartMarker);
  const nameEnd = resolver.indexOf(nameEndMarker, nameStart);
  const hashStart = resolver.indexOf(hashStartMarker, nameEnd);
  const hashEnd = resolver.indexOf(hashEndMarker, hashStart);
  if ([nameStart, nameEnd, hashStart, hashEnd].some((offset) => offset < 0)) {
    throw new Error("The Rspack chunk resolver has an unexpected shape");
  }

  const names = parseObjectPairs(resolver.slice(nameStart + 2, nameEnd + 1));
  const hashes = parseObjectPairs(resolver.slice(hashStart + hashStartMarker.length - 1, hashEnd + 1));
  if (hashes.size === 0) {
    throw new Error("The Rspack chunk hash map is empty");
  }

  return [...hashes.entries()]
    .map(([chunkId, hash]) => {
      const stem = names.get(chunkId) || chunkId;
      const filename = `${stem}-${hash}.js`;
      if (
        !/^[A-Za-z0-9_@.+\/-]+\.js$/.test(filename) ||
        filename.startsWith("/") ||
        filename.includes("..") ||
        path.posix.normalize(filename) !== filename
      ) {
        throw new Error(`Unsafe runtime chunk filename for chunk ${chunkId}`);
      }
      return { chunk_id: chunkId, filename };
    })
    .sort((left, right) => Number(left.chunk_id) - Number(right.chunk_id));
}

async function findRuntime() {
  const filenames = (await fs.readdir(EMBEDDED_FILES_DIR)).filter(
    (name) => name.startsWith("app-") && name.endsWith(".js"),
  );
  if (filenames.length !== 1) {
    throw new Error(`Expected one captured app runtime, found ${filenames.length}`);
  }
  return path.join(EMBEDDED_FILES_DIR, filenames[0]);
}

async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchChunk(entry) {
  const destination = path.join(OUTPUT_FILES_DIR, entry.filename);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try {
    const existing = await fs.readFile(destination);
    if (existing.length > 0) {
      return {
        ...entry,
        url: new URL(entry.filename, BASE_URL).href,
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

  const url = new URL(entry.filename, BASE_URL).href;
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "error",
        headers: {
          Accept: "text/javascript,application/javascript;q=0.9,*/*;q=0.1",
          "User-Agent": "Notionize-static-archive/1.0",
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const contentType = response.headers.get("content-type") || "";
      if (!/javascript|text\/plain/i.test(contentType)) {
        throw new Error(`unexpected content type ${JSON.stringify(contentType)}`);
      }
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length === 0) {
        throw new Error("empty response body");
      }
      const temporary = `${destination}.partial`;
      await fs.writeFile(temporary, body, { mode: 0o644 });
      await fs.rename(temporary, destination);
      return {
        ...entry,
        url,
        file: path.relative(OUTPUT_DIR, destination),
        status: response.status,
        source: "downloaded",
        content_type: contentType,
        etag: response.headers.get("etag"),
        last_modified: response.headers.get("last-modified"),
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
    url,
    file: null,
    status: null,
    source: "failed",
    error: String(lastError?.message || lastError),
    bytes: 0,
    sha256: null,
  };
}

async function mapConcurrent(entries, worker, concurrency) {
  const results = new Array(entries.length);
  let nextIndex = 0;
  let completed = 0;
  async function run() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= entries.length) return;
      results[index] = await worker(entries[index]);
      completed += 1;
      if (completed % 100 === 0 || completed === entries.length) {
        process.stdout.write(`processed ${completed}/${entries.length}\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => run()));
  return results;
}

async function main() {
  await fs.mkdir(OUTPUT_FILES_DIR, { recursive: true });
  const runtimePath = await findRuntime();
  const runtimeBody = await fs.readFile(runtimePath);
  const catalog = extractChunkCatalog(runtimeBody.toString("utf8"));
  process.stdout.write(`runtime advertises ${catalog.length} JavaScript chunks\n`);
  const entries = await mapConcurrent(catalog, fetchChunk, CONCURRENCY);
  const failed = entries.filter((entry) => entry.source === "failed");
  const manifest = {
    schema_version: 1,
    privacy_boundary:
      "Public immutable JavaScript assets only. No browser credentials, cookies, signed-in document URLs, request bodies, or private API responses are used.",
    source_runtime: path.relative(REFERENCE_DIR, runtimePath),
    source_runtime_sha256: sha256(runtimeBody),
    base_url: BASE_URL,
    totals: {
      advertised_chunks: catalog.length,
      archived_chunks: entries.length - failed.length,
      downloaded_chunks: entries.filter((entry) => entry.source === "downloaded").length,
      reused_chunks: entries.filter((entry) => entry.source === "existing").length,
      failed_chunks: failed.length,
      archived_bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    },
    entries,
  };
  await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  process.stdout.write(`${JSON.stringify(manifest.totals)}\n`);
  if (failed.length > 0) {
    process.stderr.write(`failed chunk ids: ${failed.map((entry) => entry.chunk_id).join(",")}\n`);
    process.exitCode = 1;
  }
}

await main();
