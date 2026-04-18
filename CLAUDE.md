# CLAUDE.md — Brand Launch Accelerator (BLA)

## Before you start a session, read these in order

1. `AGENTS.md` — the AEM EDS boilerplate contract. Non-negotiable conventions: block pattern, three-phase loading, never modify `scripts/aem.js`, Airbnb ESLint, mobile-first CSS. Do not deviate.
2. `CLAUDE.md` (this file) — BLA-specific context that layers on top of AGENTS.md.
3. `docs/BLOCK-SPECS-v1.0.md` — when working on any block, this is the contract.
4. `docs/PRD-BLA-FLYWHEEL-CONNECTORS-v{n}.md` — flywheel connector architecture and per-service specs. **Latest version wins.** Older versions are superseded.
5. `docs/CCP-v1.1.md` — broader pipeline context (content creation pipeline, stack decisions, tenant architecture).

## Project identity

BLA is a multi-tenant Tier-1 brand-site template on Adobe Edge Delivery Services. Monks uses it to launch premium brand sites faster, cheaper, at consistent quality — with AI-first infrastructure baked in (findability signals, voice-as-system-prompt, authoring acceleration, composable blocks).

**Pilot tenant:** Revlon (R2.A). Reference site proving the template before tenant #2 onboards.

**Strategic bet:** First agency running a composed Adobe + Anthropic stack for Tier-1 delivery. Flywheel — every tenant refines the core.

## Repo facts

- Origin: `https://github.com/Xoery1234/BLA` (main branch is live)
- Legacy `source` remote: `xoery123/brand-accelerator` — historical reference only, do not push
- Preview: `https://main--BLA--Xoery1234.aem.page/`
- Production: not live yet (Q2 2026 Revlon target)

## Architecture (one line each)

- **Delivery:** Adobe EDS (Edge Delivery Services, aka Franklin / Helix 5)
- **Authoring:** da.live (doc authoring) now; Universal Editor (WYSIWYG) activated in parallel track — see PRD v1
- **Assets:** AEM Cloud + Content Hub + Dynamic Media
- **Generation:** Firefly Services API (images, video, brand models) + LLM (Claude API) for text
- **Workflow:** Workfront (human approvals only; machine-to-machine is a state machine per D-CCP-14)
- **Review:** Frame.io V4
- **Orchestration:** Cowork (strategy/docs/config), Claude Code (implementation — this session), Claude Design (visual layer per tenant)
- **Integration protocol:** MCP (all Adobe + LLM + orchestrator built in-house, no vendor wrappers)
- **Hosting:** Exec VPS (stateful services) + Vercel (stateless edge if any) + GitHub (code + CI)
- **Vault:** Infisical self-hosted on VPS
- **Observability:** LGTM stack self-hosted (or Axiom + Sentry week-1 — TBD per PRD v1 Section 11)
- **Monorepo:** Turborepo with per-MCP workspaces

## Tenant architecture

The template should be tenant-neutral. Tenant-specific styling goes under `/tenants/{name}/` once the template/tenant refactor lands (planned pre-Phase E, not done yet).

**Today:** `bla_source/` styling is Revlon-flavored (dark, red, Playfair). Treat current tokens as the Revlon pilot theme until the refactor. Do NOT add Revlon-specific literals (product names, copy, URLs) into template code. Keep Revlon content in content files, not in block JS.

## Block development — mandatory contract

Every new block ships **5 artifacts**:

1. `blocks/{name}/{name}.css`
2. `blocks/{name}/{name}.js`
3. `blocks/{name}/_{name}.json` — Universal Editor component-definition (definition + model + filter). Mandatory for all new blocks from this point forward. See docs/BLOCK-SPECS-v1.0.md for schema template.
4. **da.live authoring notes** — documented inside the block spec in BLOCK-SPECS-v1.0.md
5. **Revlon content example** — sample content in the block spec, and optionally a test page in `drafts/`

**Reference blocks to study for conventions:**

Foundational layout / content:
- `blocks/product-grid/` — responsive 1/2/3-col grid with `createOptimizedPicture` + `.hover-lift`
- `blocks/trust/` — count-up animation wired via `data-count-*` attributes
- `blocks/cards/` — canonical boilerplate block (optimized picture + li wrapper)
- `blocks/hero/` — hero layout with background image handling
- `blocks/carousel/` — horizontal scroller with controls
- `blocks/accordion/` — native `<details>`-based expansion

