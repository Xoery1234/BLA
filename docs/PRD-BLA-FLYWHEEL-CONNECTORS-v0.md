# PRD — BLA Flywheel Connectors v0

**Status:** Draft for executive review
**Owner:** Product (J)
**Author:** Claude (Cowork), based on adversarially-verified research
**Date:** 2026-04-18
**Version:** v0 (pre-approval)

---

## 1. Summary

BLA today ships a static multi-tenant brand-site template on Adobe EDS. To become a Tier-1 offering with a defensible moat, it needs the **flywheel**: an orchestrated loop where brand voice + product data → Firefly-generated assets → Frame.io review → Workfront approvals → da.live publish → EDS live, with feedback telemetry closing the loop.

The connector layer to enable this does not exist off-the-shelf. This PRD specifies the optimal architecture — a mix of **build, buy, reuse** — to stand up the flywheel in ~7 weeks vs ~15 weeks if we built everything ourselves.

**Recommendation (TL;DR):**

- **BUILD** two MCPs: (a) a Firefly Services MCP — none exists anywhere; (b) a BLA Orchestrator MCP — this encodes the Monks flywheel state machine and is the actual moat.
- **BUY** two MCPs via Zapier: Frame.io V4 (production-ready) and Adobe Workfront (production-ready).
- **REUSE** Adobe AEM MCP, da.live MCP, GitHub MCP — already connected and working.

**Why this mix wins:** build only where no option exists or where IP lives; buy where a maintained commercial option already exists; reuse what's already proven in our stack. Minimizes engineering spend, maximizes time-to-flywheel.

---

## 2. Strategic Context

**The moat is the orchestration, not the connectors.** Every agency can call Firefly. What Monks can defensibly own is the state machine that encodes: brand voice → creative brief → generation constraints → QA gates → review routing → approval SLAs → publish cadence → measurement. That is the Orchestrator MCP. Everything else is plumbing.

**Why MCPs and not a bespoke middleware:** MCP is the emerging standard (spec 2025-11-25, OAuth 2.1 + PKCE mandatory). Claude Code, Cowork, Claude Design, and any future LLM client can all invoke the same MCPs. This is cheaper to maintain and broader in reach than a REST middleware that only our clients can call.

**Path 2 (activate the Adobe flywheel) is highly feasible** — the APIs exist, auth patterns are known, and commercial MCP wrappers already cover 2 of the 3 Adobe services we need. The risk is not technology; it is disciplined product scoping so v0 ships in 7 weeks and not 7 months.

---

## 3. Scope

**In scope (v0):**
- Firefly Services MCP (text-to-image, fill, expand; async polling)
- BLA Orchestrator MCP (brief → generate → review → approve → publish state machine)
- Integration with Zapier Frame.io V4 MCP
- Integration with Zapier Adobe Workfront MCP
- Multi-tenant isolation pattern (tenant context per request)
- Secrets/vault wiring for per-tenant Adobe IMS credentials
- Observability: logging, tracing, error reporting across the chain
- One end-to-end pilot: Revlon "Product Hero" brief → published page

**Out of scope (v0):**
- Firefly custom model training automation (manual UI-only per Adobe)
- Workfront automated approval transitions (use UI approvals in v0)
- Non-Adobe DAM integrations
- Full Content Supply Chain measurement dashboard (v1)
- Multi-region deployment

---

## 4. Optimal Architecture

```
                    ┌──────────────────────────────────────┐
                    │      Clients (Cowork, Code, Design)  │
                    └──────────────┬───────────────────────┘
                                   │ MCP (OAuth 2.1 + PKCE)
                    ┌──────────────▼───────────────────────┐
                    │      BLA Orchestrator MCP (BUILD)    │
                    │  - tenant context resolver           │
                    │  - flywheel state machine            │
                    │  - brief → brand voice → constraints │
                    │  - QA gates, human approval routing  │
                    │  - telemetry aggregation             │
                    └──┬────────┬────────┬────────┬────────┘
                       │        │        │        │
              ┌────────▼──┐ ┌───▼────┐ ┌─▼──────┐ ┌▼────────────┐
              │ Firefly   │ │Frame.io│ │Workfrnt│ │ AEM/da.live │
              │ MCP       │ │ MCP    │ │ MCP    │ │ MCP         │
              │ (BUILD)   │ │(Zapier)│ │(Zapier)│ │ (REUSE)     │
              └────┬──────┘ └───┬────┘ └───┬────┘ └──────┬──────┘
                   │            │          │             │
              ┌────▼─────┐ ┌────▼─────┐ ┌──▼──────┐ ┌────▼─────┐
              │ Firefly  │ │ Frame.io │ │Workfront│ │ EDS +    │
              │ Services │ │ V4 (EA)  │ │ API v21 │ │ da.live  │
              └──────────┘ └──────────┘ └─────────┘ └──────────┘
```

