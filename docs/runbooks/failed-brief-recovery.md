# Runbook — Failed Brief Recovery

**When to use:** a brief is in state `failed` and needs to be brought back into the flywheel.
**Tool:** `orchestrator.retry_brief` (see `docs/mcp/orchestrator-mcp-spec.md` §2.6).
**Audience:** on-call operator, J.

---

## 1. Decide whether to retry at all

Check the brief's failure reason first. `orchestrator.status $brief_id` returns the last `brief_state_history` row with `to_state = failed` — its `reason` column is the single best signal.

| Failure reason pattern | Retry? | Action |
|---|---|---|
| `ledger_lock_timeout` | **Yes** | Transient DB contention. Retry with `reset_to_state=generating`. |
| `llm_rate_limit_exhausted` after 5 retries | **Yes** | Transient upstream. Wait ≥15 min, retry with `reset_to_state=generating`. |
| `SafetyRejectError` (banned/never term after regenerate) | **No — rewrite brief** | The brief's content cannot produce safe copy. Escalate to brand; retry needs a revised brief content, not a state reset. Submit a new `brief_id` with `parent_brief_id` pointing to the failed one. |
| `brief_schema_invalid` (voice.json changed mid-brief) | **Yes** | Fix voice.json first. Retry with `reset_to_state=received` so the new schema gets revalidated. |
| `workfront_5xx` after Adobe MCP retries | **Yes** | Transient. Retry with `reset_to_state=generating` if generate succeeded but submit_review failed; `received` if no artifacts yet. |
| `eds_publish_503` | **No from retry_brief** | The brief is already `approved`/`publishing` when this happens. Use `orchestrator.publish` directly (not `retry_brief`, which only transitions out of `failed`). |
| Dead-letter watcher (stuck in `generating` > 10 min) | **Yes** | Check LLM MCP health first; if fine, retry with `reset_to_state=generating`. |
| Dead-letter watcher (stuck in `publishing` > 15 min) | Case-by-case | Check EDS status; may need manual rollback + `orchestrator.publish` retry. Do NOT use `retry_brief`. |
| `CostCapExceededError` | **Case-by-case** | If brief legitimately needs more headroom, either raise `BLA_LLM_PER_BRIEF_CAP_USD` and retry, or break the brief into multiple smaller briefs. Do not silently retry — the cap caught something real. |

---

## 2. Pick `reset_to_state`

Default is `received`. Use one of the other two when you can skip steps safely:

- **`received`** (default) — full re-run. Schema revalidated (catches voice.json drift), generate runs, submit_review fires. Safest. Slowest.
- **`validated`** — skip schema revalidation. Use when you are certain voice.json and brief content are both still valid but upstream (LLM or Workfront) had a transient problem.
- **`generating`** — skip straight to regenerate. Use only for LLM-layer transient failures (`ledger_lock_timeout`, `llm_rate_limit_exhausted`, LLM MCP pod restart). Do NOT use if schema or brief content changed — you'll regenerate against stale assumptions.

---

## 3. Invoke the retry

```
orchestrator.retry_brief
  brief_id: BLA-2026-Q2-REVLON-001
  actor: operator@monks.com
  reason: "LLM MCP rate-limit exhausted at 14:07 UTC; Anthropic status page shows incident resolved 14:18"
  reset_to_state: generating        # or received / validated
```

**Constraints:**
- Brief must currently be in `failed` state. Any other state → `IllegalTransitionError`.
- `reason` must be ≥ 10 chars — forces you to document the call. `"retry"` is not a valid reason.
- `actor` is logged to `brief_state_history.actor` and mirrored to `bla.audit=brief_retry` in Loki.

---

## 4. After invoking

- Poll `orchestrator.status $brief_id` every 30s until state reaches `under_review` (or `failed` again).
- If it hits `failed` again with the same reason: **stop**. Don't loop. File an incident and escalate.
- If it hits `failed` with a different reason: treat as a new failure, repeat §1–§3.
- If it reaches `under_review`: normal flywheel resumes — Workfront task notifies approver.

---

## 5. Bulk retries

When a platform-wide incident (Anthropic outage, DB failover) leaves many briefs in `failed`, don't loop `retry_brief` manually:

```sql
-- Find all briefs that failed between $t1 and $t2 with matching reason
SELECT b.brief_id, h.reason, h.transitioned_at
  FROM briefs b
  JOIN brief_state_history h ON h.brief_id = b.brief_id
 WHERE b.state = 'failed'
   AND h.to_state = 'failed'
   AND h.transitioned_at BETWEEN $t1 AND $t2
   AND h.reason LIKE 'llm_rate_limit_exhausted%'
 ORDER BY h.transitioned_at;
```

Then script the `retry_brief` calls with 1s spacing between them (don't thunder-herd the LLM MCP). Include the incident ticket ID in the `reason`.

---

## 6. When retry is the wrong answer

Retry is for transients. If you find yourself retrying the same brief > 2 times, the failure is not transient. Options:

1. **Bad brief content.** Submit a new brief_id with fixes, link via `parent_brief_id`. Do NOT retry — the same content will fail again.
2. **Downstream service degraded.** Pause new briefs (flip `system_flags.new_briefs_accepted=false` — TBD in v1.1) and wait for the upstream to recover. Then bulk-retry per §5.
3. **Cost cap cuts real work.** Raise the cap in config, document why in a commit.

---

## 7. Audit trail

Every `retry_brief` invocation lands in three places:

- `brief_state_history` row (`from_state=failed, to_state=<reset_to_state>, actor=<email>, reason=<text>`).
- `bla.audit=brief_retry` Loki log line at INFO.
- `orchestrator_brief_retries_total{reset_to_state, reason_class}` Mimir counter.

On-call review: weekly dashboard panel "retry_brief calls in last 7d" groups by `reason_class` to surface systemic failures worth fixing at the root.

---

*Related: `docs/mcp/orchestrator-mcp-spec.md` §2.6 (tool contract), §8.3 (dead-letter watcher), §9.2 (transition classification).*
