# BLA Spec Adversarial Review — Findings

**Date:** 2026-04-19
**Reviewer:** adversarial-reviewer subagent (independent of spec author)
**Scope:** `docs/mcp/llm-mcp-spec.md` (c83050d), `docs/mcp/adobe-mcp-spec.md` (e4fa20b), `docs/mcp/orchestrator-mcp-spec.md` (134afdac), `docs/NFR-PERFORMANCE-TARGETS-v0.md` (b0481bc)
**Brief:** `docs/ADVERSARIAL-SPEC-REVIEW-BRIEF.md` (1e46911) — 10 failure-mode probes
**Verdict:** **NEEDS REVISION — do not start Phase 1 coding until critical + high items resolved**
**Cost of fixing now:** ~2–3 days (spec clarification + test additions)
**Cost of fixing in Phase 1:** ~2 weeks (rework + integration-test failures)

---

## Executive summary

The specs are architecturally sound and nearly implementation-ready. Independent adversarial probing surfaced:

- **1 CRITICAL factual error** — prompt-cache minimums wrong by 2x, cost model affected.
- **1 CRITICAL model-capability error** — Opus thinking-budget API call shape will 400 if used as spec implies.
- **10 HIGH-severity gaps** — auth flow, event-dedup ambiguity, publish safety semantics, webhook SLAs, cost-race windows, PRD/spec drift.
- **10 MEDIUM-severity design ambiguities** — state-machine recovery paths, optimistic-lock livelock, Drizzle justification, clock skew, daily-cap boundaries.
- **Notes** — docs hygiene, voice.json schema, dead-letter alerting depth.

The triple-gate vs double-gate live-publish naming drift between specs and NFR is the single most dangerous ambiguity (future-v1 bypass risk). The Sonnet 4.6 cache-minimum error is the single most impactful factual issue (wrong padding → wasted tokens → busted cost model).

---

## CRITICAL issues

### C1. Sonnet 4.6 prompt-cache minimum is 1024 tokens, not 2048

**Where:** `llm-mcp-spec.md` §5.2 "Prompt caching" and cost table §9.

**Spec claim:** "Minimum cacheable prompt segment for Sonnet 4.6 is 2048 tokens; pad with system-prompt filler if below threshold."

**Reality (verified via Anthropic docs as of 2026-04-18):** Minimum is **1024 tokens** for Sonnet 4.6. Haiku 4.5 is 2048. Spec conflates the two.

**Impact:**
- Padding logic adds ~1024 wasted input tokens per request → violates the "predictable cost" argument of the LLM MCP.
- Cost model in §9 overstates first-invocation cost by roughly the padding delta.
- Integration tests written against 2048 threshold will pass the padding check but the real cache boundary will behave differently → silent cache-miss regressions in prod.

**Fix:**
- Replace "2048" with "1024" for Sonnet 4.6 in §5.2 and §9.
- Remove the unconditional padding; gate padding on `estimated_tokens < model.cache_minimum`.
- Add unit test: prompt at 1023/1024/1025 tokens → assert cache-read vs cache-create behavior.

**Severity rationale:** factual error, downstream cost/test implications, visible the first day of implementation.

---

### C2. Opus 4.7 does not support `thinking.type: "enabled"` + `budget_tokens`

**Where:** `llm-mcp-spec.md` §4.1 `GenerateCopyInput.reasoning_budget` and Opus escalation path.

**Spec claim:** Implies Opus calls can pass `thinking: { type: "enabled", budget_tokens: 5000 }` to control deliberation depth.

**Reality:** Opus 4.7 uses **adaptive thinking only** — the Messages API rejects `thinking.type: "enabled"` with a 400 when combined with Opus 4.7 (differs from earlier Opus 4 models). Sonnet 4.6 and Haiku 4.5 still accept the budget form.

**Impact:**
- Any Opus escalation branch in generate_copy will throw `invalid_request_error` on first run.
- Escalation was introduced precisely to improve quality on complex briefs → this bug disables the escalation path entirely.

