# Spec Revision Brief — Post-Adversarial-Review

**Date:** 2026-04-19
**Audience:** Claude Code (implements), J (approves merge)
**Source:** `docs/spec-review-findings-2026-04-19.md`
**Decisions approved by J:** C1, C2, C3, H1, H7 (v0), H10 (v0) — plus pre-Phase-1 blockers and early-Phase-1 must-haves below.
**Approval state:** Cowork (J) has reviewed findings and approved this revision scope in full. CC is authorized to execute all Tranche 1 and Tranche 2 edits without further approval.

---

## Execution order

Execute in three tranches. Each tranche ends with a green commit on `main` and a short progress note appended to this file as a `## Tranche N complete` section. Do NOT skip ahead — later tranches depend on earlier signatures.

---

## Tranche 1 — CRITICAL + H1 language alignment (target: same-day turnaround)

### Patch 1.1 — C1 — Prompt-cache padding made model-aware (CORRECTED 2026-04-19)

**File:** `docs/mcp/llm-mcp-spec.md`
**Sections:** §5.2 "Prompt caching", §9 "Cost model"

**Correction note (2026-04-19):** An earlier version of this patch said "replace 2048 with 1024 on Sonnet 4.6" and "keep Haiku 4.5 at 2048." That was based on a memory-reconstructed adversarial finding and was **wrong in the direction of correction**. Re-verified against `platform.claude.com/docs/en/build-with-claude/prompt-caching` on 2026-04-19:

- **Sonnet 4.6 minimum: 2048 tokens** (unchanged from original spec)
- **Haiku 4.5 minimum: 4096 tokens** (unchanged from original spec)
- **Opus 4.5 / 4.6 / 4.7 minimum: 4096 tokens**

The original spec numbers are correct. The substantive C1 fix is still needed: **the padding logic that pads unconditionally to 2048 is wrong for Haiku (under-pads) and wasteful for cases where input already exceeds the minimum.** Fix is to make padding model-aware.

Add the lookup table to §5.2:

```typescript
const MODEL_CACHE_MIN: Record<ModelId, number> = {
  'claude-opus-4-7':   4096,
  'claude-opus-4-6':   4096,
  'claude-sonnet-4-6': 2048,
  'claude-haiku-4-5':  4096,
};
```

Rewrite the padding logic section:
- Before: unconditional pad-to-2048.
- After: `const cacheMin = MODEL_CACHE_MIN[model]; if (estimatedInputTokens < cacheMin) { applyPadding(cacheMin - estimatedInputTokens); } else { skipPadding(); }`

Document source of truth with a footnote: "Anthropic prompt-caching minimums verified 2026-04-19 against `platform.claude.com/docs/en/build-with-claude/prompt-caching`. Re-verify at each major model release."

Add unit-test spec to §5.2 — one test per model at its real boundary:

```
Test: prompt-cache-boundary (per model)
Sonnet 4.6:  tokens ∈ {2047, 2048, 2049}
  Expect  2047 → padded to 2048, cache_create emitted
          2048 → no padding, cache_create emitted
          2049 → no padding, cache_read emitted on 2nd call
Haiku 4.5:   tokens ∈ {4095, 4096, 4097}
  Expect  4095 → padded to 4096, cache_create emitted
          4096 → no padding, cache_create emitted
          4097 → no padding, cache_read emitted on 2nd call
Opus 4.7:    tokens ∈ {4095, 4096, 4097}
  Expect same pattern as Haiku 4.5
```

**§9 cost table:** Sonnet 4.6 lines are a no-op (original 2048 numbers were correct). Haiku 4.5 lines need recompute — original unconditional pad-to-2048 under-padded Haiku, so actual caching behavior on Haiku under the original code was "nothing cached, full input cost." The corrected model-aware padding to 4096 will cache Haiku calls that previously didn't — show this cost delta in the commit message.

### Patch 1.2 — C2 — Opus 4.7 thinking gate

**File:** `docs/mcp/llm-mcp-spec.md`
**Section:** §4.1 `GenerateCopyInput.reasoning_budget`