Cinematic / scroll-driven (reference these for motion-heavy blocks):
- `blocks/scene/` — pinned scrollytelling stage
- `blocks/horizontal-scroll/` — horizontal strip on vertical scroll
- `blocks/parallax-layers/` — multi-depth parallax
- `blocks/text-reveal/` — word-by-word headline reveal

Shared interaction runtime (always check before adding block-scoped motion):
- `scripts/interactions.js` + `styles/interactions.css` — reveal, stagger, parallax, count-up, sticky, image-zoom, skeletons, color transitions. Respects `prefers-reduced-motion` globally.

## Interaction patterns — use the shared runtime

`scripts/interactions.js` + `styles/interactions.css` provide the shared pattern runtime: scroll-triggered reveals, parallax, count-up, sticky nav, sticky CTA, smooth accordion, image zoom, loading skeletons, section color transitions.

**Use these patterns — don't reinvent them inside blocks.** If a block needs block-specific interaction, add minimal block-scoped JS on top of the shared pattern.

New interaction patterns: add to `interactions.js`, document in `interactions.css` header. Respect `prefers-reduced-motion` everywhere.

## Voice & content

Brand voice lives in `voice.json` (per tenant, authored in `tenants/{name}/voice.json` post-refactor; for now lives in content/Revlon area when authored). When voice.json exists, content rules (tone, terminology, forbidden phrases) must be honored in any content suggestion or auto-generated copy.

Do not fabricate brand copy. If content is missing from a block example, insert `TODO: Revlon content` rather than invented text.

## Current priorities (as of April 2026)

**First workload for this Claude Code session:** 8 pending blocks per `docs/BLOCK-SPECS-v1.0.md`:
1. `statement` — manifesto large-type
2. `cta-grid` — 2-3 entry points
3. `product-hero` — PDP "arrive" beat
4. `product-summary` — short copy + key specs
5. `feature-grid` — 3x2 icon+benefit
6. `reviews-condensed` — rating + 3 reviews
7. `press-quotes` — quote carousel
8. `cta-sticky` — sticky purchase CTA

**After blocks:** Home + PDP templates in Sidekick Library, 4 brand-site pages scaffolded in da.live, first live Revlon PDP (Super Lustrous Lipstick), then begin flywheel connector work per PRD v1.

## Agent Teams (when `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`)

Split the 8-block workload across 3-4 parallel builders grouped by dependency/complexity:

- Group A — simple single-purpose: `statement`, `cta-grid`, `cta-sticky`
- Group B — PDP content: `product-hero`, `product-summary`
- Group C — social proof: `feature-grid`, `reviews-condensed`, `press-quotes`

Each builder owns their blocks end-to-end: code + component-definition JSON + commit + push. Report completion via the shared task list. Do not peer-sync between builders — route coordination through the orchestrator.

## Commit discipline

- One block per commit
- Message format: `feat(blocks): add {name} block — {one-line what it does}`
- Push after each block to `Xoery1234/BLA main`
- Run `npm run lint` before commit, fix all errors
- Run `/block-verify` after commit (lint + a11y + viewport + schema + preview render)

## GitHub MCP — commit via API, not local git

This repo has the GitHub MCP server wired up (see `.mcp.json`, gitignored). **Treat remote `Xoery1234/BLA:main` as the source of truth.** The local clone may drift (multiple sessions pushing, duplicate commits, lock-file permission issues inside sandboxes).

Default push path — use MCP, not local git:
- `mcp__github__get_file_contents` to read files from remote before editing.
- `mcp__github__push_files` for multi-file commits.
- `mcp__github__create_or_update_file` for single-file commits.
- `mcp__github__create_pull_request` + `pull_request_read` + `pull_request_review_write` for PRs.

Before every push, fetch the current `main` SHA via MCP so the base is current. Never force-push. After every push, report the commit SHA plus the preview URL pattern `https://main--BLA--Xoery1234.aem.page/{path}`.

Only fall back to local `git commit` + `git push` when the change must include files MCP can't see, or when working on a feature branch that isn't on the remote yet.

If the user's local clone falls behind: tell them to run `git fetch origin && git reset --hard origin/main` from the BLA folder. Don't try to rebase their local duplicates — remote is truth.

## Secrets & local config

**Hard rule: no secrets in the repo. Ever.**

Files that are gitignored and must stay that way:

- `.mcp.json` — contains the GitHub PAT for the MCP server. Local-only. Never stage, never commit, never include in tool output.
- `.env`, `.env.*` — any future environment files.
- Any file with `*_SECRET`, `*_TOKEN`, `*_KEY`, or `*_CREDENTIAL` in the name or content.

