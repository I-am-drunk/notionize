(() => {
  "use strict";

  const VERSION = 1;
  const DB_NAME = "NotionizeCapture";
  const STORE_NAME = "events";
  const TARGET_PATH = "/api/v3/runInferenceTranscript";
  const DEFAULT_CONTEXT_CONFIG = Object.freeze({
    recentSearchToolResultsToKeep: -1,
    createSummaryThreshold: 0.01,
    updateSummaryInterval: 0.005,
    compactThreshold: 0.02,
  });

  if (globalThis.__notionizeCapture?.version === VERSION) {
    console.info("Notionize capture hook is already installed.");
    return;
  }

  const sessionId = crypto.randomUUID();
  const originalFetch = globalThis.fetch.bind(globalThis);
  let contextConfig = { ...DEFAULT_CONTEXT_CONFIG };

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        const store = database.createObjectStore(STORE_NAME, {
          keyPath: "eventId",
          autoIncrement: true,
        });
        store.createIndex("sessionId", "sessionId");
        store.createIndex("requestId", "requestId");
        store.createIndex("phase", "phase");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  const databasePromise = openDatabase();

  async function storeEvent(event) {
    const database = await databasePromise;
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).add({
        sessionId,
        epochMs: Date.now(),
        monotonicMs: performance.now(),
        ...event,
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  function headersToObject(headersLike) {
    try {
      return Object.fromEntries(new Headers(headersLike).entries());
    } catch {
      return {};
    }
  }

  function isTarget(url) {
    try {
      return new URL(url, location.href).pathname === TARGET_PATH;
    } catch {
      return false;
    }
  }

  function shouldCaptureBody(url) {
    try {
      const parsed = new URL(url, location.href);
      return parsed.origin === location.origin && parsed.pathname.startsWith("/api/v3/");
    } catch {
      return false;
    }
  }

  function rewriteTargetBody(bodyText) {
    try {
      const value = JSON.parse(bodyText);
      value.debugOverrides = {
        ...(value.debugOverrides || {}),
        contextManagementConfiguration: {
          ...(value.debugOverrides?.contextManagementConfiguration || {}),
          ...contextConfig,
        },
        emitFullAgentSteps: true,
        emitDebugErrors: true,
      };
      return { bodyText: JSON.stringify(value), rewritten: true };
    } catch (error) {
      void storeEvent({
        phase: "hook-error",
        requestId: null,
        target: true,
        message: `Target request body was not JSON: ${String(error)}`,
      });
      return { bodyText, rewritten: false };
    }
  }

  async function readRequestBody(input, init, method) {
    if (typeof init?.body === "string") return init.body;
    if (input instanceof Request && !["GET", "HEAD"].includes(method)) {
      try {
        return await input.clone().text();
      } catch {
        return null;
      }
    }
    return null;
  }

  function rebuildRequest(input, init, method, bodyText) {
    if (input instanceof Request) {
      const replacement = new Request(input, {
        ...(init || {}),
        method,
        body: bodyText,
      });
      return { input: replacement, init: undefined };
    }
    return {
      input,
      init: {
        ...(init || {}),
        method,
        body: bodyText,
      },
    };
  }

  async function captureResponseBody(response, requestId, target) {
    const clone = response.clone();
    if (!clone.body) {
      await storeEvent({ phase: "response-end", requestId, target, chunkCount: 0 });
      return;
    }
    const reader = clone.body.getReader();
    let chunkIndex = 0;
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      totalBytes += bytes.byteLength;
      await storeEvent({
        phase: "response-chunk",
        requestId,
        target,
        chunkIndex,
        byteLength: bytes.byteLength,
        bytes,
      });
      chunkIndex += 1;
    }
    await storeEvent({
      phase: "response-end",
      requestId,
      target,
      chunkCount: chunkIndex,
      totalBytes,
    });
  }

  globalThis.fetch = async function notionizeFetch(input, init) {
    const url = input instanceof Request ? input.url : String(input);
    const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const requestId = crypto.randomUUID();
    const target = isTarget(url);
    const deepCapture = shouldCaptureBody(url);
    let bodyText = await readRequestBody(input, init, method);
    let rewritten = false;
    let outgoingInput = input;
    let outgoingInit = init;

    if (target && typeof bodyText === "string") {
      const result = rewriteTargetBody(bodyText);
      bodyText = result.bodyText;
      rewritten = result.rewritten;
      if (rewritten) {
        const replacement = rebuildRequest(input, init, method, bodyText);
        outgoingInput = replacement.input;
        outgoingInit = replacement.init;
      }
    }

    await storeEvent({
      phase: "request",
      requestId,
      target,
      url,
      method,
      headers: headersToObject(init?.headers || (input instanceof Request ? input.headers : undefined)),
      bodyText: deepCapture ? bodyText : null,
      bodyRewritten: rewritten,
      contextConfig: target ? { ...contextConfig } : null,
    });

    try {
      const response = await originalFetch(outgoingInput, outgoingInit);
      await storeEvent({
        phase: "response-start",
        requestId,
        target,
        url: response.url || url,
        status: response.status,
        statusText: response.statusText,
        headers: headersToObject(response.headers),
      });
      if (deepCapture) {
        void captureResponseBody(response, requestId, target).catch((error) =>
          storeEvent({
            phase: "hook-error",
            requestId,
            target,
            message: `Response capture failed: ${String(error)}`,
          }),
        );
      }
      return response;
    } catch (error) {
      await storeEvent({
        phase: "fetch-error",
        requestId,
        target,
        message: String(error),
      });
      throw error;
    }
  };

  async function getAllEvents() {
    const database = await databasePromise;
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function bytesToBase64(bytes) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binary = "";
    for (let offset = 0; offset < view.length; offset += 0x8000) {
      binary += String.fromCharCode(...view.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }

  async function exportCapture() {
    const events = await getAllEvents();
    const portableEvents = events.map((event) => {
      if (!(event.bytes instanceof Uint8Array)) return event;
      const { bytes, ...rest } = event;
      return { ...rest, bytesBase64: bytesToBase64(bytes) };
    });
    const payload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      database: DB_NAME,
      currentSessionId: sessionId,
      events: portableEvents,
    };
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `notionize-live-${new Date().toISOString().replaceAll(":", "-")}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 60_000);
    return { eventCount: events.length, filename: anchor.download };
  }

  async function stats() {
    const events = await getAllEvents();
    const phaseCounts = {};
    let targetEvents = 0;
    for (const event of events) {
      phaseCounts[event.phase] = (phaseCounts[event.phase] || 0) + 1;
      if (event.target) targetEvents += 1;
    }
    return { eventCount: events.length, targetEvents, phaseCounts, sessionId };
  }

  globalThis.__notionizeCapture = {
    version: VERSION,
    sessionId,
    databaseName: DB_NAME,
    setContextConfig(next) {
      contextConfig = { ...contextConfig, ...next };
      return { ...contextConfig };
    },
    getContextConfig() {
      return { ...contextConfig };
    },
    stats,
    export: exportCapture,
    stop() {
      globalThis.fetch = originalFetch;
      return true;
    },
  };

  void storeEvent({
    phase: "hook-installed",
    requestId: null,
    target: false,
    version: VERSION,
    contextConfig: { ...contextConfig },
  });
  console.info("Notionize capture hook installed", {
    version: VERSION,
    database: DB_NAME,
    contextConfig,
  });
})();