Each MCP handles: auth, rate-limit backoff, error normalization, response schema. The Orchestrator is the only MCP with business logic.

---

## 5. Per-Service Specifications

### 5.1 Firefly Services MCP (BUILD — the biggest line item)

**Why build:** No MCP wrapper exists in any registry (verified: npm, Zapier, Descope, Anthropic directory). Firefly is central to the flywheel. Cannot buy; cannot reuse.

**Auth:** OAuth 2.0 Server-to-Server via Adobe IMS. Per-tenant client_id/client_secret in vault. Token cache with refresh before expiry.

**Tools to expose (v0):**
- `firefly.generate_image({prompt, style_ref?, content_class, num_variations, size, tenant_id})`
- `firefly.fill({image_url, mask_url, prompt, tenant_id})`
- `firefly.expand({image_url, direction, tenant_id})`
- `firefly.get_job_status({job_id, tenant_id})` — polling only; no webhooks
- `firefly.list_custom_models({tenant_id})` — training remains UI

**Async pattern:** Adobe provides polling-only for async jobs. MCP internally runs a polling worker pool per tenant with exponential backoff (1s → 2s → 4s, cap 30s). Returns a job handle immediately, client polls `get_job_status`.

**Rate limits:** 4 RPM default per tenant. MCP implements per-tenant token bucket. Returns 429-equivalent to client with Retry-After.

**C2PA:** All outputs carry Content Credentials. MCP surfaces C2PA manifest in response. Non-suppressible — document as feature, align with FTC disclosure.

**License:** $1K/month minimum per tenant (Adobe floor). Procurement needs executive sign-off.

**Stack:** TypeScript, StreamableHTTP transport, npm-publishable. Consider Stainless or Kubb for codegen from Firefly OpenAPI (60-70% generated, rest hand-tuned).

**LOE:** ~3 weeks (1 eng, 1 codegen + 2 hand-tune + polling + auth).

---

### 5.2 BLA Orchestrator MCP (BUILD — the moat)

**Why build:** This is where Monks IP lives. Encodes brand voice rules, generation constraints, QA gates, approval routing, publish cadence. Generic orchestrators (Zapier, n8n) can't carry the domain logic we need.

**Tools to expose (v0):**
- `flywheel.start_brief({tenant_id, template, inputs})` — returns brief_id
- `flywheel.generate_creative({brief_id, num_variations})` — calls Firefly MCP with voice-constrained prompts
- `flywheel.submit_for_review({brief_id, frameio_project})` — calls Frame.io MCP to create review asset
- `flywheel.request_approval({brief_id, workfront_request_type})` — calls Workfront MCP
- `flywheel.publish({brief_id, aem_target, da_target})` — calls AEM + da.live MCPs
- `flywheel.get_state({brief_id})` — returns current state, history, blockers
- `flywheel.telemetry({brief_id})` — aggregates durations, rework counts, outcomes

**State machine:** `draft → generating → in_review → awaiting_approval → approved → publishing → live → measured`. Each transition logged with timestamp, actor, inputs/outputs. Resumable from any state.

