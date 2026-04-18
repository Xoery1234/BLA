# PRD — BLA Flywheel Connectors v1

**Status:** Approved for Phase 0 kickoff (pending 3 residual decisions — Section 11)
**Owner:** Product (J)
**Author:** Claude (Cowork), based on adversarially-verified research + executive decisions on v0
**Date:** 2026-04-18
**Version:** v1 (supersedes v0)
**Previous:** `docs/PRD-BLA-FLYWHEEL-CONNECTORS-v0.md`

---

## 1. Summary

BLA today ships a static multi-tenant brand-site template on Adobe EDS. To become a Tier-1 offering with a defensible moat, it needs the **flywheel**: brand voice + product data → Firefly-generated assets + LLM-generated copy → Frame.io review → Workfront approvals → da.live publish → EDS live, with feedback telemetry closing the loop.

v1 locks the architecture after executive review of v0. Key shifts from v0: drop all vendor MCPs (no Zapier), host everything on the exec's VPS + GitHub + Vercel, use Monks' existing Adobe entitlements for the pilot, self-host Infisical for secrets and the LGTM stack for observability, and add Universal Editor activation as a parallel track.

**Recommendation (locked):**

- **BUILD** five MCPs in-house: Firefly Services, Frame.io V4, Adobe Workfront, LLM (Claude API wrapper), and the BLA Orchestrator. No Zapier.
- **REUSE** Adobe AEM MCP, da.live MCP, GitHub MCP — already connected.
- **ACTIVATE** Adobe Universal Editor in parallel (~1 week) so brand teams author in-context.
- **HOST** on exec's VPS (stateful services) + Vercel (stateless edge) + GitHub (code + CI).

**Total LOE:** ~9-11 calendar weeks with 2 engineers, plus product, QA, exec oversight.

---

## 2. Strategic Context

**The moat is the orchestration, not the connectors.** Every agency can call Firefly. What Monks can defensibly own is the state machine that encodes brand voice → creative brief → generation constraints → QA gates → review routing → approval SLAs → publish cadence → measurement. That is the Orchestrator MCP. Everything else is plumbing.

**Why MCPs and not bespoke middleware:** MCP is the emerging standard (spec 2025-11-25, OAuth 2.1 + PKCE). Claude Code, Cowork, Claude Design, and any future LLM client invoke the same MCPs. Cheaper to maintain and broader in reach than REST middleware.

**Why in-house over Zapier:** Zapier adds SLA dependency, per-task pricing at scale, coverage gaps, and a trust/compliance surface for brand IP. Building ourselves adds ~4 weeks up front and removes all three. Aligns with the "own your stack" principle.

---

## 3. Scope

**In scope (v0):**
- Firefly Services MCP (image: text-to-image, fill, expand; async polling)
- LLM MCP (thin Claude API wrapper for text generation)
- Frame.io V4 MCP (in-house, OAuth via Adobe IMS)
- Adobe Workfront MCP (in-house, OAuth via Adobe IMS)
- BLA Orchestrator MCP (flywheel state machine, tenant resolver, brand voice layer, content services fan-out)
- Universal Editor activation for BLA (project-root config + sidekick library + per-block schema audit)
- Infisical vault on VPS for per-tenant credentials
- LGTM stack on VPS for logs/metrics/traces (or Axiom+Sentry for week-1 — see Section 11)
- Turborepo monorepo with per-MCP workspaces
- One end-to-end pilot: Revlon "Product Hero" brief → published page

**Deferred to v1:**
- Firefly Video MCP (video generation)
- Voice/audio MCP (Adobe Audio API or ElevenLabs wrapper)
- Firefly custom model training automation (Adobe UI-only today)
- Workfront automated approval transitions (v0 uses UI approvals)
- Full Content Supply Chain measurement dashboard
- Multi-region deployment

---

## 4. Optimal Architecture

