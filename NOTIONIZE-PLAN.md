# Notionize — Implementation Plan

> Distilled from a messy brain-dump, then expanded. Baselines: **a3 code / T3 Code**
> (practices, monorepo taste, remote-ready, YAGNI), the **Framer Account Manager
> prototype** (pure core + thin adapters, account pool, credential boundary, loopback
> gateway, minimalistic UI), the **Notionize reference archive** (Notion private
> `/api/v3` surface), and **Tailscale** (single daemon, CLI control, boot service).

---

## 0. What Notionize is

A single, reliable, always-on service that automates **Notion AI** on your behalf:

- Log in to Notion and hold multiple accounts.
- Run AI requests through a chosen account/workspace (the "pipeline").
- When a workspace runs out of credits, **automatically spin up a fresh workspace** and keep going.
- Expose all of this through a **REST API + a tiny web UI** you can reach remotely over Tailscale.
- Let other tools (Claude Code / Codex today, "anything" later) consume it through a compatibility layer.

Runtime: **Rust** for the core, CLI, daemon, and HTTP server (one binary). **TypeScript/React** only for the web UI, built to static files and served by that same binary.

---

## 1. Non-negotiables (the whole point)

1. **YAGNI, ruthlessly.** Smallest model that makes correct behavior unsurprising. No dashboards, no metrics strips, no abstractions "because it looks architecturally impressive." Don't preserve complexity that already exists elsewhere. (Theo's note, A3.)
2. **The code is as small as humanly possible.** Few comments; comments describe *how a thing is used*, not every line. Inferred types, no `any`-equivalents.
3. **Pure core, dumb UI, complexity at the boundary.** The core never touches HTTP quirks; the UI never builds a Notion request or picks an account; all the mess lives in the Notion adapter. (Framer's #1 lesson.)
4. **The fragile part is isolated and swappable.** Everything that depends on Notion's private, undocumented endpoints lives in tiny one-file-per-endpoint modules behind a trait. If Notion changes an endpoint, you edit one small file — nothing else moves.
5. **Secrets never live next to state.** Non-secret account/workspace state in SQLite; the actual session (`token_v2` cookie jar) in the OS keychain. The account model holds a *reference*, never the secret. (Framer ADR-001.)
6. **Reliable for 24/7.** Self-healing listeners with backoff, persisted state machines, fail-closed on credit exhaustion, and "only 401 means signed out — every other error is retryable so we never destroy a healthy account." (Framer token-endpoint policy.)
7. **Remote-ready by default.** The daemon binds so the web UI + REST are reachable over Tailscale, no hand-wired tunnels.

---

## 2. Architecture at a glance

```
                          ┌──────────────────────────────────────┐
   web UI (React/Vite) ─▶ │           notionize (one binary)       │
   REST + SSE over HTTP    │  CLI  +  daemon  +  HTTP/REST server   │
   (local or Tailscale)    └───────────────┬────────────────────────┘
                                            │
                         ┌──────────────────┼─────────────────────┐
                         ▼                  ▼                     ▼
                  notion-core         notion-store          compat/ (adapters)
              (pure orchestration)  (sqlite + keychain)   Claude Code / Codex / …
                         │
                         ▼
                   notion-api  ◀── the FRAGILE, swappable layer (one file / endpoint)
```

Everything above `notion-api` is stable. `notion-api` is the only thing expected to churn when Notion changes.

---

## 3. Repository layout

A small Cargo workspace + one `web/` app. Every crate is small on purpose.

```
notionize/
├── Cargo.toml                # workspace
├── AGENTS.md                 # agent guide (distilled from A3 — see §12)
├── README.md
├── crates/
│   ├── notion-core/          # STABLE. domain + orchestration, no HTTP details
│   │   └── src/
│   │       ├── account.rs     # ManagedAccount model + state machine
│   │       ├── workspace.rs   # workspace/space model, credit state
│   │       ├── pipeline.rs    # run one AI request end-to-end
│   │       ├── rotation.rs    # pick account/workspace, failover, cooldown
│   │       └── credits.rs     # exhaustion → new-workspace policy
│   │
│   ├── notion-api/           # FRAGILE. one tiny file per Notion endpoint
│   │   └── src/
│   │       ├── transport.rs   # cookie auth, x-notion-active-user / space headers, zstd
│   │       ├── login.rs       # getLoginOptions + credential exchange (⚠ must be reversed live)
│   │       ├── session.rs     # cookie jar shape (token_v2 / notion_users)
│   │       ├── inference.rs   # runInferenceTranscript + NDJSON patch parser
│   │       ├── credits.rs     # getAIUsageEligibilityV2 / getCreditRateLimitStatus
│   │       ├── workspace.rs   # validateUserCanCreateWorkspace / createSpace
│   │       └── models.rs      # getAvailableModels + codename catalog (volatile)
│   │
│   ├── notion-store/         # persistence: SQLite (non-secret) + keychain (secrets)
│   ├── notion-server/        # REST + SSE HTTP server + static web hosting
│   ├── notion-testkit/       # testing CLI, script runner, mock server, fixtures
│   └── notionize/            # the binary: CLI + daemon wiring
│
├── web/                      # React/Vite SPA (minimalistic, Framer-distilled) → static build
├── compat/                   # extension/compatibility layer (Claude Code, Codex, …)
│   ├── claude/               # loopback Anthropic gateway + launcher that execs `claude`
│   └── README.md             # how to add a new consumer (the "anything" story)
├── platform/                 # OS-specific service install (versioned per OS)
│   ├── macos/                # launchd plist + install/uninstall
│   └── linux/                # systemd unit + install/uninstall
├── docs/                     # by audience (user / internals / operations) + ADRs
│   ├── CODEMAP.md            # feature → owning file (Framer practice)
│   └── adr/                  # numbered decision records
└── .agents/skills/           # authored skills (see §11)
```

---

## 4. The fragile boundary (`notion-api`) — most important part

Everything Notion-specific that could break lives here, one endpoint per file, all behind a single `NotionClient` trait so `notion-core` never sees the wire.

Key facts baked into this layer (from the reference archive):

- **Auth is cookies, not tokens.** `token_v2` (session secret) + `notion_users` (JSON list of all signed-in user IDs). No bearer.
- **Per-request scoping:** every `/api/v3/*` POST carries `x-notion-active-user-header: <userId>` (which account acts) and `x-notion-space-id: <spaceId>` (which workspace).
- **Responses are zstd; inference is NDJSON**, not SSE.
- **Inference contract:** `runInferenceTranscript` → NDJSON lifecycle `patch-start → patch* → record-map → patch-sync`. Assistant text is grown by `x` (string-extend) opcodes; `patch-sync.data.s` is authoritative; token usage arrives only at the terminal patch (must buffer).
- **Credit exhaustion signal (trust this one):** an exhausted request still returns **HTTP 200 NDJSON**, but truncated to `patch-start → record-map` with discriminator **`premium-feature-unavailable`** and no `patch-sync`. **Fail closed** — never treat it as an empty success.
- **Known gap:** the archive documents how a session is *used*, not how it's *minted*. The password / email-code exchange that produces `token_v2` was never captured. `login.rs` is the highest-risk file and will need live reverse-engineering.

Rule: if any of these change, we touch **only** the relevant file in `notion-api`. `notion-core` and everything above stay put.

---

## 5. Data & secrets model (`notion-store`)

- **SQLite** (single file under the data dir): accounts (id, alias, active-user id, state, last-used, consecutive-failures, cooldown), workspaces (space id, owning account, credit snapshot), run history. **Never any cookie/token/password column.** (Framer even asserts secret-column checks.)
- **OS keychain / encrypted-at-rest:** the cookie jar per account (`token_v2`, `notion_users`). The account row holds only a reference.
- **State machine per account** (centralized, one place): `disconnected → authenticating → ready`, plus `cooling_down`, `exhausted`, `quarantined`. Live health (`healthy/refresh_required/expired/failed`) is separate and merged only for display.

---

## 6. Core operations & the pipeline (`notion-core`)

The four operations you named, made concrete:

1. **Log in to Notion** — `login.rs`: probe with `getLoginOptions`, then the credential-exchange step; capture the resulting cookie jar; store session in keychain; create/attach the account row.
2. **Add an account** — there is no "add account" RPC in Notion; you run login again and append the new user to the shared jar. `account add` = login flow + persist.
3. **Core pipeline (run a request)** — `pipeline.rs`:
   - pick account + workspace (`rotation.rs`),
   - pre-flight `getAIUsageEligibilityV2` + `getCreditRateLimitStatus`,
   - `runInferenceTranscript` (buffer the NDJSON, parse patches),
   - on terminal `patch-sync`: return text + usage; mark seen.
4. **Auto new-workspace on exhaustion** — `credits.rs` reactor:
   - detect `premium-feature-unavailable` (or exhausted balance) →
   - `validateUserCanCreateWorkspace` → `createSpace` → capture new `spaceId` →
   - retarget subsequent requests at the new workspace, transparently.
   This is exactly your "every time a workspace runs out of credits, it makes a new workspace" — one small, testable policy.

**Streaming an account** = two things, both here: (a) live status/health published over SSE to the UI; (b) request output streamed back to callers as SSE, replayed from the buffered NDJSON so a mid-stream failure can still failover before output begins.

---

## 7. Web UI (`web/`) — distilled from the Framer SwiftUI prototype

Minimalistic, native-feeling, **served as static files by the Rust binary**, talking REST + SSE. Framer's UI vocabulary maps cleanly to web:

- **Layout:** sidebar + detail (Framer's `NavigationSplitView`). Sidebar has 3 pages — **Accounts / Logs / Test** — and a collapsible "Active pool / Inactive pool" list with counts.
- **Detail = grouped form of labeled rows** (Framer's `.formStyle(.grouped)` + `LabeledContent`): a hero header (avatar monogram + alias + status badge + primary actions) then sections: Authentication, Workspace/Credits, Usage, Recent runs, Controls.
- **One status → visual mapping in one place** (Framer's `AccountStatusStyle`): green ready · blue authenticating · orange cooling/refresh · red exhausted · purple quarantined · gray disconnected. Status dot in rows, tinted capsule badge in headers. Never scatter color literals.
- **Sheets** for add-account (login) and settings. **Test page** (see §8) is a first-class sidebar destination.
- Keep it dumb: it renders server state and fires typed REST calls. No client-side account logic.

We will look at the prototype's actual views again when building this, per your instruction — only the Framer Account Manager, nothing else.

---

## 8. Testing CLI + Test page (`notion-testkit`)

Goal you stated: with an account already loaded in Notionize, test new techniques **without rebuilding/redeploying the whole app or risking it**. All over REST.

- **`notionize test`** — a scripting surface that runs small scripts against loaded accounts through the *same* `notion-api` + `notion-store`, in a sandbox that never mutates production state unless asked.
- **Mock server + fixtures** (Framer's `FramerLoopbackMockServer` + recorded fixtures): replay recorded Notion responses so endpoint parsing can be tested offline and deterministically.
- **Deterministic verifier** (Framer's `FramerAccountVerifier`): named test groups, each attributable on failure, runnable headless; a `--only` filter to narrow runs. Hand-rolled, no heavy framework, so the core stays linkable and fast.
- **Test page** in the web UI: pick a loaded account, run a script/prompt, watch the streamed result and the raw NDJSON — the safe place to probe new endpoints live.

---

## 9. Compatibility layer (`compat/`) — the "connect to Claude Code / anything" story

Copied almost verbatim from the Framer prototype's Claude integration, which is the cleanest known pattern:

- A **loopback Anthropic-compatible HTTP gateway** (local `127.0.0.1:<port>`) speaking Anthropic Messages JSON/SSE, backed by Notionize's pipeline.
- A tiny **launcher** that writes an isolated Claude config dir, sets `ANTHROPIC_BASE_URL` to the loopback, delivers the local bearer via `apiKeyHelper` (never as a CLI literal), strips real API keys, and `exec`s the user's `claude` binary.
- Everything Claude-specific stays in `compat/claude/`. Adding a new consumer ("anything") = a new folder implementing the same small adapter trait. Codex would be a parallel folder, exactly as Framer keeps Responses and Anthropic paths separate.

---

## 10. Service / daemon (`platform/`) — Tailscale-style

You want the Tailscale feel: starts on boot, you never see it, you drive it from the CLI.

- **CLI + daemon split** like `tailscale` / `tailscaled`: `notionize` (control) talks to a long-running `notionize` daemon over a local socket.
- **`notionize service install`** installs and enables the boot service, mirroring `systemctl enable --now`:
  - **macOS:** a LaunchDaemon plist in `platform/macos/` (`launchctl load -w`), versioned separately because it's OS-specific.
  - **Linux:** a systemd unit in `platform/linux/` (`enable --now`, persistent state dir, restart policy).
- Persistent state on disk so reboots reconnect without re-login; daemon *running* and node *ready* are tracked separately (Tailscale's own caveat).
- `notionize up` / `down` / `status` for the day-to-day, like `tailscale up`.

Sources for the daemon/boot model: [tailscaled docs](https://tailscale.com/docs/reference/tailscaled), [Tailscale boot/systemd notes](https://github.com/tailscale/tailscale/issues/11599).

---

## 11. Remote access (Tailscale)

- Bind the HTTP server so it's reachable on the tailnet; document `tailscale serve` for HTTPS on the tailnet.
- The web UI and REST API are the remote control surface — manage the Notion server from your phone/another machine, exactly like A3/T3 leans on Tailscale for remote.

---

## 12. Agents & skills to author (the A3 practice)

Mirror A3's `.agents/skills/` + `AGENTS.md` discipline so this stays easy to maintain:

- **`AGENTS.md`** (distilled from A3): glossary, "ways to hurt yourself" (e.g. never run scripts against the live production state; never widen the credential boundary), where code lives, taste (YAGNI, small crates, isolate the fragile layer), how to verify.
- **Skills** (`.agents/skills/<name>/SKILL.md`):
  - `notion-endpoint-repair` — how to diagnose and fix a broken `notion-api/*.rs` file when Notion changes (capture → compare fixture → patch one file).
  - `add-notion-account` — the login/add-account flow end to end.
  - `write-test-script` — authoring scripts for the testing CLI against loaded accounts.
  - `new-compat-adapter` — add a consumer under `compat/`.
  - `service-install` — per-OS boot service install/debug.
- **Docs discipline:** `docs/CODEMAP.md` (feature → owning file) and numbered `docs/adr/` records — starting with **ADR-001 credential boundary** and **ADR-002 the fragile-endpoint isolation rule**.

---

## 13. Build order (milestones, each shippable)

1. **Workspace skeleton** — crates + `web/` stub + `AGENTS.md` + CODEMAP + ADR-001/002. GitHub repo created.
2. **`notion-api` transport + session** — cookie auth, headers, zstd; fixtures + mock server so it's testable offline.
3. **Login + add account** — the risky live reverse-engineering; land it behind the trait with fixtures.
4. **Pipeline** — `runInferenceTranscript` + NDJSON parser + buffered result; `notionize run` works from the CLI.
5. **Credits + auto-workspace** — exhaustion detection + `createSpace` rotation.
6. **Store** — SQLite + keychain; account state machine persisted.
7. **Server + web UI** — REST/SSE, Framer-distilled UI, Accounts/Logs/Test pages.
8. **Testing CLI + verifier** — scripting surface + named test groups.
9. **compat/claude** — loopback gateway + launcher.
10. **platform service** — launchd + systemd install; Tailscale remote doc.

Each milestone ends green (targeted tests + typecheck), nothing repo-wide.

---

## 14. Decisions (locked)

- **Server model:** ONE Rust binary is the daemon + REST/SSE server and also serves the compiled React/Vite UI as static files. TypeScript is UI-only. Single artifact, best for 24/7.
- **Repo:** GitHub **private**.
- **v1 scope (thin vertical slice):** login → run one AI request → auto-create workspace on exhaustion → minimal UI. Then layer testkit, `compat/claude`, and the boot service.
- **Where I build:** scaffolded inside this sandboxed working directory under `notionize/`. You relocate it to `~/Documents/Notionize` and run `gh repo create` + first push yourself (commands provided). Live Notion integration + testing happens after relocation, because this sandbox can't reach Notion.
