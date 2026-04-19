# BLA Non-Functional Requirements — Performance, Cost, Reliability

**Status:** Draft v0 — targets to be validated during Phase 1 build
**Date:** 2026-04-19
**Owner:** J
**Related:** PRD v2 §6, §8; MCP specs (llm / adobe / orchestrator)

---

## Why this doc exists

Performance, cost, and reliability are design decisions, not refactor targets. Capturing quantified NFRs before we build gives us a yardstick for spec review, implementation choices, and any future tech-debt audit. Without these, "optimize for performance" means nothing.

This doc defines NFRs for **v0 (Revlon demo)** and forward-looking targets for **v1 (multi-tenant scale)**. v0 targets are load-bearing — they gate demo sign-off. v1 targets are directional — they inform architecture choices but aren't v0 pass/fail.

---

## 1. Latency SLOs (per-call)

All targets are P95 under nominal load. P99 is informational. All measured end-to-end from MCP tool entry to tool return.

### 1.1 LLM MCP

| Tool | v0 target | v1 target | Notes |
|------|-----------|-----------|-------|
| `llm.generate_copy` (single block, 1 variant) | ≤ 8s P95 | ≤ 5s P95 | Claude Sonnet 4.6 typical latency + prompt assembly overhead |
| `llm.generate_copy` (single block, 3 variants) | ≤ 15s P95 | ≤ 10s P95 | v1 may parallelize variant generation |
| `llm.summarize` | ≤ 4s P95 | ≤ 3s P95 | Haiku 4.5 for cost — speed bonus |
| `llm.transform` | ≤ 6s P95 | ≤ 4s P95 | Depends on transformation complexity |

### 1.2 Adobe MCP

| Tool | v0 target | v1 target | Notes |
|------|-----------|-----------|-------|
| `workfront.create_task` | ≤ 3s P95 | ≤ 2s P95 | Single API call + template resolution |
| `workfront.update_status` | ≤ 1.5s P95 | ≤ 1s P95 | Simple field update |
| `workfront.add_comment` | ≤ 1.5s P95 | ≤ 1s P95 | Simple create |
| `workfront.subscribe_webhook` | ≤ 3s P95 | ≤ 2s P95 | One-time per brief or one-time at startup depending on subscription model |
| `eds.publish_preview` | ≤ 10s P95 | ≤ 6s P95 | DA.live write + preview build; dominated by build step |
| `eds.publish_live` | ≤ 10s P95 | ≤ 6s P95 | Promote operation; triple-gate adds no meaningful latency |
| `eds.get_config` | ≤ 1s P95 | ≤ 500ms P95 | Read-only, cacheable |

### 1.3 Orchestrator MCP

| Tool | v0 target | v1 target | Notes |
|------|-----------|-----------|-------|
| `orchestrator.submit_brief` | ≤ 500ms P95 | ≤ 300ms P95 | Sync work is validate + persist + emit; async processing follows |
| `orchestrator.status` | ≤ 200ms P95 | ≤ 100ms P95 | Single Postgres read, cacheable at app layer |
| `orchestrator.approve` (webhook handler) | ≤ 1s P95 | ≤ 500ms P95 | Signature verify + state transition + enqueue publish |
| `orchestrator.publish` | ≤ 12s P95 | ≤ 8s P95 | Delegates to `eds.publish_preview` — must stay close to that tool's budget |
| `orchestrator.cancel` | ≤ 2s P95 | ≤ 1s P95 | State transition + Workfront task cleanup |

---

## 2. End-to-end brief-duration targets

Business KPI. Measured from `orchestrator.submit_brief` returning to state = `done`. Excludes human review time (which is bounded by Workfront SLA and is not an engineering NFR).

### 2.1 Submit → under_review (automation only)