```
                    ┌───────────────────────────────────────┐
                    │      Clients (Cowork, Code, Design)    │
                    └────────────────┬───────────────────────┘
                                     │ MCP (OAuth 2.1 + PKCE)
                    ┌────────────────▼───────────────────────┐
                    │       BLA Orchestrator MCP (BUILD)     │
                    │  - tenant context resolver             │
                    │  - flywheel state machine              │
                    │  - brand voice constraints layer       │
                    │  - content services fan-out            │
                    │  - QA gates + human approval routing   │
                    │  - telemetry aggregation               │
                    └──┬────────┬────────┬────────┬──────────┘
                       │        │        │        │
         ┌────────────▼──┐ ┌───▼────┐ ┌─▼──────┐ ┌▼────────────┐
         │ Firefly Image   │ │Frame.io│ │Workfrnt│ │ AEM/da.live │
         │ MCP + LLM MCP   │ │ V4 MCP │ │ MCP    │ │ MCP         │
         │ (BUILD)         │ │(BUILD) │ │(BUILD) │ │ (REUSE)     │
         └───────┬───────┘ └───┬────┘ └───┬────┘ └──────┬──────┘
                 │             │          │             │
         ┌──────▼───────┐ ┌────▼─────┐ ┌──▼──────┐ ┌────▼─────┐
         │ Firefly +       │ │ Frame.io │ │Workfront│ │ EDS +    │
         │ Claude API      │ │ V4 (EA)  │ │ API v21 │ │ da.live  │
         └──────────────┘ └──────────┘ └─────────┘ └──────────┘

  ┌─ Cross-cutting ───────────────────────────────────────┐
  │  Infisical (vault, VPS)                                          │
  │  LGTM stack — Loki / Grafana / Tempo / Mimir (observability, VPS) │
  │  Turborepo monorepo (code, GitHub)                                │
  │  Universal Editor (authoring surface, parallel track)             │
  └───────────────────────────────────────────────────────┘
```

Every MCP handles: auth, rate-limit backoff, error normalization, response schema. The Orchestrator is the only MCP with business logic.

---

## 5. Per-Service Specifications

### 5.1 Firefly Services MCP (BUILD)

**Why build:** No MCP wrapper exists anywhere. Firefly is central to the flywheel.

**Auth:** OAuth 2.0 Server-to-Server via Adobe IMS. **v0 uses Monks' existing Adobe entitlements** — per-tenant credentials deferred to v1 when tenant #2 onboards.

**Tools (v0):** `firefly.generate_image`, `firefly.fill`, `firefly.expand`, `firefly.get_job_status`, `firefly.list_custom_models`.

**Async pattern:** Polling-only (Firefly has no webhooks). MCP runs an internal polling worker pool with exponential backoff (1s → 2s → 4s, cap 30s). Returns a job handle immediately; client polls via `get_job_status`. Polling worker needs a long-lived host — must run on VPS, not Vercel serverless.

**Rate limits:** 4 RPM default. Per-tenant token bucket in MCP.

**C2PA:** Content Credentials surfaced in response. Non-suppressible — documented as feature aligned with FTC direction.

**Custom models:** Training remains Adobe UI-only. MCP calls by `model_id` once a tenant model is trained.

**LOE:** ~3 weeks.

### 5.2 LLM MCP (BUILD, thin)

**Why build:** Closes the content pipeline gap flagged in v0 review. Flywheel needs generated text (headlines, product copy, descriptions) as well as images.

**Provider (v0):** Claude API (Anthropic). Wrapper is thin; most logic lives in the Orchestrator's prompt construction + voice.json injection.

**Tools (v0):** `llm.generate_copy({brief_id, section, constraints, voice_ref})`, `llm.rewrite({text, voice_ref})`.

**Auth:** Anthropic API key via Infisical.

**Rate limits:** Anthropic tier limits. Per-tenant quota tracked in MCP.

**LOE:** ~1 week.

### 5.3 Frame.io V4 MCP (BUILD)

**Why build (changed from v0):** Drop Zapier per exec decision. Own the integration, full endpoint coverage, no vendor pricing at scale.

**Auth:** OAuth via Adobe IMS. Known gotcha: Frame.io V4 requires account-linking or 401s — MCP handles in the OAuth flow.

**Tools (v0):** `frameio.create_asset`, `frameio.upload`, `frameio.create_share_link`, `frameio.get_comments`, `frameio.set_status`.

**Webhooks:** V4 webhooks are stable. MCP exposes webhook receiver endpoint (on VPS) forwarding events to the Orchestrator.

**Risk:** Frame.io V4 still Early Access. Pin MCP to the current API surface; isolate changes to one module for fast rollover when V4 stabilizes.

**Stack:** TypeScript (no JS SDK exists; wrap REST directly). Consider Stainless or Kubb for codegen from Frame.io OpenAPI.

**LOE:** ~2 weeks.

### 5.4 Adobe Workfront MCP (BUILD)

