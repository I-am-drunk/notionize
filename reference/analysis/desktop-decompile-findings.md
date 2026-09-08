# Notion desktop decompile: static findings (v7.31.3)

Local static analysis of the Notion macOS desktop app, decompiled into
`reference/desktop-decompile/`. All line numbers refer to the prettified main-process
bundle `reference/desktop-decompile/pretty/main-index.js` (6.38 MB, ~142k lines) unless
stated otherwise. No app was launched and no authenticated request was replayed for this
document; every claim is a static-code observation.

## 1. Provenance and integrity

| Field | Value |
|---|---|
| Product | Notion (`productName: "Notion"`) |
| Version | **7.31.3** (`package.json`) |
| Runtime | **Electron 42.4.1** (`pnpm-lock.yaml`: `electron@42.4.1`) |
| Crash/telemetry SDK | `@sentry/electron@7.11.0` |
| Build tooling | Electron Forge 7.8.1 (`@electron-forge/*`) |
| Source | `https://desktop-release.notion-static.com/Notion-7.31.3.zip` |
| Download | `reference/desktop-decompile/downloads/Notion-7.31.3.zip` (126,113,061 bytes) |
| Integrity | SHA-512 matched the value in Notion's own `latest-mac.yml` update manifest |

The zip was chosen over the DMG because it needs no mount step. The published version at
capture time (2026-08-27, per the manifest) was 7.31.3.

## 2. Package layout and the main/renderer split

`Notion.app/Contents/Resources/app.asar` (9.2 MB) was extracted with `@electron/asar` to
`reference/desktop-decompile/app-extracted/`. The Electron **main process** bundle is
`.webpack/main/index.js` (3.9 MB minified → 6.38 MB prettified). The **renderer** does not
ship its AI code inside the asar; it loads the same web runtime already archived in this
repository:

```
grep -oE "https://app\.notion\.com|https://www\.notion\.so" main-index.js
→ app.notion.com, www.notion.so (renderer load targets)
```

The main process contains **zero** AI-inference symbols:

| Symbol | Count in `main-index.js` |
|---|---|
| `runInferenceTranscript` | 0 |
| `getAvailableModels` | 0 |
| `contextManagementConfiguration` | 0 |
| `createSummaryThreshold` | 0 |

**Conclusion:** all model selection, transcript/compaction logic, and inference streaming
live in the renderer (the archived `app.notion.com` runtime chunks). The desktop layer owns
OS-level capabilities the web app cannot reach: local filesystem writes, system-audio
capture, window/tab management, secure preference storage, and telemetry. The most
consequential of those, for the Notionize thesis, is the **local skill-install surface**
described next.

## 3. Headline finding: the local coding-agent skill-install surface

Notion desktop ships a native, IPC-exposed mechanism that writes **agent skill files**
(`SKILL.md`) and skill assets into the local install roots of five coding agents. This is
the product-side implementation of "connect Notion to Claude / code / codex," and it is
already shipping in 7.31.3.

### 3.1 Install targets and agent roots (module 72746)

```js
// main-index.js ~110357 (module 72746)
t.SKILL_INSTALL_TARGETS = {
  "claude-code": { agentName: "Claude Code", skillsRoot: join(homedir(), ".claude", "skills") },
  codex:         { agentName: "Codex",       skillsRoot: join(homedir(), ".codex",  "skills") },
  cursor:        { agentName: "Cursor",      skillsRoot: join(homedir(), ".cursor", "skills") },
  gemini:        { agentName: "Gemini",      skillsRoot: join(homedir(), ".gemini", "skills") },
  grok:          { agentName: "Grok Build",  skillsRoot: join(homedir(), ".grok",   "skills") },
};
```

| Target id | Display name | Skills root |
|---|---|---|
| `claude-code` | Claude Code | `~/.claude/skills` |
| `codex` | Codex | `~/.codex/skills` |
| `cursor` | Cursor | `~/.cursor/skills` |
| `gemini` | Gemini | `~/.gemini/skills` |
| `grok` | Grok Build | `~/.grok/skills` |

These are exactly the roots the open SKILL.md convention uses, and they line up with the
agent list in Notion's own MCP setup docs (see the integration-research note).

### 3.2 IPC surface — four request/response channels (module 99674)

`setupSkillFileIpc()` registers four channels on the renderer→main request bridge
(`handleRequestFromRenderer`). It is invoked during app boot at line **45286**, so the
surface is live, not dead code.

