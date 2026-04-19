# Orchestrator MCP — Spec v0

**Status:** v0 — ready to implement (task #62)
**Owner:** J
**Last updated:** 2026-04-19
**Related:** PRD v2 §3.3 + §6.3, `docs/NFR-PERFORMANCE-TARGETS-v0.md` §1.3 + §2 + §4 + §6, `docs/brief-schema-v0.md`, `docs/mcp/llm-mcp-spec.md`, `docs/mcp/adobe-mcp-spec.md`

---

## 1. Overview

**Purpose.** The moat. Workflow state machine that drives the brand launch flywheel from brief intake to published content. Coordinates the LLM MCP and Adobe MCP. Source of truth for every in-flight brief.

**Scope v0.**
- Brief intake + JSON Schema validation against `brief-schema-v0.json`.
- State machine: `received → validated → generating → under_review → approved → publishing → published → done` (plus `rejected`, `cancelled`, `failed` terminals).
- Calls LLM MCP to generate copy per `page_targets[]`.
- Calls Adobe MCP (Workfront) to create the review task.
- Receives Workfront webhook (mTLS) on approval/rejection.
- Calls Adobe MCP (EDS/DA.live) to publish preview on approval.
- Persistence: Postgres on VPS via Drizzle ORM.
- Observability emit on every state transition.

**Out of scope for v0.**
- Multi-stage approval chain (v0 supports single approver step; ordered chain is v1).
- Parallel brief processing (v0 serial; v1 parallel workers).
- Human-in-the-loop content editing inside orchestrator (v0 edits via Workfront attachments).
- Automatic rollback on publish failure (v0 manual; v1 automated).
- Publishing to live (gated off in v0 — spec covers the wiring only).

---

## 2. Tool surface

### 2.1 `orchestrator.submit_brief`

**Input:**
```ts
interface SubmitBriefInput {
  brief_content: string;             // full brief (YAML front-matter + markdown body) OR JSON
  content_type: "yaml-md" | "json";
  request_id?: string;               // idempotency
  submitter_email: string;           // audit trail; usually the `owner_email` in the brief
}

interface SubmitBriefOutput {
  brief_id: string;
  state: "received" | "validated";   // sync so far
  ack_url: string;                   // `orchestrator.status` poll URL
  validation?: {                     // if validation fails synchronously
    ok: false;
    errors: Array<{ path: string; message: string }>;
  };
}
```

Behavior:
1. Parse content per `content_type`.
2. Validate against `brief-schema-v0.json`. Failures return synchronously with detail (no persistence).
3. Persist brief with `state = received`, then transition to `validated`.
4. Enqueue async generation (transition to `generating` will happen on worker pickup).
5. Return `{ brief_id, state, ack_url }`.

### 2.2 `orchestrator.status`

**Input:** `{ brief_id: string }`
**Output:**
```ts
interface StatusOutput {
  brief_id: string;
  brand_id: string;
  state: StateEnum;
  created_at: string;
  updated_at: string;
  history: Array<{ from_state: StateEnum; to_state: StateEnum; actor: string; reason?: string; at: string }>;
  artifacts: {
    generated_copy?: Array<{ page_target: string; block_type: string; variants: object[] }>;
    workfront_task?: { task_id: string; workfront_url: string; assignees: string[] };
    preview_url?: string;
    live_url?: string;
    cost_usd_so_far: number;
  };
  terminal?: {
    outcome: "done" | "rejected" | "cancelled" | "failed";
    reason?: string;
  };
}
```

Read-only. Safe to poll at any interval (no rate limit on reads, but implementations should be considerate — 30-60s typical).

### 2.3 `orchestrator.approve` (webhook-triggered surface)

**Input (from Workfront webhook, not a user-facing tool call):**
```ts
interface WorkfrontWebhookPayload {
  objCode: "TASK";
  action: "UPDATE";
  new: { ID: string; status: string; approvalStatus?: string; /* ... */ };
  old: { status: string; /* ... */ };
  eventTime: string;
  // plus HTTP context: mTLS client cert, optional authToken
}
```

#### 2.3.1 `status` vs `approvalStatus` — read only one of these for decisions

Workfront approval-workflow events carry **two distinct fields that are not synonyms**. Conflating them is the most likely bug in webhook handling — spelled out here so no implementer misses it:

| Field | Values | Semantic | Read for approvals? |
|---|---|---|---|
| `status` | `NEW` \| `INP` \| `CPL` \| `DLY` | Task lifecycle (new, in progress, complete, delayed) | **NO — observability only.** |
| `approvalStatus` | `PND` \| `APV` \| `REJ` | Approval decision (pending, approved, rejected) | **YES — approve/reject branch.** |

**The orchestrator reads `approvalStatus` only.** `status` is captured in `webhook_events.raw_payload` for observability but does not drive state transitions.

**Failure mode this rule prevents:** an assignee without approval authority marks the task `CPL` (complete) without the approval chain resolving. If the orchestrator matched on `status == "CPL"`, that would spuriously trigger publish. Matching on `approvalStatus == "APV"` means only the approver, completing their step of the approval workflow, can advance the brief.

**Legacy-payload guard:** some older Workfront webhook formats emit only `status` (no `approvalStatus`). Those events are logged at WARN (`bla.warn=workfront_legacy_payload`) and treated as no-op. If they ever recur in v0, flag to J — may indicate a subscription misconfiguration.

Behavior:
1. Verify mTLS client cert against the registered subscription (Adobe MCP §8.4). Fail = 401.
2. Verify `authToken` header if present (belt-and-suspenders).
3. Parse payload. Look up brief by `brief_artifacts.artifact_data.task_id`.
4. Interpret `approvalStatus` transition (see §2.3.1):
   - `APV` → transition brief `under_review → approved`, trigger publish step (§2.4).
   - `REJ` → transition `under_review → rejected`, emit event, terminal.
   - `PND` or absent → log, no state change (keeps legacy-payload handling explicit).
   - Other updates (comment added, assignee changed) → log, no state change.
5. Idempotent: if a duplicate webhook arrives (same `eventTime` + same `new.ID`), return 200 without re-transitioning.
6. Return HTTP 200 within **5 seconds** (Workfront deadline per Adobe MCP §4.1).

#### 2.3.2 Webhook fixtures

Shipped under `tests/fixtures/workfront-webhooks/` and used by the integration tests (§10.2):

| Fixture | `status` | `approvalStatus` | Expected behavior |
|---|---|---|---|
| `task-approved.json` | `CPL` | `APV` | trigger publish |
| `task-rejected.json` | `CPL` | `REJ` | trigger reject |
| `task-pending.json` | `INP` | `PND` | no-op |
| `task-complete-no-approval.json` | `CPL` | null/absent | no-op (the critical safety test) |
| `task-legacy.json` | `CPL` (no `approvalStatus` field present) | — | no-op + WARN log |

### 2.4 `orchestrator.publish`

**Input:**
```ts
interface PublishInput {
  brief_id: string;
  publish_mode?: "preview" | "live";  // default "preview"
  request_id?: string;
}

interface PublishOutput {
  publish_url: string;
  state: "publishing" | "published";
  published_at: string;
}
```

Behavior:
1. Pre-check: brief state must be `approved`. Otherwise `IllegalTransitionError`.
2. If `publish_mode === "live"`, verify **triple-gate** (see §9):
   - Env flag `BLA_ALLOW_LIVE_PUBLISH=true` on orchestrator process.
   - Brief carries `allow_live_publish: true`.
   - Caller `request_id` is in an allowlist (orchestrator-level ack) — optional v0, ships in v1 if needed.
   - Any failure → `LivePublishUnauthorizedError`.
3. Transition `approved → publishing`.
4. For each `page_target`:
   - Call `da.update_source` with the approved copy payload.
   - Call `eds.publish_preview` (or `eds.publish_live` after triple-gate).
5. Collect URLs into `brief_artifacts`.
6. Transition `publishing → published → done`.

Idempotent: re-entry after partial failure resumes from the last successful page_target.

### 2.5 `orchestrator.cancel` (v0 stretch — include)

**Input:** `{ brief_id: string; reason: string; actor_email: string; request_id?: string; }`
**Output:** `{ brief_id, state: "cancelled", cancelled_at }`

Behavior:
- Allowed from: `received`, `validated`, `generating`, `under_review`. Rejected from `approved`, `publishing`, `published`, `done`, `rejected`, `cancelled`, `failed`.
- If cancelling from `under_review`: also call `workfront.update_status` with `REJECTED` + the cancel reason as a comment, so the Workfront task closes cleanly.
- Emits `brief.cancelled` event.

---

## 3. State machine

```
          ┌──────────(validation ok)──────────┐
received ─┤                                   │
          └──(validation fail)──► failed      ▼
                                          validated
                                              │
                                       (enqueue → worker picks up)
                                              │
                                              ▼
                                         generating
                                              │
                              ┌───(LLM error + non-retryable)───► failed
                              ▼
                     (submit Workfront task)
                              │
                              ▼
                        under_review
                              │
        ┌─────(webhook: approved)──────┴──────(webhook: rejected)─────┐
        ▼                                                              ▼
    approved                                                        rejected ──► done (terminal)
        │
   (publish)
        │
        ▼
   publishing
        │
        ├──(all page_targets ok)──► published ──► done (terminal)
        │
        └──(partial/full fail after retries exhausted)──► failed (terminal)

cancel transitions (from any non-terminal, non-approved state):
  received | validated | generating | under_review  ──► cancelled ──► done (terminal)
```

**Transition rules:**
- Forward-only in the happy path. No skipping states.
- Terminals: `done` (reached after `published`, `rejected`, or `cancelled`), `failed`.
- `rejected` is terminal — new brief_id required to retry.
- `cancel` allowed up to `under_review`. After `approved`, publish must complete or be manually rolled back (v0 = manual; v1 automates).
- Illegal transitions raise `IllegalTransitionError`, log at ERROR, emit `orchestrator.illegal_transition_total` metric — never silently swallow.
- Every transition persisted in `brief_state_history` with actor + reason + timestamp.

---

## 4. Persistence

Postgres 16+ on the VPS. Drizzle ORM (v1+) + `drizzle-kit` for migrations. Drizzle chosen over Prisma per research recommendation — lighter, SQL-shaped, no code-gen step, first-class TypeScript.

Source: [Drizzle vs Prisma](https://www.bytebase.com/blog/drizzle-vs-prisma/).

### 4.1 Schema (authoritative — v0)

```sql
-- Enums
CREATE TYPE brief_state AS ENUM (
  'received', 'validated', 'generating', 'under_review',
  'approved', 'publishing', 'published',
  'done', 'rejected', 'cancelled', 'failed'
);

CREATE TYPE artifact_type AS ENUM (
  'generated_copy', 'workfront_task', 'preview_url', 'live_url', 'cost_ledger'
);

-- briefs — the source of truth
CREATE TABLE briefs (
  brief_id           TEXT PRIMARY KEY,              -- human-readable: BLA-2026-Q2-REVLON-001
  brand_id           TEXT NOT NULL,
  type               TEXT NOT NULL,                 -- 'product-launch' | 'campaign' | 'refresh'
  locale             TEXT NOT NULL DEFAULT 'en-US',
  owner_email        TEXT NOT NULL,
  page_targets       JSONB NOT NULL,                -- array of enums
  approval_chain     JSONB NOT NULL,                -- array of emails
  allow_live_publish BOOLEAN NOT NULL DEFAULT FALSE,
  raw_content        TEXT NOT NULL,                 -- original YAML+MD or JSON
  parsed_json        JSONB NOT NULL,                -- validated against brief-schema-v0.json
  state              brief_state NOT NULL DEFAULT 'received',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  version            INTEGER NOT NULL DEFAULT 1,    -- optimistic locking; bump on each row update
  parent_brief_id    TEXT REFERENCES briefs(brief_id) -- links rejected-then-resubmitted briefs
);

CREATE INDEX idx_briefs_state ON briefs(state) WHERE state NOT IN ('done', 'failed');
CREATE INDEX idx_briefs_brand ON briefs(brand_id, created_at DESC);

-- brief_state_history — audit trail for every transition
CREATE TABLE brief_state_history (
  id               BIGSERIAL PRIMARY KEY,
  brief_id         TEXT NOT NULL REFERENCES briefs(brief_id) ON DELETE CASCADE,
  from_state       brief_state NOT NULL,
  to_state         brief_state NOT NULL,
  actor            TEXT NOT NULL,                   -- 'orchestrator' | 'webhook:workfront' | email
  reason           TEXT,
  transitioned_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_history_brief ON brief_state_history(brief_id, transitioned_at);

-- brief_artifacts — outputs of each stage (generated copy, Workfront task, URLs)
CREATE TABLE brief_artifacts (
  id               BIGSERIAL PRIMARY KEY,
  brief_id         TEXT NOT NULL REFERENCES briefs(brief_id) ON DELETE CASCADE,
  artifact_type    artifact_type NOT NULL,
  artifact_data    JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_artifacts_brief ON brief_artifacts(brief_id, artifact_type);

-- webhook_events — idempotency + audit for inbound Workfront events
CREATE TABLE webhook_events (
  id               BIGSERIAL PRIMARY KEY,
  source           TEXT NOT NULL,                   -- 'workfront'
  event_signature  CHAR(64) NOT NULL,               -- SHA-256 hex, lowercase, per §8.4.1 JCS formula
  brief_id         TEXT REFERENCES briefs(brief_id),
  payload          JSONB NOT NULL,
  mtls_verified    BOOLEAN NOT NULL,
  processed        BOOLEAN NOT NULL DEFAULT FALSE,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, event_signature)
);

-- idempotency_keys — dedupe on request_id for tool calls
CREATE TABLE idempotency_keys (
  request_id       TEXT PRIMARY KEY,
  brief_id         TEXT REFERENCES briefs(brief_id),
  tool_name        TEXT NOT NULL,
  response_json    JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL              -- now() + 10 min default
);

CREATE INDEX idx_idempotency_expiry ON idempotency_keys(expires_at);
```

### 4.2 Migrations

- Tool: **`drizzle-kit`** (`drizzle-kit generate` produces SQL diffs; `drizzle-kit migrate` applies). Chosen over sqitch per Turborepo TS-native convention. Schema file: `packages/db/src/schema.ts`.
- Migrations live in `apps/orchestrator-mcp/drizzle/` (follows Drizzle convention).
- Forward-only migrations in v0 — no down scripts. Backups before every prod migration.

Source: [Drizzle Kit](https://orm.drizzle.team/kit-docs/overview).

### 4.3 Soft-delete vs hard-delete

**Soft-delete on `briefs`** (add `deleted_at TIMESTAMPTZ`) reserved for v1 when we need audit retention. v0: hard delete via `DELETE FROM briefs WHERE brief_id = $1` with cascade to history + artifacts. Recover from backups if needed.

### 4.4 Retention policy

- **`briefs`:** no automatic deletion; GDPR/PII requests handled ad-hoc (v0 has no PII beyond `owner_email` + approver emails).
- **`brief_state_history`:** kept for life of the brief.
- **`webhook_events`:** 90-day rolling window (delete rows where `received_at < now() - interval '90 days'`). Scheduled nightly.
- **`idempotency_keys`:** hourly sweep deleting rows past `expires_at`.

---

## 5. External dependencies

| Dependency | Used for | Failure mode |
|---|---|---|
| **LLM MCP** | Content generation (`llm.generate_copy`, `llm.summarize`, `llm.transform`) | Errors propagated per LLM MCP §7.4 contract; retryable flag honored |
| **Adobe MCP** | Workfront task CRUD + subscribe, EDS publish, DA.live source write | Errors propagated per Adobe MCP §7.1 contract |
| **Postgres 16+** | Persistence (briefs, history, artifacts, webhooks, idempotency) | Required; circuit-breaker on connection pool |
| **Webhook ingress (public HTTPS)** | Receive Workfront events over mTLS | Must expose client cert to app |

### 5.1 Webhook endpoint hosting

- v0: `https://orchestrator.bla-demo.monks.dev/webhooks/workfront`
- DNS: J owns `monks.dev` delegation; `bla-demo` subdomain created for this.
- TLS: Let's Encrypt via `certbot` on the VPS (renewed automatically). Serves app cert.
- **mTLS**: Workfront presents a client cert. v0 implementation: `node:https` server with `requestCert: true` + `rejectUnauthorized: false`, validate cert chain + CN in-app (Adobe MCP §8.4 pattern). v1 if we move behind a managed LB: nginx with `proxy_ssl_verify_client on` forwarding peer cert headers.

### 5.2 Priority contract rules

- Orchestrator **never** swallows an LLM MCP error silently (LLM MCP §7.4).
- Orchestrator **is the authority** on the `allow_live_publish` brief flag (Adobe MCP §8.5 assumes orchestrator validates this upstream).
- Orchestrator's `publish` call to Adobe MCP always passes `confirm_live: true` ONLY after verifying its own local gates; otherwise passes `false` (which will then fail the Adobe MCP gate deliberately).

---

## 6. Internal dependencies

| Package | Purpose |
|---|---|
| `packages/shared/schema-validator` | JSON Schema validation against `brief-schema-v0.json`. Uses `ajv`. |
| `packages/shared/state-machine` | Declarative state machine — table-driven transitions. Lightweight, no XState dep needed in v0. |
| `packages/shared/webhook-verifier` | mTLS peer-cert validation + optional `authToken` check. |
| `packages/db` | Drizzle schema, migrations, typed queries. |
| `packages/shared/telemetry` | OTLP emitter (shared with LLM MCP and Adobe MCP). |
| `packages/shared/errors` | `OrchestratorMcpError` hierarchy (§8.1). |
| `packages/shared/idempotency` | Idempotency-key cache with Postgres-backed persistence. |
| `packages/shared/cost-ledger` | Per-brief cost accumulation; enforces per-brief cap from LLM MCP §8.3. |

---

## 7. Observability

OTLP to Grafana Alloy → Mimir/Tempo/Loki. Same pattern as other MCPs.

### 7.0 Latency SLOs (per NFR §1.3 + §2)

**Per-tool:**

| Tool | v0 P95 | v1 P95 |
|---|---|---|
| `orchestrator.submit_brief` | ≤ 500ms | ≤ 300ms |
| `orchestrator.status` | ≤ 200ms | ≤ 100ms |
| `orchestrator.approve` (webhook handler) | ≤ 1s (of which mTLS + DB write + 200 return ≤ 5s is the Workfront-imposed deadline) | ≤ 500ms |
| `orchestrator.publish` | ≤ 12s | ≤ 8s |
| `orchestrator.cancel` | ≤ 2s | ≤ 1s |

**End-to-end (brief duration):**

| Path | v0 P95 | v1 P95 |
|---|---|---|
| Submit → `under_review` (1 page_target, 1 variant) | ≤ 25s | ≤ 15s |
| Submit → `under_review` (2 page_targets, 1 variant each) | ≤ 45s | ≤ 20s |
| Approved → `done` (preview publish) | ≤ 15s | ≤ 8s |
| Submit → `done` excluding human review (1 target, 1 variant) | ≤ 45s | ≤ 25s |
| Submit → `done` excluding human review (2 targets) | ≤ 65s | ≤ 30s |

**Throughput (NFR §4):**
- v0 sustained: **10 briefs/hour, serial processing.**
- v0 burst: 20 briefs in 10 minutes, processed serially, all complete within 60 minutes of last submit.
- Ceiling acknowledgment: v0 is serial — load above this triggers queue backup. The `orchestrator_stuck_briefs_gauge` alert will fire if queue depth creates stuck briefs.

Measured via `orchestrator_*_latency_seconds` and `orchestrator_brief_duration_seconds` histograms. Grafana alerts on 5-min P95 breach.


### 7.1 Metrics

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `orchestrator_briefs_submitted_total` | counter | `brand_id`, `type`, `outcome_intent` | `outcome_intent ∈ {accepted, validation_failed}` at intake |
| `orchestrator_state_transitions_total` | counter | `from`, `to`, `brand_id` | Every transition. Cardinality bounded. |
| `orchestrator_brief_duration_seconds` | histogram | `terminal_state`, `brand_id` | Time from `received` to terminal. Buckets: `60, 300, 900, 3600, 14400, 86400` |
| `orchestrator_webhook_received_total` | counter | `source`, `verified`, `processed` | `source ∈ {workfront}` |
| `orchestrator_illegal_transition_total` | counter | `from`, `attempted_to` | Alerts on any > 0 |
| `orchestrator_llm_calls_total` | counter | `tool`, `status` | Mirror LLM MCP; `status ∈ {ok, retried, failed}` |
| `orchestrator_adobe_calls_total` | counter | `service`, `tool`, `status` | Mirror Adobe MCP |
| `orchestrator_stuck_briefs_gauge` | gauge | `state` | Emitted by a periodic watcher — briefs in non-terminal state > SLA threshold |
| `orchestrator_cost_usd_per_brief` | histogram | `brand_id`, `terminal_state` | Buckets: `0.10, 0.25, 0.50, 1.00, 2.00, 5.00` |
| `orchestrator_idempotency_hits_total` | counter | `tool` | Replayed responses |
| `orchestrator_db_query_seconds` | histogram | `operation` | `operation ∈ {read_brief, write_state, append_history, idempotency_lookup}` |

### 7.2 Traces

Trace-per-brief pattern. A single trace_id follows the brief from `submit_brief` through terminal state.

Root span attributes:
- `bla.brief_id`, `bla.brand_id`, `bla.brief_type`
- `bla.state_final` — set on completion

Child spans (spans-of-interest):
- `orchestrator.validate` — schema validation
- `orchestrator.generate` — fan-out to LLM MCP, span-per-block-type
- `orchestrator.submit_review` — Workfront task creation
- `orchestrator.receive_webhook` — inbound event (separate trace, linked via `bla.brief_id` attribute)
- `orchestrator.publish` — span-per-page-target
- `db.query` — short-lived Postgres spans

### 7.3 Logs

Structured JSON, stdout. Labels: `service: "bla-orchestrator-mcp"`, `env`, `level`.

**Always at INFO:** every state transition, every tool call entry/exit (with brief_id + state).

**DEBUG only:** prompt/response bodies, full webhook payload.

**Redact:** tokens, client secrets, email addresses of approvers at INFO+ (hash to `sha256:<8>`).

### 7.4 Alerts

Grafana alerts configured in JSON dashboard exports (committed to repo under `apps/orchestrator-mcp/dashboards/`):

- **Stuck brief:** `orchestrator_stuck_briefs_gauge > 0` for 1h — page J.
- **Illegal transition:** any `orchestrator_illegal_transition_total` increase — page J.
- **Webhook verify fail:** `orchestrator_webhook_received_total{verified="false"}` > 3/min — security alert.
- **Live publish attempt:** any `orchestrator_adobe_calls_total{tool="publish_live"}` increase — informational alert.
- **Cost ceiling:** `sum(orchestrator_cost_usd_per_brief_sum) > 10/day` — hard pause on new briefs, page J.

---

## 8. Error handling

### 8.1 Error class hierarchy

```ts
class OrchestratorMcpError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly brief_id?: string;
  readonly state?: string;
  readonly details?: unknown;
}

class BriefValidationError extends OrchestratorMcpError    { retryable = false; }
class BriefNotFoundError extends OrchestratorMcpError      { retryable = false; }
class IllegalTransitionError extends OrchestratorMcpError  { retryable = false; }
class LlmUpstreamError extends OrchestratorMcpError        { /* wraps LlmMcpError */ }
class AdobeUpstreamError extends OrchestratorMcpError      { /* wraps AdobeMcpError */ }
class WebhookVerifyFailError extends OrchestratorMcpError  { retryable = false; }
class IdempotencyReplay extends OrchestratorMcpError       { /* not really error — cached response */ }
class LivePublishUnauthorizedError extends OrchestratorMcpError    { retryable = false; }
class ConcurrencyConflictError extends OrchestratorMcpError{ retryable = true;  } // optimistic lock
class CostCapExceededError extends OrchestratorMcpError    { retryable = false; }
class DeadLetterError extends OrchestratorMcpError         { retryable = false; } // brief stuck past SLA
```

Upstream errors wrap the underlying `LlmMcpError` / `AdobeMcpError` preserving `code`, `retryable`, and `details`.

### 8.2 Retry policy (downstream calls)

**LLM MCP calls:**
- If `LlmMcpError.retryable === true`: exp. backoff base 2s, factor 2, max 30s, max 3 attempts, deadline 2 minutes.
- If `!retryable`: classify into `failed` terminal state.
- `SafetyRejectError` specifically: transition to `failed`, notify via Workfront comment on the (future) task.

**Adobe MCP calls:**
- If `AdobeMcpError.retryable === true`: honor the underlying service's retry headers (Adobe MCP already retries internally; orchestrator retries only on timeouts).
- If `!retryable`: classify into `failed` terminal state. Exception: `LivePublishUnauthorizedError` is operator error, log + return 403.

**Workfront webhook delivery receipt:**
- We have at most **5 seconds** to return 2xx. Our handler:
  1. Verifies mTLS (fast — CPU only).
  2. Writes a row to `webhook_events` with `processed=false`.
  3. Returns 200.
  4. Async worker picks up the row and does state transitions.
- If DB write fails within 5s: return 500, Workfront retries (11 times over ~48h per Adobe MCP §4.1).

### 8.3 Dead-letter handling

A watcher runs every 5 minutes:
- Query briefs where `state NOT IN ('done','failed','rejected','cancelled','published')` AND `updated_at < now() - SLA_THRESHOLD`.
- SLA thresholds (v0, tunable via env):
  - `generating`: 10 minutes
  - `under_review`: 72 hours (humans are the long pole)
  - `publishing`: 15 minutes
- Any match → `orchestrator_stuck_briefs_gauge` per state, log at WARN, emit `DeadLetterError` event for alerting. v0 alerts only — no automatic recovery.

### 8.4 Webhook replay-attack defense

Idempotency via `webhook_events.event_signature` (unique constraint on `(source, event_signature)`).

#### 8.4.1 Event signature formula (authoritative)

```
event_signature = SHA-256(canonical_json_jcs({
  source:             string,   // "workfront" | "eds" | "manual"
  event_id:           string,   // provider-issued (Workfront: event.new.ID; EDS: x-cdn-request-id; manual: UUID)
  event_time_utc_iso: string,   // ISO-8601 Z, milliseconds TRUNCATED (not rounded)
  entity_id:          string    // brief_id, or if not yet bound, the Workfront task_id
}))
```

**Rules (invariants verified by property test in §10.1):**

- **Canonicalization:** RFC 8785 JSON Canonicalization Scheme (JCS). Produces a single bytewise-canonical serialization for any JSON object, independent of key order, whitespace, or optional-field presence.
- **Hash:** SHA-256, output as **lowercase hex, 64 chars**.
- **Storage:** `webhook_events.event_signature CHAR(64) UNIQUE NOT NULL`.
- **Timestamp format:** `event_time_utc_iso` is ISO-8601 in UTC with trailing `Z`, milliseconds **truncated** (not rounded). Example: `2026-04-19T14:07:23Z` — never `.234Z`, never `+00:00`. This matters because Workfront sometimes emits `2026-04-19T14:07:23.234+00:00` on retries of the same event; truncation collapses those to the same signature so dedup still fires.
- **Missing optional field:** if `event_id` is absent on some EDS payloads, synthesize as `source + ':' + entity_id + ':' + event_time_utc_iso` so signatures remain deterministic. Document the synthesis path in the signature implementation's comment.

#### 8.4.2 Replay defenses layered on top

- **Duplicate signature within 48h** → 200 with `X-Duplicate: true` response-shape field; no state change. (48h matches Workfront's retry window per Adobe MCP §4.1.)
- **`event_time_utc_iso` older than 10 minutes** vs receiver `now()` → reject (suspected replay; Workfront normally delivers within seconds). See Adobe MCP §8.4 for the ±10 min window rationale.
- **`event_time_utc_iso` more than 10 minutes in the future** → reject (suspected clock skew attack or misconfig).
- **mTLS cert mismatch** → 401 + audit log + metric.

#### 8.4.3 Clock-skew note

`event_time_utc_iso` in the signature is the **provider's claimed time**, not the receiver's. Receiver uses the ±10 min window as a replay defense but the signature uses provider time as-is. Receiver clocks kept within 60s of UTC via NTP (VPS bootstrap, see NFR §7). Metric `bla_clock_skew_ms` alerts at >5s.

#### 8.4.4 Property-based test (fast-check)

```ts
it('event_signature is invariant under key order, whitespace, and optional field presence', () => {
  fc.assert(fc.property(arbitraryEvent, (event) => {
    const permutations = permuteEventSerialization(event);
    // permuteEventSerialization yields: key-reordered, whitespace-inserted,
    // null-vs-absent-optional-fields, ms-trailing-zeros variants.
    const signatures = permutations.map(eventSignature);
    expect(new Set(signatures).size).toBe(1);
  }));
});
```

The property holds because JCS canonicalization is the serialization step; any bytewise-equivalent JSON collapses to a single canonical form before hashing.

### 8.5 Brief validation failure UX

Returned synchronously from `submit_brief`. Structure:
```ts
{
  ok: false,
  errors: [
    { path: "/approval_chain/0", message: "Invalid email format" },
    { path: "/timeline/publish_by", message: "Required when type=product-launch" },
  ]
}
```

Human-readable. Paths use JSON Pointer (RFC 6901). Consumer UIs can render field-level errors next to inputs.

---

## 9. Safety guardrails

### 9.1 Idempotency

Every tool call accepts `request_id`. Storage: `idempotency_keys` table, 10-minute default TTL.
- Lookup on call entry: if present, return cached `response_json` with `X-Replayed: true`.
- Store on successful completion (not on error — errors retry freely).
- Scope: global (not per brief).

### 9.2 Concurrency

State transitions use **optimistic locking** on `briefs.version`:
```sql
UPDATE briefs SET state = $new_state, version = version + 1, updated_at = now()
WHERE brief_id = $1 AND version = $2;
```
If `rowCount === 0`: raise `ConcurrencyConflictError`, retry up to 3 times with random jitter (50–500ms). After 3: bubble up.

Alternative considered: row-level `SELECT FOR UPDATE`. Rejected for v0 — optimistic is simpler, fewer lock-contention bugs at low write volume. Revisit if write volume grows (v1).

### 9.3 Webhook auth

- mTLS peer-cert validation — subject CN must match the expected value registered with `workfront.subscribe_event` (Adobe MCP §2.1).
- Optional `authToken` header checked if Workfront presents it.
- Unverified → 401 + `webhook_events.mtls_verified = false` + metric + WARN log.
- Never process an unverified event.

### 9.4 Publish triple-gate (restated)

Live publish requires **ALL three** to be true — orchestrator owns gate #3 (brief flag):

| # | Gate | Owner | Check location |
|---|---|---|---|
| 1 | Env flag `BLA_ALLOW_LIVE_PUBLISH=true` | Adobe MCP process | Adobe MCP startup + per-call |
| 2 | Input `confirm_live: true` | Orchestrator caller | Adobe MCP per-call |
| 3 | Brief `allow_live_publish: true` | Orchestrator (this spec) | Orchestrator `publish` per-call |

Orchestrator's `publish` tool:
- Reads `briefs.allow_live_publish` (the brief's stored value from parsed_json).
- If `publish_mode === "live"` AND NOT `allow_live_publish` → `LivePublishUnauthorizedError`, no Adobe call.
- Passes `confirm_live` to Adobe MCP ONLY when our gate is green.

### 9.5 Brief content size cap

`submit_brief.brief_content` rejected if > 100 KB (configurable via `BLA_MAX_BRIEF_SIZE_KB`). Prevents accidental large-payload DoS.

### 9.6 State-machine invariants

- Illegal transitions always raise — never silently swallowed.
- Every transition appends to `brief_state_history` in the same DB transaction as the `briefs.state` update (atomicity).
- Version bump on every `briefs` update (optimistic lock enforced by DB).

### 9.7 Cost cap enforcement

Orchestrator tracks cumulative cost for each brief in a `cost_ledger` artifact (`brief_artifacts.artifact_type = 'cost_ledger'`). Before each LLM MCP call:
1. Read cumulative cost.
2. If `cumulative + estimated_call_cost > $1.00 USD` → `CostCapExceededError` → transition to `failed`.
3. After call, append actual cost to the ledger.

Daily org-wide cap ($10 USD/day) enforced at a separate periodic-sweep level, pausing new brief acceptance when breached.

---

## 10. Testing strategy

### 10.1 Unit tests
- `state-machine`: every valid transition, every illegal transition, every `cancel` from every state.
- `schema-validator`: every brief-schema-v0.json rule (required fields, enums, format constraints).
- `webhook-verifier`: valid cert, expired cert, wrong CN, missing cert, old `eventTime`.
- `idempotency`: cache hit returns replayed response; cache miss calls through; expiry purges rows.
- `cost-ledger`: accumulation, cap triggering, cumulative read-after-write consistency.

### 10.2 Integration tests
- Mocked LLM MCP + Adobe MCP. Verify orchestration flow through:
  - **Happy path:** submit → validate → generate → submit_review → approved webhook → publish → done.
  - **Validation failure:** submit with missing required field → synchronous 400.
  - **LLM retryable error → eventual success.**
  - **LLM non-retryable error → failed state.**
  - **Adobe 429 → orchestrator waits → eventual success.**
  - **Workfront webhook: approved.**
  - **Workfront webhook: rejected.**
  - **Duplicate webhook: second call noop.**
  - **Cancel from every cancellable state.**
  - **Illegal cancel from approved/publishing/etc.**

### 10.3 Contract tests
- Against `brief-schema-v0.json` — the schema IS the contract.
- Against LLM MCP's tool output shape (should match the `GenerateCopyOutput` interface).
- Against Adobe MCP's tool output shapes.

### 10.4 E2E tests (gated — real LLM MCP, mocked Adobe MCP)
- Fixture briefs (Revlon pilot, campaign-type, refresh-type).
- Submit → wait for `generating → under_review`.
- Assert generated artifacts conform to voice.json.
- Budget cap: `BLA_E2E_ORCH_MAX_SPEND_USD=3.00`.

### 10.5 Chaos tests
- LLM MCP timeout → orchestrator retries → succeeds.
- Workfront 5xx on `create_task` → orchestrator retries → succeeds.
- EDS 403 on `publish_preview` (unexpected) → orchestrator handles → failed state.
- Postgres connection drop → orchestrator pauses new work, resumes on reconnect.
- Two simultaneous webhooks for same brief (race) → idempotency kicks in, one is no-op.

### 10.6 Load tests
- Submit 100 briefs in 1 minute. Assert:
  - No state corruption (version monotonic per brief).
  - No brief stuck.
  - Serial processing in v0 = throughput ceiling ~1 brief/2min end-to-end (LLM dominates). v0 acceptable.

### 10.7 State-machine property tests
- Property: "every reachable state has at least one exit path to a terminal."
- Property: "no path produces two entries in `brief_state_history` with the same timestamp for the same brief."
- Use `fast-check` for property-based testing.

---

## 11. Resolved decisions

| Question | v0 decision | Rationale |
|---|---|---|
| Webhook endpoint hosting | `https://orchestrator.bla-demo.monks.dev/webhooks/workfront` on the VPS, Let's Encrypt TLS, in-app mTLS validation | J owns monks.dev; VPS-local kills a moving part. nginx-mTLS is v1 if we ever move behind a managed LB. |
| Retry for failed publishes | **Auto-retry with Adobe MCP policy (5 attempts, deadline 45s).** On exhaust → `failed` state, alert. No auto-retry of whole publish step — operator re-invokes `orchestrator.publish` manually. | Automated retry of partial publish is risky (idempotent-but-not-trivial). v1 adds auto-retry with safer step boundaries. |
| State history retention | **Kept forever for `brief_state_history`** (bounded by brief count). 90-day rolling for `webhook_events`. | History is small, valuable, low-cost. Webhook log is the chatty one. |
| Multi-tenant brief_id uniqueness | **Global unique.** Format: `BLA-<year>-<quarter>-<brand>-<seq>` per `brief-schema-v0.md`. UUIDs rejected — human-readable + sortable + greppable wins for ops. | Earlier outline mentioned "global UUID"; this is the resolved answer. Matches the format in the schema and in every example brief. |
| Resubmitted-brief linking | `briefs.parent_brief_id TEXT NULL` column added in v0 schema (below). Populated when a rejected brief is resubmitted as a new ID. Enables analytics ("rework rate per brand") without breaking terminal-state guarantee. | Adversarial review surfaced this gap — without a link, we can't trace rework. |
| Locking strategy | **Postgres optimistic locking on `briefs.version`.** `SELECT FOR UPDATE` row-locks rejected for v0 (simpler optimistic, fewer deadlocks at our write volume). | Optimistic wins when conflicts rare (one brief ≈ one writer). Revisit if we go concurrent. |
| Brief edit after submission | **No edits in v0.** New brief_id required. v1 may allow edit before `under_review`. | Edits at scale complicate history + webhook payloads. Defer. |
| Migration tool | **drizzle-kit** over sqitch | TS-native, Drizzle-integrated, one fewer tool. |
| ORM choice | **Drizzle** over Prisma | Lighter, SQL-shaped, better for agentic TS; Prisma's tooling advantage doesn't outweigh for this scope. |
| State-machine lib | **Declarative table-driven**, no XState in v0 | XState is overkill for 11-state FSM; table driven is ~100 LOC and fully typed. |

---

## 12. Known gaps / deferred

- **Multi-stage approval chain.** Brief schema supports ordered `approval_chain` array; v0 processes only the first approver. Orchestrator routes to first, on approval triggers publish. v1 iterates through chain.
- **Parallel brief processing.** v0 serial = 1 brief at a time → throughput ceiling ~30 briefs/hour assuming 2-min LLM phase. Fine for Revlon pilot. v1 adds a BullMQ or Postgres-advisory-lock-based worker pool.
- **Human-in-the-loop editing in-orchestrator.** v0 edits happen by attaching new content to the Workfront task. Approvers upload revised copy, orchestrator on approval uses attachment content (NOT original LLM output). v1 may surface an edit UI directly.
- **Auto-rollback on publish failure.** v0 manual — if `publishing → failed`, J or operator clears manually. v1 adds `orchestrator.rollback` tool that calls `eds.unpublish` (already in Adobe MCP roadmap).
- **Cancel from `approved`.** v0 rejects. v1 may allow with a confirmation + rollback.
- **Dead-letter auto-recovery.** v0 alerts only. v1 can auto-retry `generating` stuck briefs with a different model, or escalate `under_review` by re-notifying approver.
- **Webhook ingress resilience.** v0 single-VPS — if VPS is down, Workfront retries for 48h (acceptable). v1 adds a queue-based ingress (SQS, NATS, or Redis Streams) if we scale out.
- **Multi-tenant auth.** v0 has no authentication on orchestrator tool calls — they originate from inside the VPS from trusted callers (Cowork scripts, CLI). v1 adds OAuth 2.1 + PKCE per MCP spec 2025-11-25 when we expose the orchestrator over the internet. Source: [MCP spec](https://modelcontextprotocol.io/specification/2025-11-25).
- **Cost cap precision.** Cumulative cost in the `cost_ledger` artifact is approximate — there's a window between an LLM call starting and the ledger write where concurrent calls may both pass the pre-check. v0 tolerable given serial processing; v1 with parallel briefs needs a proper reservation pattern.
- **Public orchestrator surface.** If we ever expose `orchestrator.submit_brief` over HTTPS publicly (e.g. a brief intake webhook from a brief-authoring UI), we MUST implement OAuth 2.1 + PKCE per MCP spec 2025-11-25 AND move webhook mTLS into an nginx layer. Neither happens in v0 — the MCP is internal-only.

---

## Sources

- [MCP spec 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)
- [Drizzle ORM docs](https://orm.drizzle.team/)
- [Drizzle Kit migrations](https://orm.drizzle.team/kit-docs/overview)
- [Drizzle vs Prisma — Bytebase](https://www.bytebase.com/blog/drizzle-vs-prisma/)
- [Turborepo configuration](https://turbo.build/repo/docs/reference/configuration)
- [Workfront Event Subscriptions](https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-api/event-subscriptions/event-sub-retries)
- [Workfront mTLS client certs](https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-api/api-notes/event-sub-certs)
- [Grafana Alloy OTLP → LGTM](https://grafana.com/docs/alloy/latest/collect/opentelemetry-to-lgtm-stack/)
- [OTel trace semantic conventions](https://opentelemetry.io/docs/specs/semconv/general/trace/)
- [JSON Pointer (RFC 6901)](https://datatracker.ietf.org/doc/html/rfc6901)
- [fast-check property-based testing](https://github.com/dubzzz/fast-check)