**Why build (changed from v0):** Same as Frame.io — drop Zapier, own it.

**Auth:** OAuth via Adobe IMS (JWT deprecated Jan 1, 2025).

**Tools (v0):** `workfront.create_request`, `workfront.attach_asset`, `workfront.get_approval_status`, `workfront.add_comment`.

**Approval state transitions:** API documentation ambiguous. v0 workaround: humans approve in Workfront UI, Orchestrator polls status. Aligns with D-CCP-14 (human-only approval gates). Revisit automation in v1.

**Webhooks:** 5/sec limit per tenant. Orchestrator ingest rate-limits.

**Native Frame.io bridge:** Workfront's built-in Frame.io integration handles review → approval handoff. Use it where possible; saves Orchestrator logic.

**LOE:** ~2 weeks.

### 5.5 BLA Orchestrator MCP (BUILD — the moat)

**Why build:** This is Monks IP. Encodes brand voice rules, generation constraints, QA gates, approval routing, publish cadence. Generic orchestrators can't carry the domain logic.

**Tools (v0):**
- `flywheel.start_brief({tenant_id, template, inputs})` → `brief_id`
- `flywheel.generate_asset({brief_id, type: image|text|video|voice, constraints})` — fans out to the right content MCP
- `flywheel.submit_for_review({brief_id, frameio_project})` — calls Frame.io MCP
- `flywheel.request_approval({brief_id, workfront_request_type})` — calls Workfront MCP
- `flywheel.publish({brief_id, aem_target, da_target})` — calls AEM + da.live MCPs
- `flywheel.get_state({brief_id})` → current state, history, blockers
- `flywheel.telemetry({brief_id})` → durations, rework counts, outcomes

**State machine:** `draft → generating → in_review → awaiting_approval → approved → publishing → live → measured`. Each transition logged with timestamp, actor, inputs/outputs. Resumable from any state after Orchestrator restart.

**Content services fan-out:** `generate_asset` routes by `type` to Firefly (image), Firefly Video (v1), LLM (text), Voice MCP (v1). Each call wrapped with voice constraints from per-tenant `voice.json`.

**Brand voice layer:** Reads `tenants/{tenant_id}/voice.json`. Translates brand voice into generation constraints (Firefly style/content_class/forbidden terms; LLM system prompt + forbidden-phrase filter).

**Multi-tenant isolation:** Per-request `tenant_id` metadata. Orchestrator resolves tenant-specific credentials, project IDs, AEM paths, brand voice, template bindings. Pattern follows Descope MCP gateway reference (per-request context metadata). Mandatory red-team test before any second tenant onboards.

**State DB:** Postgres or SQLite on VPS (simpler for v0 — SQLite). Resumable state enables Orchestrator restarts without data loss.

**LOE:** ~3 weeks.

### 5.6 Reused MCPs (no new work)

- **AEM MCP** — publishes to EDS.
- **da.live MCP** — manages da.live content.
- **GitHub MCP** — manages block/template code.

### 5.7 Universal Editor Activation (parallel track, BUILD)

**Why v0, not v1:** UE is the authoring surface the flywheel ultimately feeds into. Brand teams edit in-context on the rendered page instead of a Word doc in da.live. Tier-1 expectation. Low-LOE because per-block UE schemas already ship with every block.

**Work:**
- Create `component-definition.json`, `component-models.json`, `component-filters.json` at repo root (aggregated from per-block `_*.json` files)
- Configure `/tools/sidekick/library.json` for UE component library
- Update `fstab.yaml` / helix-config.json with UE endpoints
- Audit every block's `_{name}.json` for UE compatibility (definition + model + filter completeness)
- Validate in the Monks AEM Cloud environment

**LOE:** ~1 week, can parallelize with MCP work.

---

## 6. Multi-Tenant Isolation

Every MCP tool call requires `tenant_id` in request metadata. Orchestrator resolves:

- Adobe IMS credentials (vaulted per tenant in Infisical; v0 uses Monks-shared credentials)
- Firefly license/quota
- Frame.io account + workspace
- Workfront project
- AEM path + da.live path
- `voice.json` (per tenant, in repo under `tenants/{tenant_id}/`)

**Pattern:** Descope MCP gateway reference — context metadata on every request. Prevents Tenant A's token from being used in Tenant B's request even if the caller is compromised.

---

## 7. Gap Analysis + Solution Directions