Replace the Opus escalation shape. Add a dispatcher:

```typescript
function buildThinkingBlock(model: ModelId, budgetTokens?: number) {
  if (model === 'claude-opus-4-7') return undefined; // Opus 4.7 = adaptive only
  if (!budgetTokens) return undefined;
  return { type: 'enabled' as const, budget_tokens: budgetTokens };
}
```

Document:
- Opus 4.7 → adaptive thinking only, no `budget_tokens` parameter. Quality tuning happens via prompt framing, not API.
- Sonnet 4.6 + Haiku 4.5 → `thinking.type = 'enabled'` with `budget_tokens` accepted.

**Before applying:** re-verify against `platform.claude.com/docs/en/build-with-claude/extended-thinking`. Opus 4.7 may also accept an `effort` parameter (low/medium/high/max) and a `task-budgets-2026-03-13` beta header. If quality knob on Opus is needed, prefer the `effort` parameter over returning undefined. If Phase 1 doesn't need the knob, the conservative dispatcher (return undefined for Opus) ships fine. Record the decision inline with a citation to the doc version consulted.

Add contract test per model asserting the request body shape the provider will accept. If Anthropic SDK ≥ the relevant version exposes this as a type error, prefer that approach and note the SDK version requirement.

### Patch 1.3 — C3 — PRD v2 auth rewrite

**File:** `docs/PRD-BLA-FLYWHEEL-CONNECTORS-v2.md`
**Sections:** §2 "Adobe entitlements", §3.1 "Adobe MCP", §8 "LOE re-estimate"

Replace the "unified Adobe IMS S2S OAuth" framing with the three-auth-store reality:

```
### Auth — three stores, one discipline

The Adobe MCP authenticates to three distinct auth stores:

1. **Workfront** — Adobe IMS OAuth Server-to-Server (client credentials).
   Infisical path: /bla/dev/adobe/workfront/{client_id, client_secret}.
   Scope: openid,AdobeID,profile,additional_info.projectedProductContext (comma-separated).

2. **Edge Delivery Services** — admin API keys (non-IMS), scoped per site.
   Infisical path: /bla/dev/adobe/eds/admin-api-key.
   Namespace: bla-demo site only (isolation hard rule).

3. **DA.live** — Adobe IMS user-backed token (on behalf of a technical user).
   Infisical path: /bla/dev/adobe/da-live/{access_token, refresh_token, user_email}.
   Scope: [pending H4 resolution — see docs/spec-review-findings-2026-04-19.md §H4]

What is unified is not the auth protocol but the **discipline**: one Infisical layout,
one credential-rotation policy (90-day rotation), one monitoring stream
(`bla.auth.tokens` metric with per-store labels), one error hierarchy
(`AuthError` base class with per-store subclasses).

Source of truth for the auth contracts: `docs/mcp/adobe-mcp-spec.md` §3.3–3.5.
```

Rewrite §8 LOE compression driver:
- Before: "2 MCPs instead of 4, unified Adobe auth"
- After: "2 MCPs instead of 4, disciplined auth isolation (3 auth stores, 1 rotation policy, 1 Infisical layout)"
- LOE numeric estimate stays as-is — the driver prose was wrong but the estimate was still ballpark.

Commit this as revision r3 in the document header (currently r2 per `## 0. Sequencing pivot`).

### Patch 1.4 — H1 — Triple-gate language alignment

**Files:**
- `docs/NFR-PERFORMANCE-TARGETS-v0.md` §6.2
- `docs/mcp/adobe-mcp-spec.md` §6.3 (already triple-gate — verify + cross-ref)
- `docs/mcp/orchestrator-mcp-spec.md` §9 (publish trigger — verify)

Edit NFR §6.2 to describe triple-gate explicitly:

```
### 6.2 Live publish safety — triple-gate (v0: all three gates disabled)

Live publish to production `aem.page` requires all three gates true:

1. **Environment flag** — `BLA_ALLOW_LIVE_PUBLISH=true` on the Adobe MCP host.
2. **Per-brief flag** — `briefs.allow_live_publish = true` in Postgres.
3. **Per-call input ack** — `confirm_live: true` explicit in the publish tool call input.

Any single gate missing → `LivePublishUnauthorizedError`, audited under
`bla.audit=live_publish_denied` at WARN.

Gates are AND-composed. See `docs/mcp/adobe-mcp-spec.md` §6.3 for the enforcement
reference implementation.

v0 default: all three gates disabled. Demo publishes to `<bla-demo>.aem.page`
preview only (path `/{brand}/{brief_id}/{page_target}`), never production.
```

Add a new §6.2.1 "Contract test — triple-gate":
```
For each of the 7 gate-combinations where at least one gate is false:
call orchestrator.publish → expect LivePublishUnauthorizedError.
Only the (true, true, true) case proceeds.
```

### Tranche 1 acceptance
- [x] Patch 1.1 merged — `596443f` — MODEL_CACHE_MIN dispatcher; boundary test spec per model
- [x] Patch 1.2 merged — `fc0552d` — reasoning dispatcher; Opus 4.7 uses adaptive+effort (no budget_tokens)
- [x] Patch 1.3 merged — `cb1a67c` — PRD v2 r3: three-auth-store rewrite
- [x] Patch 1.4 merged — `05ab53c` — NFR/adobe-mcp/orchestrator say "triple-gate"; env/input/error names harmonized
- [x] Append `## Tranche 1 complete` to this file

## Tranche 1 complete — 05ab53c 2026-04-19

Closed: C1, C2, C3, H1. Four commits, one per patch, pushed to main. All CRITICAL findings resolved. Proceeding to Tranche 2 without approval pause per J's directive.

---

## Tranche 2 — Pre-Phase-1 blockers (target: 1 day)

### Patch 2.1 — H2 — Workfront `status` vs `approvalStatus` disambiguation

**File:** `docs/mcp/orchestrator-mcp-spec.md` §2.3 (webhook ingestion) + §8.4 (approval detection)

Rewrite §2.3 webhook field handling:

```
Workfront approval events carry two distinct fields that are NOT synonyms:

- `status` (task lifecycle): NEW | INP | CPL | DLY — irrelevant for approval decisions.
- `approvalStatus` (approval decision): PND | APV | REJ — read this for approve/reject branch.

The orchestrator reads `approvalStatus` only. `status` is captured in
`webhook_events.raw_payload` for observability but does not drive state transitions.

Failure mode this prevents: assignee marks task CPL without approval authority
→ orchestrator incorrectly interprets as "approved" → triggers publish.
```

Add a fixture set under `tests/fixtures/workfront-webhooks/`:
- `task-approved.json` — approvalStatus=APV, status=CPL → trigger publish
- `task-rejected.json` — approvalStatus=REJ, status=CPL → trigger reject
- `task-pending.json` — approvalStatus=PND, status=INP → no-op
- `task-complete-no-approval.json` — approvalStatus=null, status=CPL → no-op
- `task-legacy.json` — only `status` present (legacy webhook payload) → no-op with WARN log

### Patch 2.2 — H3 — Event signature canonicalization

**File:** `docs/mcp/orchestrator-mcp-spec.md` §2.3

Pin the signature formula explicitly:

```
event_signature = SHA-256(canonical_json_jcs({
  source: string,              // "workfront" | "eds" | "manual"
  event_id: string,            // provider-issued
  event_time_utc_iso: string,  // ISO-8601 Z, milliseconds TRUNCATED (not rounded)
  entity_id: string            // e.g. brief_id
}))

Canonicalization: RFC 8785 JSON Canonicalization Scheme (JCS).
Hash output: lowercase hex, 64 chars.
Storage: webhook_events.event_signature CHAR(64) UNIQUE.
```

Add property-based test (`fast-check`):
```typescript
it('event_signature is invariant under key order, whitespace, and optional field presence', () => {
  fc.assert(fc.property(arbitraryEvent, (event) => {
    const permutations = permuteEventSerialization(event);
    const signatures = permutations.map(eventSignature);
    expect(new Set(signatures).size).toBe(1);
  }));
});
```