**Fix:**
- In §4.1, gate the `thinking` block on `model !== "claude-opus-4-7"`.
- Document Opus as "adaptive thinking, no budget control" — relies on prompt framing.
- Add contract test per model asserting the request body shape the provider will accept.

---

### C3. PRD v2 §2 still claims "unified Adobe IMS S2S" — contradicts spec reality

**Where:** `PRD-BLA-FLYWHEEL-CONNECTORS-v2.md` §2 ("Adobe entitlements") and §3.1 ("single Adobe IMS S2S OAuth client").

**Spec reality (`adobe-mcp-spec.md` §3.3–3.5):** Three distinct auth stores — Workfront IMS S2S, EDS admin API keys, DA.live IMS user-backed. Not unified.

**Impact:**
- PRD is the doc stakeholders reference. If it stays wrong, entitlement audits and onboarding docs will drift further from reality.
- Implementation time estimate (§8: "unified Adobe auth" cited as a compression driver) overstates simplification benefit.

**Fix:**
- Revise PRD §2 + §3.1 to describe three auth stores, single credential-rotation *policy*, and per-service secret namespaces.
- Re-justify the LOE compression from "2 MCPs + unified auth" to "2 MCPs + disciplined auth isolation."
- Cross-reference the spec §3.3–3.5 as source of truth.

**Severity:** CRITICAL because PRD is the stakeholder-facing artifact and the claim is load-bearing for the LOE argument, even though spec is correct.

---

## HIGH-severity issues

### H1. Triple-gate (specs) vs double-gate (NFR) for live publish — naming drift conceals intent mismatch

**Where:** `adobe-mcp-spec.md` §6.3 (live publish) vs `NFR-PERFORMANCE-TARGETS-v0.md` §6.2.

- Specs require **three** gates: env flag `BLA_ALLOW_LIVE_PUBLISH=true` + per-call input ack `confirm_live: true` + per-brief `briefs.allow_live_publish = true`.
- NFR describes it as **"double-gate"** — env flag + brief flag, omitting the per-call input ack.

**Impact:** In v1 when live publish turns on, an implementer reading NFR (the more user-facing doc) will build a 2-gate check. The 3rd gate disappears silently → a brief with `allow_live_publish=true` in Postgres becomes one env-flag toggle away from production publish, with no per-request human-in-the-loop.

**Fix:**
- Align NFR §6.2 to "triple-gate" and enumerate all three gates.
- Add section-number cross-ref between NFR and adobe-mcp-spec §6.3.
- Add a contract test: setting any two gates without the third must return `LivePublishUnauthorizedError`.

---

### H2. Workfront webhook: `status` vs `approvalStatus` field ambiguity

**Where:** `orchestrator-mcp-spec.md` §2.3 (webhook ingestion) vs §8.4 (approval detection).

§2.3 reads event `status` field; §8.4 reads `approvalStatus`. Workfront's payload has both for tasks under approval workflow. They are not the same — `status` is task-lifecycle (NEW, INP, CPL, DLY); `approvalStatus` is approval-decision (PND, APV, REJ).

**Impact:** The approve/reject branch will misfire if implemented against the wrong field. Most likely failure mode: task marked complete by an assignee who had no approval authority → orchestrator interprets as "approved" → triggers publish.

**Fix:**
- Orchestrator §8.4 is correct: match on `approvalStatus == "APV"`.
- Edit §2.3 to explicitly say "ignore `status` field; read `approvalStatus` for approval decisions; read `status` only for lifecycle observability."
- Add webhook fixture set: APV, REJ, PND, plus CPL-without-approval → assert only APV triggers publish.

---

### H3. Event signature formula underspecified — replay-defense fragile

**Where:** `orchestrator-mcp-spec.md` §2.3, `webhook_events.event_signature` unique constraint.