| Path | v0 target | v1 target | Notes |
|------|-----------|-----------|-------|
| Single page_target, 1 variant | ≤ 25s P95 | ≤ 15s P95 | validate + generate + workfront task create |
| Two page_targets (home + pdp), 1 variant each | ≤ 45s P95 | ≤ 20s P95 | v1 parallelizes generate across page_targets |

### 2.2 Approved → done (publish only)

| Path | v0 target | v1 target | Notes |
|------|-----------|-----------|-------|
| Preview publish | ≤ 15s P95 | ≤ 8s P95 | EDS publish + state transition + observability emit |
| Live publish (Revlon: gated off in v0) | ≤ 15s P95 | ≤ 8s P95 | Only gated behind triple-gate (§6.2); latency unchanged |

### 2.3 Total submit → done (excludes human review)

| Path | v0 target | v1 target |
|------|-----------|-----------|
| 1 page_target, 1 variant, auto-approved | ≤ 45s P95 | ≤ 25s P95 |
| 2 page_targets, 1 variant each, auto-approved | ≤ 65s P95 | ≤ 30s P95 |

---

## 3. Cost ceilings

Hard budget caps. Breach = code rejects the operation, emits alert, writes dead-letter record. These are not aspirational — they are enforced guardrails.

### 3.1 Per-brief cost

| Cost type | v0 cap | v1 cap | Enforcement |
|-----------|--------|--------|-------------|
| LLM cost (tokens × rate, all variants) | $1.00 | $0.75 | Hard cap in LLM MCP; reject call before send if projected cost > cap |
| Adobe API cost | Negligible (Workfront+EDS are included in ETLA, no per-call fee) | Same | N/A |
| Total brief cost | $1.00 | $0.75 | Dominated by LLM in v0 |

### 3.2 Daily aggregate cost

| Scope | v0 cap | v1 cap | Enforcement |
|-------|--------|--------|-------------|
| Dev environment sustained daily cost | $10/day | $25/day | Rolling-24h token counter; alert at 80%, reject at 100% |
| Single brand peak daily | $20/day | $50/day | Higher during demo bursts |
| Across all brands peak daily | $20/day (single-brand v0) | $200/day | Multi-tenant fairness enforced in v1 |

CC hard-pause condition for spec work is already set at $10/day default config — that aligns with this doc.

### 3.3 Firefly credits (deferred but tracked)

Firefly is deferred to v1.5. When it reactivates:
- Credit cap per brief: TBD with brand team (expected range: 20–50 generations per brief)
- Daily credit cap: 9000 per default Firefly tier, Revlon should stay well below 500/day

---

## 4. Throughput floor

Minimum sustained throughput the system must handle without queue backup or state corruption.

### 4.1 v0 targets

- **Sustained:** 10 briefs/hour, serial processing
- **Burst:** 20 briefs submitted in 10 minutes, processed serially, all complete within 60 minutes of last submit
- **Ceiling acknowledgement:** v0 is serial — any load above this triggers queue backup. Document the ceiling, don't hide it.

### 4.2 v1 targets

- **Sustained:** 100 briefs/hour with N parallel workers (N TBD by worker resource profile)
- **Burst:** 500 briefs submitted in 30 minutes, all complete within 2 hours
- **Multi-tenant fairness:** no single brand can starve another brand's throughput (weighted fair queueing)

---

## 5. Observability SLAs

Every signal visible in LGTM, under budget, with zero silent gaps.

### 5.1 Emission latency

| Signal | v0 target | v1 target |
|--------|-----------|-----------|
| Log line visible in Loki | ≤ 5s from emit | ≤ 2s |
| Trace span visible in Tempo | ≤ 10s from span close | ≤ 5s |
| Metric visible in Mimir | ≤ 30s from emit | ≤ 15s |
| Alert fires from Grafana rule | ≤ 2min from threshold breach | ≤ 1min |

### 5.2 Coverage

- 100% of MCP tool calls must emit a trace span. Zero exceptions.
- 100% of state transitions must log at INFO with structured JSON.
- 100% of errors must tag their error_class from the defined taxonomy.
- 100% of downstream API calls (Anthropic, Workfront, EDS) must have latency metrics.