| IPC channel | Handler | Purpose |
|---|---|---|
| `notion:check-existing-local-skill-installs` | `checkExistingLocalSkillInstalls` | Report which agents already have `{skillsRoot}/{slug}/SKILL.md` |
| `notion:write-skill-file` | `writeSkillFile` | Write a single `SKILL.md` |
| `notion:write-skill-assets` | `writeSkillAssets` | Download + write skill asset files |
| `notion:manage-skill-directories` | `manageSkillDirectories` | `list` / `revoke` / `clear` approved directories |

### 3.3 Argument validators (module 8049)

The renderer payloads are validated with a Zod-like schema before any filesystem work:

```js
writeSkillFileArgsValidator = object({
  required: { contents: string, path: string },
  optional: { agentName: string, overwrite: boolean, permissionPath: string },
});
writeSkillAssetsArgsValidator = object({
  required: {
    assets: array(object({ downloadUrl: string, relativePath: string })),
    skillSlug: string,
    target: literals("claude-code", "codex", "cursor", "gemini", "grok"),
  },
  optional: { overwrite: boolean },
});
checkExistingLocalSkillInstallsArgsValidator = object({
  required: { skillSlug: string, targetIds: array(literals("claude-code","codex","cursor","gemini","grok")) },
});
```

### 3.4 `writeSkillFile` (modules 99460 / 141504)

- Validates the path, then requires the file extension to be **`.md`**.
- Requires the resolved path to sit **inside one of the five `skillsRoot` directories**
  (`isPathInsideDirectory`); otherwise `invalid-path`.
- Enforces a **5,242,880-byte (5 MiB)** cap on the markdown contents (`d = 5242880`).
- Delegates the write to `validateAndWriteLocalSkillFiles`.

### 3.5 `writeSkillAssets` (module 83091 / 122623)

Handles multi-file skill bundles (docs, images, scripts) that accompany a `SKILL.md`.

- **Asset count cap:** `y = 50` assets per call (`too-many-assets` otherwise).
- **Extension allowlist** (`S`): `.md .txt .json .yaml .yml .csv .pdf .png .jpg .jpeg
  .webp .gif .py .js .ts`. Anything else → `invalid-extension`.
- **Relative-path safety** (`E`): rejects empty, backslash, absolute (posix or win32), and
  control/bidi characters; validates each path segment.
- **Download source allowlist** (`w` → `isSecureFileURL`, module 6318): only
  `https://file.notion.so/`, `https://file-dev.notion.so/`, `https://file-stg.notion.so/`,
  `https://file.notion.com/`, `https://file.dev.notion.com/`, `https://file.stg.notion.com/`,
  and the dev path `http://localhost:3000/f-local/`. **No arbitrary URLs.**
- **Fetch hardening** (`M`): `getSession().fetch(url, { redirect: "manual" })`, then the
  post-fetch `response.url` is **re-validated** against the same allowlist — a redirect to
  an off-allowlist host fails as `invalid-source`. This blocks the classic redirect-based
  SSRF.
- **Size caps:** per-asset **26,214,400 bytes (25 MiB)** (`b`), per-batch **104,857,600
  bytes (100 MiB)** (`T`). The cap is re-checked on every streamed chunk, so a lying
  `content-length` cannot defeat it.
- **Atomic write:** streamed to a temp file `.{name}.notion-skill.{uuid}.tmp`, then
  `link` (no-overwrite; `EEXIST` → `already-exists`) or `rename` (overwrite). Stale temp
  files matching `.notion-skill.*.tmp` are swept first.

### 3.6 `checkExistingLocalSkillInstalls` (module 87817 / 129507)

For each requested target, validates `skillSlug` as a path segment and checks whether
`{skillsRoot}/{skillSlug}/SKILL.md` (`p = "SKILL.md"`) exists, returning
`{ target, agentName, skillFilePath }` per hit. Read-only.

### 3.7 Security / consent model (module 37537)

This module is the trust boundary and is worth reading in full. Verified behavior:

