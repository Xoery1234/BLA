# Brand Launch Accelerator — Flywheel Connectors PRD v2

**Status:** Draft — supersedes v1 (commit dea8b46 on Xoery1234/BLA)
**Date:** 2026-04-18 (revision r2 — piping-first pivot)
**Owner:** J (Monks)
**Scope:** Architecture for brief → generate → review → approve → publish flywheel, Revlon pilot, multi-tenant-ready foundation

## 0. Sequencing pivot — piping first (added 2026-04-18)

**Decision:** build the pipeline before the generators. Firefly provisioning is deferred until Phase 1.5. Phase 1 v0 uses Claude API (LLM MCP) for text generation and pre-existing Revlon imagery for visuals.

**Rationale:**
- The flywheel's value is orchestration, not generation. Swapping generators later (Firefly, Custom Models, DALL-E, stock) doesn't change the pipeline.
- Firefly provisioning has credit-allocation complexity (shared pool vs dedicated quota) that creates real blast-radius risk on production budget. Deferring removes that from the critical path.
- LLM MCP has no credit/quota complexity — flat API key, predictable cost, full attribution.
- Demo story is stronger: "pipeline works with any generator, here it is working with Claude today, Firefly slots in tomorrow."

**Content source for Phase 1 v0 demo:** Option B — Claude-generated text + existing Revlon imagery hand-placed in DA.live. Placeholders acceptable as fallback. Option C (Firefly imagery) explicitly deferred.

**Implications for MCP scope:**
- Adobe MCP v0 scope compresses to **Workfront + EDS only**. Firefly and Content Tagging become v1.5 modules.
- LLM MCP becomes the primary content generator for v0.
- Orchestrator MCP's `generate` step wires only to LLM MCP in v0, extends to Adobe MCP/Firefly in v1.5.

**Adobe setup sequencing:**
- Q4 (Firefly) — paused at inventory. No resources created. Resume when v0 piping is proven.
- Q6 (Workfront) — paused. Resume when orchestrator scaffolding begins (1-2 weeks out). No point holding unused credentials.
- Q9 (Universal Editor) — parallel track, independent timing.

---

---

## 1. Why v2

v1 was written before we inventoried Monks' actual Adobe entitlements. Today's Admin Console + Developer Console walkthrough surfaced significantly more API access than planned. v2 consolidates the architecture, reduces MCP count, and reduces LOE.

### Key changes from v1

| Area | v1 | v2 |
|------|----|----|
| MCP count | 4-5 separate MCPs | 2 MCPs + Orchestrator |
| Adobe auth | Per-service tokens | Unified Adobe IMS S2S OAuth |
| EDS publishing | Sidekick-only | EDS API for programmatic publish |
| Frame.io | Dropped | Entitled, deferred to v1.1+ |
| V/V track | Deferred (no clear path) | Entitled via Audio & Video Firefly Services, architecture-ready |
| Photoshop/AI/ID APIs | Not in scope | Available, added to v1.1+ composition pipeline |
| Revlon scope | Pilot → launch | Pilot demo only, not publishing |
| LOE | 9-11 weeks | 6-8 weeks |
| Isolation | Implicit | Explicit `bla-*` namespace protocol |

---

## 2. Adobe entitlements confirmed (2026-04-18)

Inventory via Admin Console + Developer Console walkthrough under Monks IMS org:

### Firefly Services family (all available)
- **Firefly API - Firefly Services** — production image generation at scale
- **Firefly Custom Models API** — brand-trained model extensions
- **Audio & Video API - Firefly Services** — video/voice generation (deferred)
- **Content Tagging API - Firefly Services** — auto-metadata on generated assets
- **Photoshop API - Firefly Services** — cloud edit, resize, crop, composite
- **Illustrator API - Firefly Services** — rendition, data merge
- **InDesign API - Firefly Services** — layout automation
- **Lightroom API - Firefly Services** — photo processing
- **Substance 3D API - Firefly Services** — 3D composition
- **Remove Background** — single-purpose utility

### Workflow & delivery
- **Adobe Workfront API** — available via Dev Console (same IMS S2S auth as Firefly)
- **Edge Delivery Services API** — programmatic content + config management
- **Frame.io API** — V4 REST + webhooks (entitled but deferred to v1.1+)
- **Cloud Manager** — AEM infra ops