Clock-skew note: `event_time_utc_iso` is the provider's claimed time, NOT the receiver's. Receiver validates `|provider_time - receiver_now| ≤ 10 min` (spec §M1) as a replay defense but the signature uses provider time as-is.

### Patch 2.3 — H4 — DA.live scope resolution

**Owner:** Cowork (J pings Adobe contact). Spec block until resolved.

In `docs/mcp/adobe-mcp-spec.md` §3.4, replace "TBC" with a placeholder that fails fast on startup:

```
DA.live OAuth scope: [PENDING — see docs/da-live-scope-query-2026-04-19.md]

Startup behavior until resolved:
- If Infisical path /bla/dev/adobe/da-live/scope is unset AND env BLA_DA_LIVE_ENABLED=true
  → Adobe MCP refuses to boot with clear error: "DA.live scope unresolved; see §3.4"
- If BLA_DA_LIVE_ENABLED=false → Adobe MCP boots with DA.live module disabled;
  orchestrator degrades gracefully to pre-placed-asset mode for Revlon demo.
```

Parallel task: J sends the DA.live scope query (see `docs/da-live-scope-query-2026-04-19.md`, separate artifact).

### Patch 2.4 — H8 — voice.json schema pinning

**File:** create `packages/shared/schemas/voice-schema.json` (JSON Schema draft 2020-12)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://bla.monks.dev/schemas/voice-v1.json",
  "type": "object",
  "required": ["version", "brands"],
  "properties": {
    "version": { "type": "string", "pattern": "^1\\." },
    "brands": {
      "type": "object",
      "additionalProperties": { "$ref": "#/$defs/brand" }
    }
  },
  "$defs": {
    "brand": {
      "type": "object",
      "required": ["tone", "emphasis_scale", "banned_terms"],
      "properties": {
        "tone": {
          "type": "object",
          "required": ["primary", "secondary"],
          "properties": {
            "primary": { "type": "string" },
            "secondary": { "type": "array", "items": { "type": "string" } }
          }
        },
        "emphasis_scale": {
          "type": "object",
          "required": ["confidence", "energy", "warmth"],
          "properties": {
            "confidence": { "type": "integer", "minimum": 1, "maximum": 5 },
            "energy": { "type": "integer", "minimum": 1, "maximum": 5 },
            "warmth": { "type": "integer", "minimum": 1, "maximum": 5 }
          }
        },
        "banned_terms": { "type": "array", "items": { "type": "string" } },
        "preferred_vocabulary": { "type": "object", "additionalProperties": { "type": "string" } },
        "prohibited_claims": { "type": "array", "items": { "type": "string" } }
      }
    }
  }
}
```

Update `docs/mcp/llm-mcp-spec.md` §6:
- Reference the schema path.
- On MCP startup: validate `voice.json` against schema. If invalid, fail-fast with the validator error path + expected type.
- Validation uses `ajv@8` with `strict: true`.

Update task #79 description: voice.json v0 must validate against this schema before the Revlon demo.

### Tranche 2 acceptance
- [x] Patch 2.1 merged — `db9713d` — §2.3.1 rule + fixture set (5 fixtures incl. complete-no-approval safety test)
- [x] Patch 2.2 merged — `b8e44ac` — SHA-256 over RFC 8785 JCS, CHAR(64), ms-truncated ISO-8601, property test
- [x] Patch 2.3 merged — `c28022c` — fail-fast startup matrix (BLA_DA_LIVE_ENABLED × Infisical scope)
- [x] Patch 2.4 merged — `e4954ba` — voice-schema.json ships; Revlon voice.json validates; §8.5 fail-fast semantics

## Tranche 2 complete — e4954ba 2026-04-19

Closed: H2, H3, H4 (placeholder — scope still pending J's Adobe ping), H8. Four commits, one per patch. All pre-Phase-1 blockers cleared.

Per J's directive, stopping before Tranche 3. Resolution appendix added to `docs/spec-review-findings-2026-04-19.md`. Awaiting Phase 1 kickoff signal (task #55 Turborepo scaffold) before starting Patches 3.1-3.5.

---

## Tranche 3 — Early Phase 1 must-haves (target: first sprint of Phase 1)

### Patch 3.1 — H5 — Cost-ledger race defense

**File:** `docs/mcp/llm-mcp-spec.md` §8

Replace the "serial assumption acceptable" prose with a row-lock pattern:

```
Cost cap enforcement uses SELECT ... FOR UPDATE on cost_ledger per brief_id:

