# Notion AI integration surfaces: web research + client-code cross-check

This note answers the research questions the Notionize brief raised: does Notion expose an
AI CLI or AI endpoint that a third-party tool can use via Notion login; does Notion use
feature names like "agent"; and if those are renamed, does usage still get tracked. Each
web finding is cross-checked against the decompiled client evidence in this archive.

Research date: 2026-08-29. Sources are Notion's own docs/help/blog plus the hosted-MCP
setup page, corroborated by third-party write-ups.

## 1. TL;DR for the Notionize thesis

- **There is no public endpoint to borrow Notion's AI models.** Notion's inference facade
  (`POST app.notion.com/api/v3/runInferenceTranscript`, already archived here) is
  session-authenticated and metered server-side by credits. It is not documented, not a
  CLI, and not reachable with a Notion API token.
- **The integration that does exist runs the other way and is already shipping.** Two
  directions, both real:
  1. **Notion MCP server** (`https://mcp.notion.com/mcp`): external agents (Claude Code,
     Codex, Cursor, VS Code, Gemini/Antigravity, Devin, …) read/write Notion **content**
     using **their own** models and billing.
  2. **Notion desktop skill-install** (decompiled here): Notion pushes `SKILL.md` files
     into those same agents' local roots. This is the "Skills" half of Notion's Claude Code
     plugin.
- **A third bridge** — Notion **Custom Agents + External Agents API** — lets Notion's own
  agents call external MCP tools, and lets hosted Claude/Cursor agents act inside a Notion
  workspace. That path runs on **Notion credits**.
- **Renaming client feature/thread labels does not change metering.** Usage is enforced
  server-side against the workspace's credit ledger, keyed by `spaceId`, not by the client
  thread label.

## 2. Notion MCP (hosted): the content bridge

Official, hosted, OAuth-only remote MCP server.

| Property | Value |
|---|---|
| Streamable HTTP endpoint | `https://mcp.notion.com/mcp` |
| SSE fallback | `https://mcp.notion.com/sse` |
| Auth | OAuth authorization (no PAT/JSON needed); non-interactive auth "not yet" |
| Tools | search, read, query databases/data sources, create/update/move pages, comments, `notion-create-file-upload` (≤20 MiB) |
| Old path | open-source `notion-mcp-server` (bearer token + v1 JSON APIs), now unmaintained |

Per-client configuration from Notion's setup page — note the config paths match the
decompiled skill roots:

| Client | Config |
|---|---|
| Claude Code | `claude mcp add --transport http notion https://mcp.notion.com/mcp` |
| Codex | `~/.codex/config.toml` → `[mcp_servers.notion] url = "https://mcp.notion.com/mcp"` |
| Cursor | `~/.cursor/mcp.json` (or project `.cursor/mcp.json`) |
| VS Code (Copilot) | `.vscode/mcp.json` |
| Devin / Pi / fx / Hermes / Antigravity | remote HTTP + OAuth |

**Direction:** external LLM → Notion content. It does **not** return Notion AI completions;
the connecting agent supplies its own model. So MCP is not a way to "use Notion's AI."

## 3. Notion desktop skill-install: the instruction bridge (decompiled)

Notion's docs say: *"Install the Notion plugin for Claude Code to add the MCP server,
**Skills**, and slash commands for common Notion workflows"*
(`makenotion/claude-code-notion-plugin`). The **Skills** delivery is exactly the decompiled
desktop IPC in `desktop-decompile-findings.md` §3:

- IPC `notion:write-skill-file` / `notion:write-skill-assets` write `SKILL.md` (+ assets)
  into `~/.claude/skills`, `~/.codex/skills`, `~/.cursor/skills`, `~/.gemini/skills`,
  `~/.grok/skills`.
- SKILL.md is a shared open format across those agents, so one Notion-authored skill installs
  identically everywhere.

**Direction:** Notion → external agent's instruction set. This is the closest match to the
Notionize idea, and it is native in 7.31.3.

## 4. Custom Agents + External Agents API: the credit-metered bridge

- **Notion 3.0: Agents** (released 2025-09-18) rebuilt "Notion AI" as **Agents**; the
  follow-on is **Custom Agents** (autonomous, scheduled, multi-step).
- **Connect Custom Agents to MCP integrations** (Notion Help): Custom Agents can call
  **external** MCP tools — this is the client feature name `mcp_ai_access` observed in the
  runtime chunks.
- **External Agents API / "Use Claude agents in Notion"** (Business/Enterprise; off by
  default on Enterprise/HIPAA; Settings → Notion AI → Agent → Manage external agents): lets
  hosted Claude/Cursor agents participate inside a Notion workspace, wired with OAuth +
  Workers.

All of this consumes **Notion credits** when Notion's side runs, which is the metering
described next.

## 5. How Notion tracks AI usage (client-code cross-check)

Web docs: *"Notion credits let you run **Custom Agents, Workers**, and additional usage for
certain Notion AI features beyond the usage allowance"*; credits were introduced *"to bill
the one feature that can run away with cost: Custom Agents."*