- **`validateSkillPathSegment`** rejects `""`, `.`, `..`, `~`, any segment containing `/`,
  `\`, or `:`, any control/bidi character (`CONTROL_OR_BIDI = /[\p{Cc}\p{Cf}]/u`), and the
  literal `skill.md` (case-folded — prevents a lowercase collision with the required
  `SKILL.md`).
- **`validateLocalPath`** expands `~`, rejects control/bidi and stray drive-colons, and
  requires an absolute, normalized path.
- **Real-path resolution + containment:** every target directory is resolved through
  `resolveRealPath` (symlink resolution) and must be within the permission root and within
  an approved directory.
- **Symlink target rejection:** if the final file path is itself a symlink (`lstat
  isSymbolicLink`), the write fails as `symlink-target`.
- **Consent dialog:** if the resolved directory is not already approved, a native modal is
  shown — `"Allow Notion to install skills for {agentName}?"` (or `"…to this folder?"`),
  buttons `["Allow", "Cancel"]`. On approval the directory is appended to
  `approvedSkillDirectories` in the secure-preferences store; on denial → `consent-denied`.
- **Rate limits** (rolling 60 s window `w = 60000`): **500 writes** (`v = 500`) **or 512
  MiB** (`E = 536870912`) per minute across all skill writes → `rate-limited`.
- **`manageSkillDirectories`** (module 43057) exposes `list`, `revoke` (drop one approved
  dir, case-folded compare), and `clear` (drop all).

### 3.8 Telemetry for the surface

Each asset write emits an analytics event via `analyticsLogger.track`:

```
eventName: "local_skill_asset_write"
props: { outcome, target_id, asset_count, total_bytes, overwrite, duration_ms,
         failure_kind?, limit_scope? }
```

### 3.9 Why this matters

The renderer (Notion AI, running on `app.notion.com`) can call these IPC channels to push a
Notion-authored "skill" straight into a local coding agent's skills directory, gated by a
one-time per-directory consent dialog and hard filesystem safety rails. This is Notion
writing instructions **into** Claude Code / Codex / Cursor / Gemini / Grok — the exact
integration the Notionize project set out to test, shipping natively.

## 4. Second desktop-native AI surface: meeting notes / audio transcription

The desktop app owns a system-audio capture and transcription pipeline the browser cannot
replicate. Representative IPC channels (32 distinct in the family):

```
notion:core-audio-tap
notion:enforce-single-active-transcription
notion:set-meeting-notes-extension-transcription-active
notion:meeting-notes-speaker-activity
notion:meeting-notes-mic-mute-state
notion:running-input-audio-processes-changed
notion:quick-search-create-meeting-notes
notion:request-audio-capture-access-with-result
```

`audioController` (13 references) and `transcription` (24 references) implement a
single-active-transcription tap over Core Audio, speaker/mic activity signalling, and a
"create meeting notes" entry point. The captured audio is transcribed and handed to the
renderer's AI notes feature. The desktop supplies the OS capture; the AI summarization is
again renderer/server-side.

## 5. Telemetry / observability stack

| System | Evidence in main bundle |
|---|---|
| **Sentry** | `@sentry/electron@7.11.0`; `sentry.io` / `ingest.sentry` hosts (5 hits) |
| **Statsig** | 8 references; the renderer reads dynamic configs such as `ai_agent_progressive_transcript_compression_threshold` (see compaction-design.md) |
| **Datadog** | 5 references |
| **First-party analytics** | `analyticsLogger.track(...)` — 28 call sites, including `electron_tab_groups`, `local_skill_asset_write` |

Statsig is the key one for the AI story: the renderer's compaction thresholds are resolved
from a Statsig dynamic config, which means Notion can change AI context-management behavior
server-side without shipping a new client.

## 6. What the desktop app is not

- It is **not** where inference happens. No `runInferenceTranscript`, model roster, or
  context-management config exists in the main process.
- It does **not** contain a hidden local AI endpoint or model credentials.
- It does **not** expose Notion's AI models to third parties; its outward-facing AI
  integration is the skill-install writer (push instructions to agents) plus the OS audio
  tap (feed audio to Notion's own AI).

## 7. Reproduction

```sh
cd reference/desktop-decompile
# integrity
python3 -c "import hashlib,base64;print(base64.b64encode(hashlib.sha512(open('downloads/Notion-7.31.3.zip','rb').read()).digest()).decode())"
# extract asar (already done into app-extracted/)
npx --yes @electron/asar extract app-raw/Notion.app/Contents/Resources/app.asar app-extracted
# prettified bundle is pretty/main-index.js
grep -n "SKILL_INSTALL_TARGETS\|setupSkillFileIpc\|validateLocalSkillWriteAccess" pretty/main-index.js
```