### 5.3 Cost of observability

- Log volume: ≤ 500MB/day in v0, ≤ 5GB/day in v1
- Trace sample rate: 100% in v0 (low volume), 10% head sampling in v1 (ok to tail-sample errors at 100%)
- Metric cardinality: ≤ 10K active series in v0, ≤ 100K in v1 (cap on label combos to prevent explosion)

---

## 6. Reliability SLAs

### 6.1 Availability

| Service | v0 target | v1 target |
|---------|-----------|-----------|
| Orchestrator MCP | 99.0% monthly (demo-grade) | 99.9% monthly |
| LLM MCP | 99.0% monthly | 99.5% monthly (bounded by upstream Anthropic availability) |
| Adobe MCP | 99.0% monthly | 99.5% monthly (bounded by upstream Adobe availability) |
| Postgres | 99.5% monthly | 99.9% monthly |

### 6.2 Live publish safety — triple-gate (v0: all three gates disabled)

Live publish to production `aem.page` requires all three gates true:

1. **Environment flag** — `BLA_ALLOW_LIVE_PUBLISH=true` on the Adobe MCP host.
2. **Per-brief flag** — `briefs.allow_live_publish = true` in Postgres.
3. **Per-call input ack** — `confirm_live: true` explicit in the publish tool call input.

Any single gate missing → `LivePublishUnauthorizedError`, audited under `bla.audit=live_publish_denied` at WARN.

Gates are AND-composed. See `docs/mcp/adobe-mcp-spec.md` §8.5 for the enforcement reference implementation.

v0 default: all three gates disabled. Demo publishes to `<bla-demo>.aem.page` preview only (path `/{brand}/{brief_id}/{page_target}`), never production.

#### 6.2.1 Contract test — triple-gate

For each of the 7 gate-combinations where at least one gate is false:
call `orchestrator.publish` → expect `LivePublishUnauthorizedError`. Only the `(true, true, true)` case proceeds.

| Env flag | Brief flag | Call ack | Expected |
|---|---|---|---|
| false | false | false | reject |
| true  | false | false | reject |
| false | true  | false | reject |
| false | false | true  | reject |
| true  | true  | false | reject |
| true  | false | true  | reject |
| false | true  | true  | reject |
| true  | true  | true  | proceed |

#### 6.2.2 Other non-negotiable invariants

- **Webhook idempotency:** identical Workfront webhook delivered 100x must transition state at most once.
- **State machine:** zero silent state transitions; illegal transitions raise, log, alert.
- **Brief integrity:** once `orchestrator.submit_brief` returns a `brief_id`, the brief is durable (survives crash/restart).
- **Cost cap:** cost caps must fail-closed; if the tokens-remaining counter is unavailable, reject rather than default-allow.

### 6.3 Data durability

- All `briefs`, `brief_state_history`, `brief_artifacts` rows: durable on commit, backed up daily, recoverable to any point in last 30 days (v0); 90 days (v1)
- Postgres WAL archiving: always on
- Secret material (Infisical): dual-region replication in v1; single region acceptable in v0

---

## 7. Recovery targets (RTO / RPO)

### 7.1 v0 (demo-grade)

- **RTO (recovery time objective):** 4 hours for complete VPS rebuild from backup
- **RPO (recovery point objective):** 1 hour (hourly Postgres snapshot cadence)

### 7.2 v1 (multi-tenant production)

- **RTO:** 30 minutes
- **RPO:** 5 minutes (streaming WAL replication)

### 7.3 VPS bootstrap — time sync (M1)

VPS clock must stay within 60s of UTC for webhook replay defense (±10 min window, adobe-mcp §8.4) and for JCS-canonicalized event signatures that truncate milliseconds (orchestrator §8.4.1) to work correctly.