BEGIN;
SELECT spent_cents FROM cost_ledger WHERE brief_id = $1 FOR UPDATE;
-- In application: estimate cost of this call; reject if spent + estimated > cap
UPDATE cost_ledger SET spent_cents = spent_cents + $estimated WHERE brief_id = $1;
COMMIT;

-- Then dispatch to Anthropic; reconcile actual cost in a second tx.

Parallel calls on the same brief serialize at the row-lock boundary.
Per-brief cap is enforced exactly. Daily sustained cap (see §8.3) uses the
same pattern on the daily_cost_ledger row keyed by UTC date.
```

Add race test: fire 5 parallel `generate_copy` calls at 95% of $1.00 cap → assert total spend ≤ $1.05 (5% slop for in-flight estimation error) and ≥4 of 5 return `CostCapExceededError`.

### Patch 3.2 — H6 — Webhook fast-ack split

**File:** `docs/mcp/orchestrator-mcp-spec.md` §2.3

Replace single-handler flow with two-stage:

```
Stage 1 — fast-ack (target P99 < 2s):
  1. Verify mTLS client cert (~5ms).
  2. Verify Workfront authToken header (~1ms).
  3. Insert into webhook_events with event_signature unique constraint
     (fail-open on duplicate: treat as successfully acked).
  4. Return HTTP 200 to Workfront.

Stage 2 — async consumer (LISTEN/NOTIFY on webhook_events insert):
  1. Pick up new webhook_events row.
  2. Resolve brief_id from entity_id.
  3. Apply state transition (approve / reject / cancel).
  4. Trigger downstream publish / notify.
  5. On failure: move to dead-letter with retry schedule.

SLO: Stage 1 P99 < 2s (Workfront 5s budget − 3s headroom).
Alert: Workfront webhook retry count > 0 on any event_id → SLO breach investigation.
```

### Patch 3.3 — H7 — Publish kill switch + per-brand gate + audit

**File:** `docs/mcp/adobe-mcp-spec.md` §6.3, add §6.3.1 and §6.3.2

```
### 6.3.1 Emergency kill switch

`system_flags` table row `live_publish_kill=true` overrides ALL other gates
and blocks every live-publish call fail-closed. Checked on every publish call.
Kill switch read failure (DB down) → fail-closed (treat as kill=true).

### 6.3.2 Per-brand allow list (4th gate)

`brands.live_publish_allowed BOOLEAN NOT NULL DEFAULT false`.
Checked as gate 4: even if triple-gate green, a brand with
live_publish_allowed=false cannot live-publish.

