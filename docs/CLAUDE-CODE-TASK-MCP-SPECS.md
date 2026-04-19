# Claude Code Task: Complete MCP Specs

**Assigned:** 2026-04-18
**Status:** Ready to start
**Priority:** Unblocks Phase 0.B (MCP builds — tasks #57, #58, #62)

---

## Task

Complete the 3 MCP specs under `docs/mcp/` in THIS repo (Xoery1234/BLA) by filling in every "TODO" with researched, specific technical decisions. Commit directly to `main` as three separate commits. No PR needed — J reviews post-commit.

## Context

BLA (Brand Launch Accelerator) is a multi-tenant content flywheel for Adobe Edge Delivery Services. Revlon is the pilot brand. Phase 0 pivoted 2026-04-18 to "piping-first" — build orchestration before generators. Firefly is deferred; v0 uses Claude API for text + existing Revlon imagery.

## Required reading before you start (in order)

All paths are relative to the repo root of THIS repo (Xoery1234/BLA):

1. `docs/PRD-BLA-FLYWHEEL-CONNECTORS-v2.md` — Sections 0, 3, 4, 5, 6, 9 are the critical ones.
2. `docs/brief-schema-v0.md`
3. `docs/brands/revlon/voice.json`
4. The 3 outline files:
   - `docs/mcp/llm-mcp-spec.md`
   - `docs/mcp/adobe-mcp-spec.md`
   - `docs/mcp/orchestrator-mcp-spec.md`
5. Root `CLAUDE.md` if present (workspace conventions)

## What "complete" means for each spec

Every TODO and open question in the outline must be resolved with:
- A specific technical decision (not "it depends")
- A one-line rationale
- A source/reference where applicable (Anthropic docs, Workfront API docs, MCP spec)

## Required research before writing

Use web search + official docs. Do NOT rely on training knowledge for anything that could have changed. Specifically:

1. **Anthropic Claude API** — current endpoint, current model naming (Opus 4.6 / Sonnet 4.6 / Haiku 4.5 — confirm model strings `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`), current rate limit tiers, current auth header format. Source: docs.anthropic.com and docs.claude.com.

2. **Adobe Workfront API v21** — auth flow when using Adobe IMS token (direct bearer vs session exchange), webhook subscription model (org-level vs per-task), rate limits, breaking changes from v20. Source: Adobe Workfront developer documentation.

3. **Adobe Edge Delivery Services API** — publish endpoint (admin.hlx.page vs newer Adobe-branded URL), required auth scopes, rate limits. Source: Adobe EDS developer documentation + aem.live docs.

4. **Adobe IMS OAuth Server-to-Server** — exact scope strings for Workfront + EDS, token lifetime, refresh patterns. Source: developer.adobe.com. JWT is deprecated (EOL 2025-06-30) — do NOT use, S2S only.

5. **MCP spec 2025-11-25** — StreamableHTTP transport, OAuth 2.1 + PKCE, tool definition conventions. Source: modelcontextprotocol.io.

6. **Infisical secret management** — CLI patterns for local dev secret pull, runtime secret resolution. Source: infisical.com/docs.

7. **LGTM stack** — OTLP emission patterns (Loki for logs, Tempo for traces, Mimir for metrics, Grafana for dashboards). Source: grafana.com/docs.

## Constraints (non-negotiable)

- Isolation protocol from PRD v2 §4 applies to everything — `bla-*` namespacing, `BLA_*` Workfront prefixes, `/bla/dev/*` Infisical paths, no binding to existing Monks production resources.
- Unified Adobe IMS S2S OAuth for ALL Adobe services (no per-service auth). Single Dev Console project `bla-adobe-services-dev` (not yet created — specs written against future creation).
- Live publish MUST be double-gated (env flag + brief metadata). Safety invariant, not a suggestion.
- Voice.json `validation_hooks.post_generation` MUST be enforced after every LLM generation. Banned_terms/never_terms failure = regenerate once then fail hard.
- No JWT anywhere. No API keys in git. No shared Infisical paths.

## Deliverable format

Each completed spec must have:
- All 10-11 sections filled (no empty sections)
- Every TODO resolved
- Every open question either answered or explicitly marked as "Deferred to v0.1 post-launch — tracked as [issue ref]"
- Code examples where tool signatures are described (TypeScript-style preferred — Turborepo monorepo is TS)
- Error taxonomy complete with specific error class names
- Observability section lists exact metric names, label sets, trace span conventions
- Testing section lists specific test case categories with fixture file names

## Verification before commit

For each spec, self-review:
1. Can a developer read this and know enough to start implementing without asking questions?
2. Are all external API references accurate as of today?
3. Do the three specs align with each other? (Orchestrator's call to LLM MCP uses the exact tool signature defined in LLM MCP spec, etc.)
4. Do they align with brief-schema-v0.md?
5. Do they align with PRD v2 scope (Workfront+EDS only for Adobe MCP v0)?

Run verify-style self-check and document any gaps you chose to leave open (with reason) at the bottom of each spec under "Known gaps."

## Commit plan

Commit directly to `Xoery1234/BLA` `main` with 3 commits:

1. `docs(mcp): complete LLM MCP v0 spec`
2. `docs(mcp): complete Adobe MCP v0 spec`
3. `docs(mcp): complete Orchestrator MCP v0 spec`

Target paths:
- `docs/mcp/llm-mcp-spec.md`
- `docs/mcp/adobe-mcp-spec.md`
- `docs/mcp/orchestrator-mcp-spec.md`

Final commit message body: summary of architectural decisions made + list of open items deferred with reason.

## Hard pause conditions

Stop and ask J (via Cowork) if you encounter any of these:
- Official docs contradict the PRD v2 architecture (e.g., Workfront API does not support the auth flow we assumed)
- You find Anthropic/Adobe/etc. has deprecated something we were planning to use
- The MCP spec has breaking changes that invalidate our tool surface design
- Cost estimate for default config exceeds $10/day sustained usage

Do NOT stop for minor ambiguities — make a decision with rationale and move on.

## Scope of this task

THIS IS SPEC WORK, NOT IMPLEMENTATION. Do not write any actual MCP code, package.json, or tests. Do not scaffold Turborepo. Do not create Infisical paths. Just write the three specs. Implementation happens in later tasks (#57, #58, #62) after J approves specs.

Estimated time: 2-4 hours of research + writing. Report back with the three commit SHAs when done.