Signature is described as "hash of (source, event_id, eventTime, entity_id)" but no:
- Hash algorithm
- Field delimiter
- Timestamp format (Workfront returns ISO-8601 with milliseconds *and* offset variants)
- Canonicalization rules (leading zeros, case)

**Impact:** Two legitimate-looking but bytewise-different serializations of the same event will hash differently → duplicate inserts bypass dedup → double-published brief.

**Fix:**
- Specify: `SHA-256(canonical_json({source, event_id, event_time_utc_iso_no_ms, entity_id}))` with RFC 8785 JCS canonicalization.
- Normalize `event_time` to `…Z` with ms truncated.
- Add property test (fast-check) with event payload permutations asserting constant signature.

---

### H4. DA.live OAuth scope marked "TBC" — hard implementation blocker

**Where:** `adobe-mcp-spec.md` §3.4.

Spec says: "DA.live uses IMS user-backed token — scope list TBC pending confirmation with DA.live team."

**Impact:** Adobe MCP v0 cannot authenticate to DA.live without knowing the scope. Task #57 (Build Adobe MCP v0) is effectively blocked on this.

**Fix:**
- Pre-Phase-1: ping DA.live product team (Aaron Brady / Dylan Depass path) for exact scope string.
- Capture in spec §3.4 with confirmation date and contact.
- Fallback: document how to degrade to "DA.live disabled; fall back to pre-placed assets" for the demo if scope is not known by kickoff.

---

### H5. Cost-cap ledger race window — serial assumption is not enforced

**Where:** `llm-mcp-spec.md` §8 (cost cap) says: "race condition window acceptable in v0 given serial orchestrator dispatch."

**Reality:** Orchestrator is not explicitly serial. Home + PDP generation in Phase 2 is parallel (PRD §7). Any parallel fan-out breaks the serial assumption silently.

**Impact:** Two concurrent generate_copy calls both read ledger showing $0.40 used on a $1.00 brief cap. Each passes cap check, each dispatches. Budget breach is bounded per-brief but not bounded *across* briefs or days.

**Fix:**
- Either: enforce serial dispatch explicitly in orchestrator (slow path), or
- Use `SELECT … FOR UPDATE` on `cost_ledger` row + increment before API dispatch (fast path). Preferred.
- Add race test: fire 5 parallel `generate_copy` calls at 95% of cap → assert total spend ≤ cap × (1 + small slop) and at least N-1 requests fail closed.

---

### H6. Webhook handler 5-second deadline is tight for Postgres double-write

**Where:** `adobe-mcp-spec.md` §4.4 (Workfront webhook deadline) + `orchestrator-mcp-spec.md` §2.3.

Workfront deadlines inbound requests at 5s. Orchestrator handler does: verify mTLS → verify authToken → read idempotency → insert `webhook_events` → insert `brief_state_history` → commit → respond 200. Under cold-start + concurrent write pressure, median is fine but P99 can exceed 5s.

**Impact:** Workfront treats 5s timeout as retryable failure → 11 retries over 48h → same event lands 12x. Dedup via `event_signature` handles idempotency, but retry storms inflate DB write QPS and Loki cost.

**Fix:**
- Split into "fast-ack handler" (respond 200 after `webhook_events` insert only) + async consumer for state-history + publish trigger.
- Add SLO: P99 webhook ack < 2s.
- Alert on Workfront retry count > 0 per event (indicates SLO breach).

---

### H7. Publish-bypass paths — future v1 security risk

**Where:** `adobe-mcp-spec.md` §6.3 triple-gate, `orchestrator-mcp-spec.md` §9.

Current v0 ships with live publish fully disabled (env flag off). v1 plan flips env flag on. No specified path for:
- Gate rollback if one brief goes bad
- Tenant-level override (per-brand live-publish allow list)
- Audit review of gate flips (who flipped `allow_live_publish=true` on brief X?)

**Impact:** The first production incident on live publish will have no rollback mechanism short of SSHing to flip the env flag → downtime.