| # | Gap | Impact | Solution Direction |
|---|-----|--------|---|
| 1 | Firefly has no webhooks, polling only | Latency + cost for long jobs | Polling worker pool on VPS with exponential backoff; Orchestrator returns job handle, client polls |
| 2 | Workfront approval state transitions unclear via API | Can't fully automate approvals | v0 uses UI approvals (D-CCP-14 alignment); automation deferred to v1 |
| 3 | Firefly custom model training is UI-only | Can't automate tenant onboarding | Manual per-tenant onboarding by Monks; MCP calls by model_id once trained |
| 4 | Frame.io V4 Early Access | API may change | Isolate V4 API surface in one module; fast rollover when stabilized |
| 5 | C2PA Content Credentials non-suppressible | Clients may object | Document as feature: aligns with FTC AI-disclosure direction; include in brand pitch |
| 6 | No Frame.io JS/TS SDK | More manual wrapping | TypeScript wrapper over REST; codegen 60-70% from OpenAPI |
| 7 | Workfront general rate limits unpublished | Silent throttling risk | Exponential backoff in MCP; request clarity from Adobe account team |
| 8 | Content pipeline: text/voice/video missed in v0 | Partial flywheel | LLM MCP in v0; Firefly Video + Voice deferred to v1 |
| 9 | Firefly polling worker needs long-lived host | Vercel serverless won't work | Runs on VPS; Orchestrator + state DB also VPS; only stateless MCPs can ride Vercel |

---

## 8. Acceptance Criteria (v0)

1. Revlon pilot: "Product Hero" brief flows end-to-end through all states with 0 manual MCP calls (only human approval clicks in Workfront UI).
2. Firefly MCP returns 95% of generation jobs within 60s; polling doesn't block the Orchestrator thread.
3. LLM MCP produces on-brand copy per `voice.json` constraints in Revlon pilot test (red-team verified: no voice → off-brand; with voice → on-brand).
4. Tenant A cannot invoke any tool with Tenant B's credentials, even with a crafted request. Mandatory before second tenant.
5. 8+ Firefly rate-limit breaches in a stress test handled with exponential backoff; no job failures.
6. Full flow resumable from any state after Orchestrator restart.
7. Observability: every state transition logged with tenant_id, brief_id, duration, actor. Traces queryable end-to-end in Grafana (or Axiom).
8. Secret scan (gitleaks) on CI — no credentials in repo.
9. Universal Editor activated: Revlon content editor can edit Home + one PDP in UE in-context; changes publish to EDS.
10. All 5 MCPs publish to npm from the monorepo (private registry OK); each has its own README + test suite.

---

## 9. LOE + Phasing

**Phase 0 (Week 0, ~3 days):** Residual decisions (Section 11), VPS provisioning, Infisical deploy, monorepo scaffolding (Turborepo), CI + gitleaks, `voice.json` v0 for Revlon (Cowork).

**Phase 1 (Weeks 1-3):** Firefly Image MCP build. LLM MCP build (week 3, parallel). Universal Editor activation (week 2-3, parallel track).

**Phase 2 (Weeks 3-5, overlap):** Frame.io V4 MCP + Workfront MCP builds. Orchestrator scaffolding.

**Phase 3 (Weeks 5-7):** Orchestrator state machine + brand voice layer + content services fan-out. Wire all MCPs.

**Phase 4 (Weeks 8-9):** Revlon pilot integration. End-to-end flow. Observability wiring. Stress tests. Multi-tenant isolation red-team.

**Phase 5 (Weeks 10-11):** Hardening, docs, runbooks, handover to ops.

**Total:** ~9-11 calendar weeks, 2 engineers, plus product (Cowork), QA, exec oversight.

---

## 10. Risks

- **Multi-tenant isolation bug:** Highest-severity risk. Mandatory red-team test before tenant #2 onboards.
- **Frame.io V4 breaking change during EA:** Mitigated by isolating V4 API surface in one module.
- **Monks Adobe entitlement scope insufficient for pilot:** Validate in Phase 0 — confirm Firefly Services, Frame.io, Workfront are all on the Monks account with the scopes we need.
- **VPS capacity under load:** v0 targets 1 tenant (Revlon). Validate VPS specs; plan to move Firefly polling worker + Orchestrator to a second box if needed.
- **Scope creep into v1 territory:** Firefly Video, Voice MCP, approval automation, measurement dashboard — explicitly out of scope. Enforce.
- **Universal Editor config drift:** Per-block `_*.json` must stay UE-compatible across block changes. Add CI check that lints UE schemas on every block commit.