If you are an agent in this repo:

1. Before running `git add` (or any staging operation), check that you're not adding a secret-bearing file. If you see `.mcp.json`, `.env`, or anything with a token-looking value, stop.
2. Never echo the contents of `.mcp.json` into chat, PR descriptions, commit messages, or shared docs. The PAT is for the MCP server process only.
3. If you suspect a secret has leaked (committed, pushed, logged, shared): tell J immediately. Recommend revoking the token at GitHub → Settings → Developer settings → Fine-grained tokens. Create a new one with the same narrow scopes (Contents:RW, PR:RW, Metadata:R, Actions:R, resource = `Xoery1234/BLA`, 90-day expiry). Paste into local `.mcp.json` only.
4. When referencing the GitHub MCP in prose, name it but do NOT quote the token or its env var value.

If the GitHub MCP stops working for a session, the most likely cause is PAT expiry or scope drift. Ask J to rotate the token and restart the Claude Code session — do not try to hard-code credentials in code or config elsewhere in the repo.

## Tooling & integration configuration

**All tooling, vendor, and integration configuration decisions happen in Cowork, not in Claude Code.** Claude Code consumes configuration; it does not decide on it.

Out of scope for Claude Code — defer to Cowork orchestrator:

- Which vendors or MCP wrappers to use (e.g., Zapier vs in-house, which vault product, which observability stack, which LLM provider)
- OAuth flow selection, Adobe IMS tenant binding, which Adobe environment to use
- Rate-limit budgets, polling intervals, retry policies (sensible defaults OK; policy shifts go to Cowork)
- Per-tenant credentials, Adobe IMS client IDs, Frame.io workspace mappings, Workfront project IDs
- Hosting targets (VPS vs Vercel vs cloud), deployment environments, CI secret configuration
- New dependencies (prohibited anyway — see Guardrails)
- Procurement, licensing, or billing conversations

In scope for Claude Code:

- Read config from `.env.example` schemas and env vars at runtime
- Implement MCPs to the spec in `docs/mcp/{name}.md` — tools, schemas, behaviors, tests
- Write pure code artifacts: `turbo.json`, `package.json`, TypeScript configs, Dockerfiles
- When a config-shaped decision is needed, stop and escalate: "Need decision on X, deferring to Cowork." Do not invent.

Source of truth for integrations: `docs/PRD-BLA-FLYWHEEL-CONNECTORS-v{n}.md` + per-MCP specs in `docs/mcp/`. If a spec is missing or ambiguous, stop and ping Cowork. Don't guess.

## Guardrails

- NEVER modify `scripts/aem.js`
- NEVER commit secrets, API keys, tenant credentials, or customer data. See "Secrets & local config" above.
- NEVER decide on tooling, vendors, or integration config. See "Tooling & integration configuration" above.
- NO new dependencies — vanilla JS/CSS only for the EDS site; for MCPs, only dependencies explicitly listed in the per-MCP spec
- Don't reinvent interaction patterns — check `interactions.js` first
- Don't make Revlon-specific patterns that can't generalize to tenant #2
- When stuck on a design, tenant, or config decision: stop and ping the orchestrator (Cowork session). Don't guess.

## Universal Editor component-definition — schema basics

Each block's `_{blockname}.json` contains three sections (definition, model, filter) in a combined JSON per Adobe's current XWalk convention:

```json
{
  "definitions": [{
    "title": "Block Title",
    "id": "blockname",
    "plugins": {
      "xwalk": {
        "page": {
          "resourceType": "core/franklin/components/block/v1/block",
          "template": {
            "name": "Block Title",
            "model": "blockname"
          }
        }
      }
    }
  }],
  "models": [{
    "id": "blockname",
    "fields": [
      { "component": "text", "name": "title", "label": "Title" },
      { "component": "richtext", "name": "body", "label": "Body" }
    ]
  }],
  "filters": [{
    "id": "blockname",
    "components": ["text", "image"]
  }]
}
```

Reference: [Adobe UE Component Definition docs](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/developing/universal-editor/component-definition).

## Handoff back to Cowork

When the block workload is complete, summarize for the orchestrator:

- Blocks shipped (commits, preview URLs)
- Lint / verify status per block
- Deferred issues or product questions
- Token usage estimate vs budget

J reads the summary in Cowork and routes next work (templates, pages, content, flywheel MCPs) from there.

## If all else fails

If you're frustrated or stuck: stop, document what you tried, ping the orchestrator in Cowork with a clear problem statement. Fresh approach beats accumulated corrections.