### Adjacent (not planned for v0)
- Experience Platform API, Privacy Service, Smart Content, App Builder — noted, not touched

### Auth simplification
All the above use **Adobe IMS OAuth Server-to-Server** (scope `openid,AdobeID,firefly_api,ff_apis` extending per service). One auth module, one credential rotation policy, one secret namespace in Infisical.

JWT is deprecated (EOL 2025-06-30) and is not used anywhere.

---

## 3. Revised MCP architecture

### v1 plan (5 MCPs)
1. Firefly Services MCP
2. Workfront MCP
3. Frame.io MCP *(dropped mid-planning)*
4. LLM MCP
5. BLA Orchestrator MCP

### v2 plan (2 MCPs + Orchestrator)

**3.1 Adobe MCP** (unified)
- Wraps: Firefly, Photoshop, Content Tagging, Workfront, Edge Delivery Services
- Auth: single Adobe IMS S2S OAuth client
- Internal routing: tool name selects service (e.g. `firefly.generate`, `workfront.create_task`, `eds.publish`)
- Rationale: all services share auth, rate-limit semantics, Adobe status API, and retry patterns. One MCP with per-service tools is simpler than 3 nearly-identical MCPs.
- Frame.io, Audio/Video, Custom Models → additive modules in this MCP when needed (v1.1+)