---

## 11. Residual Open Decisions

Most v0 decisions are now locked. Three remain:

1. **Observability stack week-1:** Self-host LGTM on VPS from day 1 (more work up front, owned forever), or start with **Axiom free tier + Sentry free tier** (zero setup, graduate to LGTM after v0 ships)?
2. **Content pipeline v1 timing:** When does Firefly Video MCP + Voice MCP land — v1 straight after v0, or gated on first non-Revlon tenant?
3. **Tenant #2 trigger:** Who decides when BLA is ready to onboard tenant #2, and what acceptance gate do we apply (the mandatory multi-tenant isolation red-team is one gate; what else)?

---

## 12. Locked Decisions (from v0 exec review)

1. **Hosting:** Exec VPS (stateful services) + Vercel (stateless edge if any) + GitHub (code + CI).
2. **Vendor MCPs:** None. All Adobe-side MCPs (Firefly, Frame.io, Workfront) built in-house. LLM MCP built in-house over Claude API.
3. **Firefly license:** Monks' existing Adobe entitlements for Revlon pilot. Per-tenant credentials deferred to tenant #2 onboarding.
4. **Content pipeline:** Image (Firefly) + Text (LLM) in v0. Video + Voice deferred to v1.
5. **Vault:** Infisical, self-hosted on VPS.
6. **Repo structure:** Turborepo monorepo with per-MCP workspaces.
7. **Universal Editor:** Activate in v0 as parallel track (~1 week).

---

## 13. Cowork vs Claude Code Split

Clean separation prevents Claude Code building against the wrong spec and Cowork burning context on code reviews that don't need executive attention.

**Claude Code owns (codebase, tests, implementation):**
- Monorepo refactor (Turborepo) + CI pipelines
- Each MCP implementation to spec: Firefly, LLM, Frame.io, Workfront, Orchestrator
- Orchestrator state machine code
- Universal Editor wiring: `component-definition.json`, `component-models.json`, `component-filters.json`, sidekick library, fstab/helix-config updates
- Per-block UE schema compatibility audit
- Infrastructure-as-code: Docker compose for Infisical + LGTM stack
- Secret scanning (gitleaks) pre-commit hooks
- Test suites: unit per MCP, integration per flywheel transition, end-to-end Revlon pilot run
- Remaining blocks (#31-35) and bug fixes

**Cowork owns (intent, decisions, specs, cross-system):**
- This PRD and all future versions
- Per-MCP mini-specs under `docs/mcp/{name}.md` — tools, schemas, auth pattern, rate-limit behavior, error taxonomy, acceptance tests
- Flywheel state machine spec (states, transitions, preconditions, side effects, telemetry events)
- `voice.json` schema + Revlon content
- Content pipeline strategy (what text/image Revlon actually needs for v0, volume estimates)
- Universal Editor authoring UX requirements
- Adversarial review via subagent before any MCP merges
- Research, decision briefs, trade-off analyses
- Executive communication and pipeline updates
- **All tooling, vendor, and integration configuration decisions** (see CLAUDE.md "Tooling & integration configuration" section)
- Secrets handling — tokens, Adobe IMS credentials, API keys all flow through Cowork and land in Infisical

**Handoff cadence:** Spec first (Cowork) → implementation (Claude Code) → adversarial review (Cowork) → merge. Nothing merges until Cowork adversarially reviews the diff. Nothing starts until its spec exists in `docs/`.

---

## 14. Source Appendix

- MCP spec 2025-11-25: https://modelcontextprotocol.io/specification/2025-11-25
- Firefly Services API: https://developer.adobe.com/firefly-services/
- Frame.io V4 API: https://developer.adobe.com/frameio/
- Workfront API v21: https://developer.adobe.com/workfront/
- Universal Editor docs: https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/developing/universal-editor/component-definition
- Infisical: https://infisical.com/docs/self-hosting/overview
- LGTM stack (Grafana): https://grafana.com/oss/
- Turborepo: https://turborepo.com/
- Descope MCP gateway (multi-tenant reference): https://www.descope.com/
- Stainless: https://www.stainless.com/ — Kubb: https://kubb.dev/ (codegen from OpenAPI)

---

*End of PRD v1. Lock after Section 11 residual decisions; freeze before Phase 1 kickoff.*