This matches the decompiled client exactly. Usage is a **server-authoritative credit
ledger**, surfaced to the client through cached RPCs:

| Client symbol (runtime chunks) | Role |
|---|---|
| `getAIUsageEligibilityV2` (chunk 78277) | server RPC keyed by `spaceId`; returns `basicCredits`, `premiumCredits`; cached in `AIUsageEligibilityStoreV2_C` |
| `getCreditRateLimitStatus` / `creditRateLimitVerdict` | verdict `within_limit` \| `rate_limited` \| `not_applicable`, with `window`, `resetsInSeconds`/`retryAfterSeconds`, `enforcement`, `creditTier` |
| `custom_agents_credit_usage` | `currentServicePeriodLimit`, `overageLimit`, `remainingMonthlyAllocation`, `totalCreditBalance`, `creditsInOverage` |
| `ai_usage_overage` | overage state |
| error `premium-feature-unavailable` | returned when eligibility/rate-limit fails |

Feature entitlements are keyed by **`featureName`**, checked server-side:

```
featureName: "ai_usage" | "custom_agents" | "custom_agents_credit_usage"
           | "mcp_ai_access" | "workers"
feature:     "ai_assistant" | "ai_block" | "ai_image_generation" | "ai_research_mode"
```

Thread labels are a **separate** dimension: `threadType: "personal_agent" | "workflow"`.

### 5.1 Answering "if we rename the agent feature, does usage still get tracked?"

Yes. Renaming client-side identifiers cannot bypass metering, for three structural reasons
visible in the code:

1. **The ledger is server-side, keyed by `spaceId`/`userId`.**
   `getAIUsageEligibilityV2({ spaceId })` returns the credit balance from the server; the
   client never owns the counter.
2. **The rate-limit verdict is computed from server data.** `creditRateLimitVerdict` reads
   `getData(environment, { spaceId })` and returns `rate_limited` with a server-issued
   `retryAfterSeconds`/`resumesAtMs`. A relabeled thread still hits the same verdict.
3. **The metered unit is the inference call, not the label.** Billing attaches to the
   actual `runInferenceTranscript` execution and its credit tier, independent of the
   `threadType` or display feature name. This is corroborated by the two archived HAR
   captures where an ordinary chat turn returned an HTTP-200 **quota** body
   (`premium-feature-unavailable`) rather than a stream — i.e. enforcement fired without any
   special "agent" labelling.

The practical implication for Notionize: a client patch that renames `personal_agent` or
hides the "agent" feature name changes only UI/telemetry strings. The inference request
still carries the session, still resolves to a `spaceId`, and is still gated by
`getAIUsageEligibilityV2` + `creditRateLimitVerdict` before the server streams tokens.

## 6. Consolidated answer to the brief's questions

| Question | Answer |
|---|---|
| Is there a Notion **AI CLI**? | No AI-inference CLI. There is a developer CLI + hosted MCP for **content**, and per-agent CLI commands to add the MCP server. |
| Another endpoint that "has all the info" to use Notion's AI? | No. The only AI-inference endpoint is the internal, session-auth, credit-metered `api/v3/runInferenceTranscript`. MCP returns content, not completions. |
| Can a third-party tool use Notion **login + AI**? | It can use Notion **login (OAuth) + content** (MCP), or invite external agents in (External Agents API, on Notion credits). It cannot call Notion's models directly. |
| Does Notion use feature names like "agent"? | Yes: product name **Agents/Custom Agents**; client `featureName` entitlements `custom_agents`, `custom_agents_credit_usage`, `mcp_ai_access`, `ai_usage`, `workers`; thread `personal_agent`. |
| If renamed, is usage still tracked? | Yes — metering is server-side per `spaceId` credit ledger + rate-limit verdict, independent of client labels. |
| How does Notion track usage? | `basicCredits`/`premiumCredits` ledger per workspace, `getAIUsageEligibilityV2`, `getCreditRateLimitStatus`/`creditRateLimitVerdict` (`within_limit`/`rate_limited`), overage via `ai_usage_overage`, failures as `premium-feature-unavailable`. |

## 7. Sources

- Notion Docs — Notion MCP overview, Connect to Notion MCP, Supported tools
  (`developers.notion.com/guides/mcp/*`).
- Notion Help — Connect AI tools with Notion MCP; Connect Custom Agents to MCP
  integrations; Use Claude agents in Notion; Notion credits category.
- Notion Blog / Releases — Introducing Notion 3.0 (Agents), release 2025-09-18; Notion's
  hosted MCP server inside look.
- GitHub — `makenotion/notion-mcp-server`, `makenotion/claude-code-notion-plugin`,
  `brianlovin/notion-skills` (shared SKILL.md convention across Claude Code/Codex/Cursor/Gemini).
- Third-party corroboration — MindStudio and FindSkill write-ups on the External Agents API
  and the credits behavior.
- Client cross-checks — this archive's runtime chunks (`getAIUsageEligibilityV2` in
  `78277`, feature-name/thread-type literals across chunks) and the two quota HARs.