**Fix:**
- Add §6.3.1: "Emergency kill switch" — DB row in `system_flags` checked on every publish call (fail-closed on read error).
- Add audit trail: all writes to `briefs.allow_live_publish` logged to `brief_state_history` with actor identity.
- Add per-brand allow list: `brands.live_publish_allowed BOOLEAN` checked as 4th gate at brand granularity.

---

### H8. voice.json schema not pinned — runtime will crash on missing fields

**Where:** `llm-mcp-spec.md` §6 (voice injection), referenced from task #48.

Spec describes voice.json semantics but does not define a schema. Implementation reads `voice[brand].tone`, `voice[brand].banned_terms`, etc. If a brand's voice.json is incomplete (e.g., Revlon has `tone` but no `emphasis_scale`), the merge with `tone_overrides` is undefined behavior.

**Impact:** First brand onboarded post-Revlon may silently get default-tuned prompts → off-brand output → QA failure.

**Fix:**
- Pin `packages/shared/schemas/voice-schema.json` as JSON Schema draft 2020-12.
- Require voice.json validation on LLM MCP startup; fail-fast with clear error if invalid.
- Document required vs optional fields.

---

### H9. Optimistic lock retry — unbounded livelock risk on hot briefs

**Where:** `orchestrator-mcp-spec.md` §5.2 — "retry 3x with 50-500ms jitter on version conflict."

**Reality:** 3 retries is fine for low-contention writes, but a brief under heavy state churn (e.g., concurrent generate + webhook + watcher tick) can hit conflict on all 3 attempts, fail, and enter a poison state because the actual desired transition never lands.

**Impact:** Briefs in a state-transition storm get marked `failed` when they should have succeeded.

**Fix:**
- Classify transitions: "critical" (must succeed — use stronger serialization) vs "observational" (can drop — e.g., cost-log append).
- For critical transitions, use `SELECT … FOR UPDATE` instead of optimistic lock.
- Add metric: `bla_optimistic_lock_retries_exhausted_total` with alert at >0/5min.

---

### H10. Stuck-brief watcher can recover states but never un-fails

**Where:** `orchestrator-mcp-spec.md` §5.4 (stuck-brief watcher).

Watcher detects briefs stuck in `generating`/`under_review`/`publishing` past SLA threshold. Transitions them to `failed`. But §5.4 has no path for `failed → received` (retry) or `failed → done` (manual resolution).

**Impact:** Any transient infrastructure blip → brief permanently dead, requires manual SQL to resurrect.

**Fix:**
- Add `orchestrator.retry_brief(brief_id)` tool with actor + reason logged.
- Add `failed` → `received` transition in state machine §5.1 gated on `retry_brief` call.
- Document operator runbook for failed-brief recovery.

---

## MEDIUM-severity issues

### M1. Clock-skew tolerance on ±10min eventTime window

Spec uses ±10 min against server `now()`. Workfront's clock runs in Adobe infra; Postgres clock on J's VPS. If VPS clock drifts (no `chrony` configured), events get replay-rejected or accepted-as-new incorrectly. **Fix:** NTP requirement added to Phase 0 VPS bootstrap checklist + observability metric on `time.delta.ms`.

### M2. Event-subscription idempotency on restart

Orchestrator §4.1 subscribes to Workfront events on boot. Subscription creation is not idempotent — restart → duplicate subscriptions → duplicate events → dedup table fills. **Fix:** `workfront.subscribe_event` checks existing subscriptions by name + URL before creating; or use deterministic subscription ID.

### M3. Drizzle vs Prisma justification is weak for this workload

Orchestrator §3 picks Drizzle citing "lighter runtime." At Revlon-pilot QPS (< 1/min), runtime weight is irrelevant. Prisma's richer migration tooling + generated types may be the better trade-off. **Fix:** Either re-justify Drizzle on a non-performance axis (SQL fidelity, explicit control over joins) or switch to Prisma. Not a blocker either way, but the stated reason is cargo-culted.

### M4. Daily cost-cap boundary race around UTC rollover