**Task #54 checklist addendum:**
- Install `chrony` on the VPS (`apt-get install chrony`).
- Enable + start `chronyd.service`; disable `systemd-timesyncd` to avoid conflicting time daemons.
- Pool: `pool 2.pool.ntp.org iburst` (default) is sufficient.

**Observability:**
- Metric `bla_clock_skew_ms` — emitted by a node exporter or a tiny bespoke script scraped every 60s, reports `chronyc tracking` "System time" delta in ms.
- Grafana alert: `bla_clock_skew_ms > 5000` for 5 min → page on-call.
- At 60s+ skew the ±10 min webhook window starts eating into the real envelope; 5s alert threshold gives operator time to react before replay defense misfires.

---

## 8. Security posture (NFR-adjacent, lives here for completeness)

- **Zero secrets in git.** Any commit containing an Anthropic key, Adobe client_secret, or Postgres password is a security incident requiring key rotation.
- **IMS tokens never logged.** Scope names ok, client_id ok, token value never.
- **Webhook signatures verified 100% of calls.** Unverified webhook = 401 + security alert.
- **Publish live is triple-gated + audit-logged.** Every live publish attempt logs env flag state, per-brief flag state, per-call ack state, and caller identity (see §6.2).
- **Brief content sanitization:** brief content may contain user-authored prose; LLM prompt injection defense via system-prompt structure + output validation. Never concatenate brief body directly into system prompt.

---

## 9. How these NFRs translate into spec review

Every MCP spec must answer these questions in its Observability and Error Handling sections:

1. What is the P95 latency budget for each tool?
2. What is the per-call cost (if any)?
3. Which errors are fatal vs retry-able?
4. What metrics cover the latency and error rate for each tool?
5. What is the fail-closed behavior when an upstream dependency is down?
6. What invariants are enforced on the happy path (e.g., triple-gate, §6.2)?
7. What dead-letter behavior exists for stuck briefs / failed publishes?

If a spec doesn't answer these, it's incomplete — regardless of whether it resolves every TODO.

---

## 10. Validation plan

NFRs are untested until we measure them. Validation happens in Phase 1 implementation:

1. **Unit-level:** each tool call wrapped in latency test assertion against the target table above
2. **Integration-level:** E2E test submits fixture brief, asserts end-to-end duration within 2.3 target
3. **Load-level:** throughput floor validated by scripted brief submission (see orchestrator-mcp-spec §10 load test)
4. **Chaos-level:** fail-closed semantics validated by dependency fault injection
5. **Observability self-test:** deploy a synthetic no-op brief every hour; alert if its telemetry doesn't land within the emission-latency budget

---

## 11. Known tensions / trade-offs

- **LLM latency vs variant count:** generating 3 variants sequentially is slow. v0 accepts the hit; v1 will parallelize.
- **Cost cap vs variant quality:** $1/brief cap may be tight if a brief needs many blocks with many variants. Monitor actual cost; revisit cap if demo briefs consistently hit it.
- **Observability coverage vs Loki cost:** 100% trace sampling is cheap at v0 volume, expensive at v1 volume. v1 transition to head-sampling must preserve error visibility.
- **Availability vs complexity:** 99.9% would require redundancy (multi-region Postgres, redundant VPS). v0 accepts 99.0% because demo-grade. Step-function upgrade to 99.9% happens at v1 multi-tenant milestone, not before.
- **Triple-gate vs developer velocity:** live publish triple-gate adds friction during testing. Mitigation: staging env with `BLA_ALLOW_LIVE_PUBLISH=true` by default, prod env with it `false` by default, never the reverse. Per-brief and per-call gates remain per-request regardless of env.

---

## 12. Revision cadence

- Review this doc at end of every phase (Phase 0, 1, 2, 3)
- Update targets when measured reality deviates ≥20% from target (update spec, not reality)
- Demote any target that cannot be achieved to `documented limitation` with tracking issue