**Brand voice layer:** Reads per-tenant `voice.json` (Task #48 in backlog). Translates brand voice into Firefly prompt constraints (style, content_class filters, forbidden terms).

**Multi-tenant isolation:** Per-request `tenant_id` metadata. Orchestrator resolves tenant-specific: Adobe IMS credentials, Frame.io project IDs, Workfront project IDs, AEM paths, brand voice, template bindings. Pattern follows Descope MCP gateway reference (per-request context).

**Stack:** TypeScript, StreamableHTTP. Redis or Postgres for state (decision pending — see Section 11). Sentry or equivalent for tracing.

**LOE:** ~3 weeks (1 eng; state machine + tenant resolver + 5 cross-MCP flows + telemetry).

---

### 5.3 Frame.io V4 MCP (BUY — Zapier)

**Why buy:** Zapier ships a maintained Frame.io V4 MCP today. V4 is still Early Access — let Zapier absorb the breaking-change burden.

**Coverage check required before commit:** validate Zapier's Frame.io MCP exposes the subset we need (create asset, upload, share link, get comments, set status). If gaps exist, write a thin facade in the Orchestrator.

**Auth:** Zapier handles OAuth via Adobe IMS. We bind a tenant's Zapier account to their Frame.io workspace. Known gotcha: Frame.io V4 OAuth requires account-linking or 401s — Zapier's flow handles this.

**Webhooks:** Frame.io V4 webhooks are stable and supported. Orchestrator subscribes via Zapier for review-complete, comment-added, status-changed events.

**Fallback plan:** If Zapier's MCP is insufficient, build a thin Frame.io V4 MCP in TypeScript wrapping the REST API. Python SDK exists but we're TypeScript-first. LOE ~2 weeks.

---

### 5.4 Adobe Workfront MCP (BUY — Zapier)

**Why buy:** Zapier ships a production Workfront MCP. Workfront API v21 (Oct 2025) supports what we need for review/approval requests.

**Tools used:** create_request, attach_asset, get_approval_status, add_comment.

**Auth:** OAuth via Adobe IMS (JWT deprecated Jan 1, 2025). Zapier handles.

**Known gap:** Approval **state transitions** via direct API are documented ambiguously. v0 workaround: humans approve in the Workfront UI. Orchestrator polls status. Aligns with D-CCP-14 (human-only approval gates) in backlog.

**Webhooks:** 5/sec limit per tenant. Orchestrator ingest must rate-limit; Zapier may already handle.

**Native Frame.io bridge:** Workfront has a built-in Frame.io integration. Use it for review→approval handoff where possible; saves Orchestrator logic.

---

### 5.5 Reused MCPs (no new work)

- **AEM MCP** — already connected, publishes to EDS.
- **da.live MCP** — already connected, manages da.live content.
- **GitHub MCP** — already connected, manages block/template code.

No spec changes; Orchestrator composes them.

---

## 6. Multi-Tenant Isolation

Every MCP tool call requires a `tenant_id` in request metadata. Orchestrator validates and resolves:

- Adobe IMS credentials (vaulted per tenant)
- Firefly license/quota (per tenant)
- Frame.io account + workspace (per tenant)
- Workfront project (per tenant)
- AEM path + da.live path (per tenant)
- `voice.json` (per tenant, in repo under `tenants/{tenant_id}/`)

**Pattern:** Descope MCP gateway reference — context metadata on every request. Prevents Tenant A's token from being used in Tenant B's request even if caller is compromised.

**Secrets:** Per-tenant Adobe IMS credentials stored in vault (AWS Secrets Manager, GCP Secret Manager, or 1Password Service Accounts — see Section 11 decision). **Never** in `.mcp.json` or repo.

---

## 7. Gap Analysis + Solution Directions

| # | Gap | Impact | Solution Direction |
|---|-----|--------|---|
| 1 | Firefly has no webhooks, polling only | Latency + cost for long jobs | Polling worker pool in Firefly MCP with exponential backoff; Orchestrator returns job handle immediately, client polls |
| 2 | Workfront approval state transitions unclear via API | Can't fully automate approvals | v0 uses UI approvals (aligns with D-CCP-14 human-only gates); revisit when Adobe clarifies |
| 3 | Firefly custom model training is UI-only | Can't automate per-tenant model onboarding | Manual per-tenant onboarding by Monks team; MCP calls by model_id once trained |
| 4 | Frame.io V4 still Early Access | API may change | Zapier absorbs the breaking-change burden; we pin to Zapier MCP version |
| 5 | C2PA Content Credentials non-suppressible | Clients may object | Document as feature: aligns with FTC AI-disclosure direction; include in brand pitch |
| 6 | No Frame.io JS/TypeScript SDK | Python-only if building ourselves | Zapier MCP abstracts SDK; if we build in-house later, wrap REST directly from TS |
| 7 | Firefly $1K/month minimum license | Raises per-tenant floor | Budget as Tier-1 infra cost; only onboard tenants where ARR justifies |
| 8 | Workfront general rate limits unpublished | Risk of silent throttling | Exponential backoff in MCP; request rate-limit clarity from Adobe account team |

---

## 8. Acceptance Criteria (v0)

1. Revlon pilot: "Product Hero" brief flows end-to-end through all 5 states (draft → live) with 0 manual MCP calls (only human approval click).
2. Firefly MCP returns 95% of generation jobs within 60s; polling doesn't block the Orchestrator thread.
3. Tenant A cannot invoke any tool with Tenant B's credentials, even with a crafted request.
4. All 8 Firefly rate-limit breaches in a stress test are handled with exponential backoff; no job failures.
5. Full Revlon flow is resumable from any state after Orchestrator restart.
6. Observability: every state transition logged with tenant_id, brief_id, duration, actor.
7. Secret scan (gitleaks or equivalent) on CI — no credentials in repo.
8. `voice.json` for Revlon exists and constrains Firefly prompts (verified via red-team test: prompt without voice guard produces off-brand imagery; with guard, on-brand).

---

## 9. LOE + Phasing

**Phase 0 (Week 0, ~3 days):** Decisions (Section 11), vault provisioning, Zapier accounts, Firefly license procurement kickoff, repo scaffolding.

**Phase 1 (Weeks 1-3):** Firefly MCP build (auth, tools, polling, rate limits, C2PA surfacing, tests).

**Phase 2 (Weeks 2-4, overlap):** Orchestrator MCP build (state machine, tenant resolver, brand voice layer). Wire Zapier Frame.io + Workfront.

**Phase 3 (Weeks 5-6):** Revlon pilot integration. End-to-end flow. Observability. Stress tests.

**Phase 4 (Week 7):** Hardening, docs, runbooks, handover to ops.

**Total:** ~7 calendar weeks, ~2 engineers (Firefly MCP eng + Orchestrator eng), plus product, QA, vendor ops.

**Alt (all-build, rejected):** ~15 weeks. Adds building Frame.io MCP + Workfront MCP from scratch. Only justified if Zapier MCPs are insufficient on detailed eval.

---

## 10. Risks

- **Firefly license delay:** Adobe procurement can take weeks. Kick off in Phase 0, not Phase 1.
- **Zapier coverage gap:** Zapier's Frame.io or Workfront MCPs may not expose tools we need. Mitigation: detailed coverage check in Phase 0; fall back to thin in-house MCPs (+2 weeks each).
- **Frame.io V4 breaking change during EA:** Pin to Zapier version; monitor release notes.
- **Multi-tenant isolation bug:** Highest-severity risk. Mandatory red-team test before any second tenant onboards.
- **Scope creep into v1 territory:** Measurement dashboard, Firefly model training automation, non-Adobe DAMs — all explicitly out of scope. Enforce.

---

## 11. Open Decisions (need executive call before Phase 0)

1. **Hosting location for MCPs:** AWS, GCP, or Monks-managed Kubernetes? Affects vault choice, observability stack, per-tenant cost.
2. **Zapier commitment:** Commit to Zapier Frame.io + Workfront MCPs after coverage check, or plan in-house builds from day 1?
3. **Firefly license procurement:** Who owns the $1K/month/tenant billing — Monks reseller, client direct, or Monks-funded for pilot?
4. **Vault product:** AWS Secrets Manager, GCP Secret Manager, 1Password Service Accounts, or HashiCorp Vault?
5. **Observability stack:** Sentry + Datadog, OpenTelemetry self-hosted, or Grafana Cloud?
6. **Monorepo vs per-MCP repos:** One BLA monorepo with Firefly + Orchestrator, or separate repos per MCP (better for OSS later)?

---

## 12. Source Appendix

- MCP spec 2025-11-25: https://modelcontextprotocol.io/specification/2025-11-25
- Firefly Services API docs: https://developer.adobe.com/firefly-services/
- Frame.io V4 API docs: https://developer.adobe.com/frameio/
- Workfront API v21: https://developer.adobe.com/workfront/
- Zapier MCP directory: https://zapier.com/mcp
- Descope MCP gateway (multi-tenant reference): https://www.descope.com/
- Stainless (codegen): https://www.stainless.com/
- Kubb (codegen): https://kubb.dev/

---

*End of PRD v0. Revise post-executive review; lock v1 before Phase 1 kickoff.*