§8 of llm-mcp-spec resets daily ledger at UTC 00:00. A brief submitted at 23:59:55 UTC with 10-second generation spans the boundary. Behavior undefined. **Fix:** Ledger entries timestamped at request-start; cap check against the window the request *started in*.

### M5. Failed-state recovery path unclear (see H10)

Duplicate of H10 at MEDIUM — noted because orchestrator §6 mentions `failed` terminally. Consolidate.

### M6. Dead-letter queue alerting is only at >0 count

`orchestrator-mcp-spec.md` §11 alerts when DLQ has any entry. But doesn't page on rate (e.g., >5/hr = systemic issue). **Fix:** two alerts — warn at any, page at sustained rate.

### M7. Webhook retry blast — bounded, but not shed

When Workfront retries 11x, each retry touches Postgres. During a Workfront outage recovery, this can become a thundering herd. **Fix:** rate-limit `webhook_events` inserts per-source at 100 QPS; shed at 429 with retry-after hint.

### M8. Infisical folder naming not enforced in scaffold

PRD specifies letters/numbers/dashes (no underscores) but no lint on `apps/*/env.ts` to ensure paths match. **Fix:** add `packages/shared/infisical-path-validator.ts` with unit tests.

### M9. LGTM-via-Alloy — Mimir vs Prometheus-remote-write

Spec mentions Mimir. Alloy default path is OTLP → Tempo/Loki, Prom RW → Mimir. Worth confirming Alloy config sends traces via OTLP and metrics via PRW, not all through OTLP. **Fix:** pin Alloy config snippet in `docs/mcp/observability.md`.

### M10. No spec for `refresh` brief type (schema v0 allows it, no handling documented)

`brief-schema-v0.md` allows `type: refresh` and `source_brief_id`. Orchestrator and LLM MCP specs do not describe how a refresh brief differs from a product-launch brief. **Fix:** either document refresh handling or remove `refresh` from enum in v0.

---

## NOTES (low-severity, docs hygiene)

- **N1.** Spec cross-references use section numbers not anchors → links rot when sections renumber. Prefer `#section-heading-slug` links.
- **N2.** Error-class enumeration in llm-mcp §10 uses 11 classes; adobe-mcp §8 uses 9 classes. Harmonize naming (e.g., `RateLimitError` vs `ProviderRateLimitError`).
- **N3.** Orchestrator §3 Postgres schema doesn't pin extensions (`uuid-ossp`, `pgcrypto`). Add to migration 0001.
- **N4.** LLM MCP spec table for Tier 1 rate limits omits retry-after header semantics — Claude API returns `retry-after` in seconds; document.
- **N5.** `brief-schema-v0.md` lists 12 shades for Revlon ColorStay example — verify this matches the actual demo brief to avoid divergence.

---

## Verification summary

| Area probed | Verdict | Severity |
|---|---|---|
| Auth flow coherence | Three-auth-store, PRD drift | HIGH (C3) |
| Webhook model | Field ambiguity, signature underspec, SLA tight | HIGH (H2, H3, H6) |
| Publish double-gate bypass | Drift NFR↔spec, no kill switch, no per-brand gate | HIGH (H1, H7) |
| Cost-cap semantics | Race window, daily boundary, parallel dispatch | HIGH/MED (H5, M4) |
| voice.json enforcement | Schema missing | HIGH (H8) |
| State-machine invariants | Recovery paths missing, lock livelock | HIGH (H9, H10) |
| Observability cost | DLQ alerting shallow, retry blast | MED (M6, M7) |
| Cross-spec drift | Triple/double-gate naming, PRD claims | CRITICAL (C3, H1) |
| NFR alignment | Drift identified, numbers plausible | HIGH (H1) |
| Model capability | Cache minimum wrong, Opus thinking wrong | CRITICAL (C1, C2) |

---

## Implementation-blocker questions for J