Default: false. Flipping requires manual DB write (audit-logged to
bla.audit=brand_live_publish_flipped).
```

**File:** `docs/mcp/orchestrator-mcp-spec.md` §3 (schema)

Add audit trigger on `briefs.allow_live_publish` and `brands.live_publish_allowed`:
```sql
CREATE TABLE audit_log_publish_flags (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  old_value BOOLEAN,
  new_value BOOLEAN,
  actor TEXT NOT NULL,       -- from SET LOCAL session.actor
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION audit_publish_flag_change() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_log_publish_flags
    (table_name, entity_id, old_value, new_value, actor)
  VALUES (TG_TABLE_NAME, NEW.brief_id, OLD.allow_live_publish, NEW.allow_live_publish,
          COALESCE(current_setting('session.actor', true), 'unknown'));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

Application code sets `SET LOCAL session.actor = '<email>';` on every transaction that writes to these tables.

### Patch 3.4 — H9 — Transition classification

**File:** `docs/mcp/orchestrator-mcp-spec.md` §5.2 (state transitions)

Classify each transition:

```
CRITICAL transitions (must succeed, use SELECT ... FOR UPDATE):
  received → validated      (rejection point for malformed briefs)
  validated → generating    (spend authorization)
  under_review → approved   (approval gate)
  approved → publishing     (publish authorization)
  publishing → published    (state commit after successful publish)
  * → failed                (poison state lock)
  * → cancelled             (operator cancel)

OBSERVATIONAL transitions (best-effort, optimistic lock 3x retry OK):
  brief_state_history append
  cost_ledger append (already row-locked per H5 — observational append here
                      only for audit duplicate)
  metrics/log emission
```

Add metric `bla_optimistic_lock_retries_exhausted_total` with Prometheus alert `>0 for 5m`.

### Patch 3.5 — H10 — Retry tool + failed-state recovery

**File:** `docs/mcp/orchestrator-mcp-spec.md` §4 (tools), §5.1 (state machine)

Add new tool:
```typescript
interface RetryBriefInput {
  brief_id: string;
  actor: string;           // email/identity of operator
  reason: string;          // free text, stored in audit log
  reset_to_state?: 'received' | 'validated' | 'generating';  // default: 'received'
}

interface RetryBriefOutput {
  brief_id: string;
  new_state: 'received' | 'validated' | 'generating';
  previous_state: 'failed';
  version_after: number;
}
```

Add state machine transitions:
- `failed → received` (gated on `retry_brief` call with `reset_to_state='received'`)
- `failed → validated` (gated on `retry_brief` call with `reset_to_state='validated'`)
- `failed → generating` (gated on `retry_brief` call with `reset_to_state='generating'`)

Add runbook entry: `docs/runbooks/failed-brief-recovery.md` — when to use each reset target, common root causes.

### Cheap MEDIUMs to fold into Tranche 3

- **M1** NTP: add `chrony` to VPS bootstrap script (task #54); add metric `bla_clock_skew_ms` with alert at >5s.
- **M2** Subscription idempotency: `workfront.subscribe_event` uses deterministic subscription name `bla-orchestrator-<env>-<version>` and checks existing before creating.
- **M4** Daily cost-cap boundary: ledger entries timestamped at request-start; cap check uses the UTC date the request started in.
- **M8** Infisical path validator: `packages/shared/infisical-path-validator.ts` with unit tests asserting no underscores, only `[a-z0-9-/]`.

### Tranche 3 acceptance
- [ ] Patch 3.1 merged — race test shows cap enforcement under parallel load
- [ ] Patch 3.2 merged — webhook P99 ack latency under 2s in load test
- [ ] Patch 3.3 merged — kill switch + per-brand gate + audit log operational
- [ ] Patch 3.4 merged — critical transitions use row lock; metric + alert live
- [ ] Patch 3.5 merged — retry_brief tool + runbook shipped
- [ ] Cheap MEDIUMs folded in
- [ ] Append `## Tranche 3 complete` to this file

---

## Deferred to v1 (explicitly out of this revision)

- M3 Drizzle vs Prisma re-justification (noted, not blocking)
- M5 duplicate of H10
- M6 two-tier DLQ alerting (warn at any, page at rate)
- M7 webhook rate-shed at 100 QPS (not needed at pilot volume)
- M9 Alloy config pin (documentation tidy, not critical)
- M10 refresh brief type handling (remove from enum in v0 or document in v1)
- N1–N5 docs hygiene (next doc-sweep session)

---

## Definition of "revision complete"

CC posts a summary commit referencing this brief. All three Tranche `acceptance` checkboxes are ticked. `docs/spec-review-findings-2026-04-19.md` gains a `## Resolution` appendix mapping each CRITICAL/HIGH finding → commit SHA that closed it. Only then does Phase 1 coding (#55 Turborepo scaffold, #57 Adobe MCP, #58 LLM MCP, #62 Orchestrator) commence.

---

*End of revision brief.*