**3.2 LLM MCP**
- Wraps: Anthropic Claude API
- Tools: `llm.generate_copy`, `llm.summarize`, `llm.transform` with brand voice injection
- Voice injection via `voice.json` per brand (task #48)
- Rationale: separate because different provider + different auth + different rate limits

**3.3 BLA Orchestrator MCP** (the moat)
- Wraps no external service — it's the workflow engine
- Tools: `orchestrator.submit_brief`, `orchestrator.status`, `orchestrator.approve`, `orchestrator.publish`
- State machine: Brief → Generate (parallel: Adobe MCP + LLM MCP) → Tag (Content Tagging) → Review (Workfront task) → Approve → Publish (EDS API)
- Persistence: Postgres on VPS
- Observability: emits to LGTM stack

### 3.4 What we removed
- Dedicated Frame.io MCP — Frame.io now a module inside Adobe MCP, disabled by default
- Dedicated Workfront MCP — merged into Adobe MCP (unified auth made it trivial)
- Zapier / third-party glue — all in-house

---

## 4. Isolation protocol (hard rules)

Every artifact created for BLA MUST be namespaced and non-destructive.

### Adobe side
- Product profiles: `BLA <Service> Dev` (e.g. `BLA Firefly Services Dev`)
- Developer Console projects: `bla-<purpose>-<env>` (e.g. `bla-adobe-services-dev`)
- Workfront custom fields: prefix `BLA – ` in display name
- Workfront templates: prefix `BLA_` in name
- Workfront API users: `bla-api-dev@monks.com` (or equivalent technical account)

### Code side
- GitHub repos: `bla-*` or under Xoery1234/BLA path
- MCP service names: `bla-adobe-mcp`, `bla-llm-mcp`, `bla-orchestrator-mcp`
- Infisical paths: `/bla/dev/*`, `/bla/staging/*`, `/bla/prod/*`
- Docker image tags: `bla-*:v*`

### Never
- Modify existing Adobe product profiles
- Modify existing Workfront custom forms, templates, API users
- Bind to existing Developer Console projects
- Write into shared Monks Infisical paths

---

## 5. Phase 0 (infrastructure) — unchanged from v1 in intent, simplified in scope

1. Provision VPS (J's infra) — task #54
2. Deploy Infisical self-hosted vault on VPS — task #54
3. Scaffold Turborepo monorepo: `apps/adobe-mcp`, `apps/llm-mcp`, `apps/orchestrator-mcp`, `packages/shared` — task #55
4. Write per-MCP specs under `docs/mcp/` — task #56 (now only 3 specs instead of 5)
5. Deploy LGTM observability stack — task #63

---

## 6. Phase 1 — MCP builds (compressed)

### 6.1 Adobe MCP v0 scope (task #57 rescoped again — piping-first)
- Module 1: **EDS publish** (preview + live) — primary publishing path
- Module 2: **Workfront task CRUD** (create, update status, add comment) — review/approve gate
- Deferred to v1.5: Firefly generate, Content Tagging, Photoshop, Custom Models, Frame.io, Audio & Video
- Rationale: Firefly provisioning is off the critical path. v0 proves the pipeline with no image generator.

### 6.2 LLM MCP (task #58 unchanged)
- Claude API wrapper with voice.json injection
- Streaming + blocking modes
- Cost logging to LGTM

### 6.3 Orchestrator MCP (task #62 unchanged in intent, smaller integration surface)
- State machine
- Webhook receivers (Workfront approval events)
- Publish trigger to EDS API

---

## 7. Phase 2 — Revlon pilot (demo only, not publishing)

- Home + PDP rendered from flywheel output — tasks #40, #41
- Brief submitted via structured schema (task #44)
- Generate pass: Adobe MCP + LLM MCP in parallel
- Review pass: Workfront task visible in Monks Workfront UI
- Approve pass: Workfront status change triggers orchestrator webhook
- Publish pass: EDS API pushes to `<bla-demo>.aem.page` preview (NOT production Revlon)
- Demo script + video captures for internal/prospect presentation

---

## 8. LOE re-estimate

| Phase | v1 estimate | v2 estimate | Driver |
|-------|-------------|-------------|--------|
| Phase 0 infra | 2 weeks | 1.5 weeks | Fewer MCP scaffolds |
| Phase 1 MCPs | 4-5 weeks | 2.5-3 weeks | 2 MCPs instead of 4, unified Adobe auth |
| Phase 2 orchestrator | 2 weeks | 1.5 weeks | Smaller integration surface |
| Phase 3 Revlon pilot | 1-2 weeks | 0.5-1 week | No publish, demo only |
| **Total** | **9-11 weeks** | **5.5-7 weeks** | **~35% reduction** |

---

## 9. Residual decisions (resolved from v1)

1. **LGTM on VPS** — confirmed, J owns VPS, self-hosted observability
2. **Video/Voice architecture** — architecture-ready (Audio & Video API entitled), implementation deferred
3. **Tenant #2 trigger** — deferred until Revlon demo lands, then evaluate
4. **Frame.io** — entitled, wired as opt-in module in Adobe MCP (v1.1+)
5. **Workfront proofing path** — v0 uses simple Workfront task approval (no proofing UI), v1.1+ adds Frame.io embed if needed
6. **Admin Console access** — J has access with secondary credentials (2026-04-18)

---

## 10. Open risks / watch items

- **Org context** — J logged in with secondary creds. Verify this is the Monks *production* IMS org, not a partner/delegated org, before Phase 0 credentials are issued against real entitlements.
- **Firefly rate limits** — default 4 RPM / 9000 daily. Revlon pilot should stay well below. Monitor via LGTM.
- **Workfront Unified Review vs legacy Proof** — not a v0 blocker (we don't use proofing), but flag for v1.1 planning.
- **Secondary creds lifecycle** — if the creds J is using are a shared IT account, we need J-specific Developer role or System Admin for longevity.

---

## 11. Cowork vs Claude Code split (unchanged from v1)

- **Cowork** (this doc lives here): vendor/config decisions, entitlement audits, architecture PRDs, procurement conversations, secret provisioning plans
- **Claude Code**: MCP implementation, tests, code review, CI, block code, template code
- **Handoff**: Cowork produces `docs/*.md` → Claude Code reads and implements

---

## 12. Next actions

1. J executes Q4 v2 checklist (Firefly Services provisioning) — today
2. Once Firefly smoke-tested, add Workfront + EDS + Content Tagging to the same Dev Console project — Q4.5
3. Q6 revised (Workfront) — checklist to follow
4. Q9 revised (Universal Editor) — checklist to follow
5. PRD v2 reviewed + signed off by J → commit to Xoery1234/BLA as `docs/PRD-BLA-FLYWHEEL-CONNECTORS-v2.md`
6. Phase 0 scaffolding kicks off (tasks #54, #55, #56, #63)

---

*End of PRD v2*