1. **C1/C2:** Approve Sonnet cache minimum correction to 1024 and Opus thinking-budget gating? (Both small spec edits, clear fixes.)
2. **C3:** Revise PRD v2 §2 + §3.1 now or after specs ship? (Recommend now — stakeholders read PRD first.)
3. **H1:** Adopt "triple-gate" as canonical language everywhere? (Recommend yes — safer default.)
4. **H4:** Who pings DA.live team for scope string? (Blocker for Adobe MCP build.)
5. **H7:** Add brand-level `live_publish_allowed` as 4th gate in v0 or defer to v1? (Recommend v0 — cheap.)
6. **H10:** Add `orchestrator.retry_brief` tool in v0 or defer? (Recommend v0 — avoids operator SQL incidents.)

---

## Recommended actions (prioritized)

1. **Now (1 day):** Fix C1, C2, C3 — factual corrections in specs + PRD. Low risk, high impact.
2. **Now (1 day):** Align H1 (triple-gate language) across NFR + specs + future implementation checklists.
3. **Pre-Phase-1 kickoff (1 day):** Resolve H4 (DA.live scope), H2/H3 (webhook field + signature canonicalization), H8 (voice.json schema).
4. **Phase 1, early (within first sprint):** H5 (cost ledger SELECT FOR UPDATE), H6 (split webhook handler), H9 (classify transition criticality), H10 (retry_brief tool).
5. **Ongoing:** MEDIUM items addressed during regular implementation; NOTES during final review pass.

---

## Final verdict

**NEEDS REVISION.** The specs are architecturally sound and nearly implementation-ready, but contain:
- **1 critical factual error** (cache minimums)
- **1 critical capability error** (Opus thinking API)
- **1 critical documentation drift** (PRD unified-auth claim)
- **10 high-severity gaps** (auth flows, event dedup, publish safety, webhook SLAs, cost races, voice.json schema, state recovery)
- **10 medium-severity ambiguities**

**Recommendation: do not start Phase 1 coding until critical + high items are resolved.** Estimated cost of fixing now: **2–3 days**. Estimated cost of fixing in Phase 1 once code is written against flawed specs: **~2 weeks** of rework and integration-test failures.

*End of findings.*

---

## Resolution (appended 2026-04-19 after Tranches 1 + 2)

Mapping of each CRITICAL and HIGH finding to the commit that closed it on `main`. MEDIUM and NOTE items remain open for Tranche 3 or explicit deferral per `docs/SPEC-REVISION-BRIEF-2026-04-19.md` §"Deferred to v1".

