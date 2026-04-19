# Orchestrator MCP — Spec v0

**Status:** Outline — Claude Code to fill in technical detail
**Owner:** J
**Related:** PRD v2 §3.3, brief-schema-v0.md

---

## 1. Overview

**Purpose:** The moat. Workflow state machine that drives the brand launch flywheel from brief intake to published content. Coordinates LLM MCP + Adobe MCP. Owns the source of truth for every in-flight brief.

**Scope v0:**
- Brief intake + JSON Schema validation
- State machine: `received → validated → generating → under_review → approved → published → done`
- Calls LLM MCP for content generation
- Calls Adobe MCP (Workfront) to create review task
- Receives Workfront webhook on approval/rejection
- Calls Adobe MCP (EDS) to publish preview
- Persistence: Postgres on VPS
- Observability emit at every state transition

**Out of scope for v0:**
- Multi-stage approval (v0 supports single review step, v1 adds chain-of-n)
- Parallel brief processing (v0 serial, v1 parallel with dedicated workers)
- Human-in-the-loop content editing (v1 — Workfront attachments only in v0)
- Automatic rollback on publish failure (v0 manual, v1 automated)

---

## 2. Tool surface

### 2.1 `orchestrator.submit_brief`
- Input: brief YAML content (string) or brief object
- Output: `brief_id`, `state: "received"`, `ack_url`
- Behavior: validate against brief-schema-v0.json → persist → emit event → return immediately (async processing starts)
- Errors: validation failures returned synchronously with detail

### 2.2 `orchestrator.status`
- Input: `brief_id`
- Output: full state object — current state, history, artifacts produced (Workfront task URL, generated content preview, publish URL)
- Read-only, safe to poll

### 2.3 `orchestrator.approve` (webhook handler surface)
- Input: webhook payload from Workfront (via Adobe MCP subscription)
- Output: state transition confirmation
- Behavior: verify webhook signature → look up brief by Workfront task_id → transition state → trigger publish step
- Idempotent on duplicate webhooks

### 2.4 `orchestrator.publish`
- Input: `brief_id`, optional `publish_mode` (default: `preview`)
- Output: `publish_url`
- Behavior: call Adobe MCP `eds.publish_preview` (or `publish_live` if `publish_mode=live` AND brief allows)
- State transition: `approved → publishing → published → done`

### 2.5 `orchestrator.cancel` (v0 stretch)
- Input: `brief_id`, `reason`
- Output: state transition confirmation
- Behavior: allowed from any non-terminal state; cleans up Workfront task, emits cancellation event

---

## 3. State machine

```
received ─(validate)─► validated ─(generate)─► generating ─(submit review)─► under_review
                                                                                │
                  ┌──────────(webhook: approved)────────────────────────────────┤
                  │                                                             │
                  ▼                                                             ▼
              approved ─(publish)─► publishing ─► published ─► done      (webhook: rejected)
                                                                                │
                                                                                ▼
                                                                             rejected ─► done
```

**Transition rules:**
- Forward-only in happy path
- `rejected` is terminal — brief must be resubmitted as new `brief_id` for another attempt
- `cancel` permitted from: `received`, `validated`, `generating`, `under_review` — NOT after `approved` (once approved, must complete publish or manually roll back)
- Transitions persisted in Postgres `brief_state_history` table with timestamps and triggering actor

---

## 4. Persistence

### 4.1 Schema (Postgres)

```
briefs
  brief_id PK
  brand_id
  type
  locale
  raw_yaml (text)
  parsed_json (jsonb)
  state (enum)
  created_at
  updated_at

brief_state_history
  id PK
  brief_id FK
  from_state
  to_state
  actor (service | email)
  reason (text nullable)
  transitioned_at

brief_artifacts
  id PK
  brief_id FK
  artifact_type (enum: generated_copy | workfront_task | preview_url)
  artifact_data (jsonb)
  created_at
```

TODO: finalize schema, add indexes, decide on soft-delete vs hard-delete

### 4.2 Migrations
- Use `drizzle-kit` or `sqitch` (TODO: pick, Claude Code decides based on Turborepo conventions)
- Migration files versioned in `apps/orchestrator-mcp/migrations/`

---

## 5. External dependencies

- LLM MCP — for content generation
- Adobe MCP — for Workfront + EDS operations
- Postgres — persistence
- Webhook endpoint (public HTTPS) — receives Workfront events

---

## 6. Internal dependencies

- `packages/shared/schema-validator` — validates incoming briefs against brief-schema-v0.json
- `packages/shared/state-machine` — generic state machine helper (or use XState if already on stack)
- `packages/shared/webhook-verifier` — verifies Workfront webhook signatures
- `packages/shared/telemetry`

---

## 7. Observability

- Metric: `orchestrator_briefs_submitted_total`
- Metric: `orchestrator_state_transitions_total{from, to}`
- Metric: `orchestrator_brief_duration_seconds{terminal_state}` (histogram — time from submit to done)
- Metric: `orchestrator_webhook_received_total{verified}`
- Trace: span per brief, child spans per MCP call, tagged with `brief_id`
- Log: structured JSON, state transitions always logged at INFO

---

## 8. Error handling

- TODO: define retry policy per downstream call (LLM MCP, Adobe MCP)
- TODO: define dead-letter handling — briefs stuck in a non-terminal state > X hours need alerting
- TODO: webhook replay attack defense — timestamp + signature check
- TODO: brief validation failure UX — error detail structure returned to caller

---

## 9. Safety guardrails

- **Idempotency:** every tool call accepts optional `request_id`; duplicate request_ids return cached response
- **Concurrency:** brief state transitions use row-level locking; no two processes can transition the same brief simultaneously
- **Webhook auth:** verify Workfront webhook signature on every inbound event; unverified = 401 and log
- **Publish double-gate:** orchestrator never calls `eds.publish_live` unless brief has `allow_live_publish: true` AND env flag set; same gate as Adobe MCP, belt-and-braces
- **Brief content size cap:** reject briefs > 100KB YAML (configurable)
- **State machine invariants:** illegal transitions raise and log; never silently swallow

---

## 10. Testing strategy

- Unit: state machine transitions (every valid + every invalid), schema validator, webhook verifier
- Integration: mocked LLM MCP + Adobe MCP, verify orchestration flow through happy path + every failure branch
- Contract: brief-schema-v0.json compatibility tests
- E2E: with real LLM MCP + mocked Adobe MCP, submit fixture brief, assert final state
- Chaos: simulate LLM MCP timeout, Workfront 5xx, EDS 403 — confirm orchestrator handles gracefully
- Load: submit 100 briefs in 1 minute, assert no state corruption (serial processing in v0 = throughput ceiling)

---

## 11. Open questions

- Webhook endpoint hosting — orchestrator listens on public HTTPS at `<vps>.monks.dev/webhooks/workfront`? DNS + TLS handled how?
- Retry for failed publishes — auto-retry N times then alert? Or fail fast and require manual retry?
- State history retention — keep forever or age out after N days?
- Multi-tenant brief_id uniqueness — scope to brand_id or global uniqueness? v0 recommends global UUIDs to avoid collisions
- Locking strategy — Postgres row-level (`SELECT FOR UPDATE`) vs advisory locks vs app-layer Redis lock? v0 recommends row-level for simplicity
- Brief edit after submission — v0 says no (new brief_id required), v1 may allow edit before `under_review`