| Finding | Severity | Commit | Status after commit |
|---|---|---|---|
| **C1** — Sonnet 4.6 cache minimum + unconditional padding | CRITICAL | `596443f` | **CLOSED** — MODEL_CACHE_MIN dispatcher in llm-mcp-spec §4.3.1/2/3 + §8.4 rationale rewrite. Haiku cost-delta math in commit body shows old code never cached Haiku (saved ~$0.008/brief on Haiku fan-out). |
| **C2** — Opus 4.7 `thinking.type:"enabled"` returns 400 | CRITICAL | `fc0552d` | **CLOSED** — reasoning dispatcher in §4.2.1 with per-model capability matrix. Opus 4.7 → adaptive + effort; Sonnet 4.6 → effort preferred, budget_tokens deprecated-but-functional; Haiku 4.5 → manual thinking only; 8-case contract test. |
| **C3** — PRD v2 "unified Adobe IMS" claim wrong | CRITICAL | `cb1a67c` | **CLOSED** — PRD r2 → r3 header bump, new "Revision history" section, §1 key-changes table row rewritten, §2 "Auth simplification" → "Auth — three stores, one discipline" with per-store Infisical paths, §3.1 adobe-mcp rewritten, §8 LOE driver re-justified. Numeric LOE ballpark unchanged. |
| **H1** — Triple-gate (specs) vs double-gate (NFR) drift | HIGH | `05ab53c` | **CLOSED** — NFR §6.2 rewrite + §6.2.1 8-row contract test matrix + §6.2.2 other invariants. Env var `ENABLE_LIVE_PUBLISH` → `BLA_ALLOW_LIVE_PUBLISH`, per-call `allow_live_publish_ack` → `confirm_live`, error class `LivePublishGateError` → `LivePublishUnauthorizedError` harmonized across adobe-mcp + orchestrator-mcp. Historical review artifacts left as frozen records. |
| **H2** — Workfront `status` vs `approvalStatus` | HIGH | `db9713d` | **CLOSED** — orchestrator-mcp §2.3.1 explicit rule + §2.3.2 5-fixture set including `task-complete-no-approval.json` safety test. Behavior step 4 switched from prose APPROVED/REJECTED to API values APV/REJ with legacy-payload WARN branch. |
| **H3** — Event signature formula underspecified | HIGH | `b8e44ac` | **CLOSED** — orchestrator-mcp §8.4.1 pinned: SHA-256 over RFC 8785 JCS canonical JSON over fixed 4-field object; CHAR(64) lowercase hex storage; ISO-8601 Z ms-truncated; §8.4.4 property-based test spec. Schema column TEXT → CHAR(64). |
| **H4** — DA.live OAuth scope "TBC" | HIGH | `c28022c` + `4f324422` + `d484337f` | **CLOSED** — spec-side fail-fast startup matrix (c28022c) paired with resolved scope 2026-04-19. Scope string `ab.manage,AdobeID,gnav,openid,org.read,read_organizations,session,aem.frontend.all,additional_info.ownerOrg,additional_info.projectedProductContext,account_cluster.read` via IMS client `darkalley`, sourced from `adobe/da-live/scripts/scripts.js` public repo (no Adobe-contact outreach needed). adobe-mcp-spec §3.4 updated with full config + secret-path keys (d484337f); query doc rewritten as RESOLVED (4f324422). Remaining characterizations (token TTL, rate limits, S2S path via Developer Console) are first-boot empirical tasks with no external dependencies. |
| **H5** — Cost-ledger race window | HIGH | `1e1c2ed` | **CLOSED** — llm-mcp-spec §8.3.1 new subsection: per-brief ledger reads use `SELECT ... FOR UPDATE` with reserve-then-reconcile pattern (reserve worst-case at projection step, reconcile actual post-Anthropic). Daily-cap variant keyed on `(date_utc)` with lazy `INSERT ... ON CONFLICT DO NOTHING` before the lock. `lock_timeout=5s` → CostCapExceededError('ledger_lock_timeout'). Race test spec: 5 parallel calls at 95% of cap → exactly one succeeds, four fail-closed. |
| **H6** — Webhook handler 5s deadline tight | HIGH | `e85f1d0` | **CLOSED** — orchestrator-mcp §2.3.3 split into Stage 1 fast-ack (SLO P99 <2s: mTLS verify → authToken verify → INSERT ON CONFLICT DO NOTHING → 200) and Stage 2 async consumer (LISTEN/NOTIFY + 10s poll fallback → FOR UPDATE SKIP LOCKED LIMIT 10 → state transition → UPDATE processed). Schema addendum: processed/processed_at/attempts/last_error columns + partial index + notify trigger gated on mtls_verified=true. New metrics: `orchestrator_webhook_ack_seconds` (P99 alert >2s), `orchestrator_webhook_retry_received_total` (any = SLO breach), `orchestrator_webhook_queue_depth` gauge, `orchestrator_webhook_dlq_total`. Load test spec: 100 webhooks/60s, P99 <2s ack, zero Workfront retries. |
| **H7** — Publish-bypass paths (kill switch + per-brand + audit) | HIGH | `81864af` | **CLOSED** — adobe-mcp §8.5.1 kill switch (gate 0) via `system_flags.live_publish_kill` evaluated BEFORE triple-gate, fail-closed on DB read error with 500ms timeout → LivePublishUnauthorizedError('kill_switch_read_unavailable'). §8.5.2 per-brand allow list (gate 4) via `brands.live_publish_allowed` DEFAULT false, double-checked at orchestrator AND Adobe MCP. Orchestrator §4 schema adds `system_flags`, `brands`, `audit_log_publish_flags` + PL/pgSQL `audit_publish_flag_change()` trigger dispatching on TG_TABLE_NAME. Application must `SET LOCAL session.actor = '<email>'`; absence → actor='unknown' + alert. Audit mirrored to Loki under `bla.audit=publish_flag_flipped`. |
| **H8** — voice.json schema not pinned | HIGH | `e4954ba` | **CLOSED** — `packages/shared/schemas/voice-schema.json` shipped (JSON Schema 2020-12). Required-field set matches LLM MCP's actual reads. Revlon voice.json validated against schema (passes). llm-mcp §5 voice-loader row updated + new §8.5 fail-fast semantics (exit 78 on boot, BriefInvalidError at lazy read, WARN-and-serve-stale on cache refresh) + §9.3 contract test. **Note:** schema shape is flat-per-brand (matches production voice.json); revision brief's example used a `{brands: {id: …}}` wrapper that did not match production — flagged in the Patch 2.4 commit body. |
| **H9** — Optimistic lock livelock on hot briefs | HIGH | `748199c` | **CLOSED** — orchestrator-mcp §9.2 split into §9.2.1 CRITICAL (SELECT FOR UPDATE; 7 named transitions: received→validated, validated→generating, under_review→approved, approved→publishing, publishing→published, *→failed, *→cancelled) and §9.2.2 OBSERVATIONAL (optimistic 3× retry: brief_state_history appends inside CRITICAL tx, brief_artifacts appends, cost_ledger audit-only appends, metric/log emission). `lock_timeout=3s` → ConcurrencyConflictError + exp-backoff 100/400/1600ms jitter. Grafana alert on `orchestrator_optimistic_lock_retries_exhausted_total >0/5min`. Race test spec: 5 parallel `under_review→approved` → exactly one succeeds, four get IllegalTransitionError. |
| **H10** — Stuck-brief watcher has no retry path | HIGH | `ab07c34` | **CLOSED** — orchestrator-mcp §2.6 new tool `orchestrator.retry_brief(brief_id, actor, reason, reset_to_state?)` with `reason ≥10 chars` forced documentation + CRITICAL transition per §9.2.1. Three reset targets: `received` (default, full revalidate + regenerate), `validated` (skip revalidation), `generating` (skip to regenerate; for LLM transients only). State-machine diagram + transition rules updated — `failed` is **recoverable** (was terminal); `rejected` remains terminal. New runbook `docs/runbooks/failed-brief-recovery.md` with 7 sections: decision table, reset_to_state picker, invocation, post-invocation polling, bulk retries SQL, when-not-to-retry escape hatches, audit trail. |

### Summary
- CRITICAL closed: **3/3** (C1, C2, C3).
- HIGH closed: **10/10** (H1, H2, H3, H4, H5, H6, H7, H8, H9, H10).
- MEDIUM: M1, M2, M4, M8 closed in Tranche 3 cleanup commit `27483e6`. M3 (Drizzle vs Prisma re-justification) deferred to Sprint 2 brief per revision brief §"Deferred to v1". M5 duplicate of H10 (closed transitively). M6, M7, M9, M10 remain per revision brief §"Deferred to v1".
- NOTES: N1–N5 per revision brief §"Deferred to v1" (next doc-sweep session).

All Tranche 1 + 2 + 3 patches landed on `main` between `596443f` (Patch 1.1) and `27483e6` (cheap MEDIUMs). Phase 1 Sprint 1 scaffold complete at `c5186f0` (step 1), `e0a5c6f`/`ffd2ee8` (step 2), `0ff9a28` (step 3 CI). DA.live scope resolution appended in `4f324422` + `d484337f` (2026-04-19) — H4 fully closed.
