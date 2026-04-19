# Adversarial Spec Review — Brief

**Status:** Ready to execute once Claude Code completes the 3 MCP specs
**Date:** 2026-04-19
**Owner:** J
**Reviewer:** `adversarial-reviewer` subagent (Cowork) OR `cowork-optimizer:adversarial-reviewer` skill
**Related:** docs/mcp/*.md (post-completion), docs/NFR-PERFORMANCE-TARGETS-v0.md, PRD v2

---

## Mission

Find problems. Do not confirm correctness. Do not summarize. Do not praise. Your only deliverable is a punch list of specific, actionable gaps and failure modes the builder missed.

The three MCP specs (`docs/mcp/llm-mcp-spec.md`, `docs/mcp/adobe-mcp-spec.md`, `docs/mcp/orchestrator-mcp-spec.md`) have just been filled out by Claude Code. Your job is to break them on paper before anyone writes code against them.

---

## Ground rules

1. Every claim in the specs about an external API (Anthropic, Workfront, EDS, IMS, MCP spec) must be verified against the live official docs. Cite the URL. If the spec claims a scope string or endpoint and docs say something different, that's a finding.
2. Builder bias is assumed. Claude Code wrote these specs; treat every self-assessment as suspect until independently verified.
3. Silence is not agreement. If a section feels fine, say why out loud with evidence. Otherwise, find the gap.
4. No handwaving. "This might not scale" is not a finding. "At 50 briefs/hour the Workfront webhook subscription strategy will exceed org-level rate limit X documented at URL Y" is a finding.
5. Findings are ranked: `CRITICAL` (blocks implementation), `HIGH` (will cause rework in Phase 1), `MEDIUM` (should fix before v0 demo), `LOW` (v1 cleanup).

---

## Required reading (in this order)

1. `docs/PRD-BLA-FLYWHEEL-CONNECTORS-v2.md` — architectural context
2. `docs/brief-schema-v0.md` — what the MCPs pass around
3. `docs/brands/revlon/voice.json` — what LLM MCP enforces
4. `docs/NFR-PERFORMANCE-TARGETS-v0.md` — the NFR yardstick
5. The 3 completed spec files under `docs/mcp/`
6. The CC task brief at `docs/CLAUDE-CODE-TASK-MCP-SPECS.md` — tells you what CC was instructed to verify

---

## Specific failure modes to probe

You are not limited to this list. This is the minimum coverage.

### 1. Auth flow assumptions (Adobe MCP)

- Spec claims unified Adobe IMS S2S OAuth works for both Workfront and EDS. Is this actually true as of today?
  - Verify scope strings are correct for each service
  - Verify Workfront does or does not require a session exchange after IMS token acquisition
  - Verify the EDS API accepts IMS bearer tokens directly (vs. needing a different auth mechanism)
- If spec claims JWT is deprecated — confirm EOL date. Confirm S2S OAuth is GA for Workfront API specifically, not just for Firefly.
- Single Dev Console project `bla-adobe-services-dev` — does a single project actually support multiple service API bindings (Workfront + EDS) under one credential set, or does each service need its own project?

### 2. Webhook model (Adobe MCP / Orchestrator MCP)

- Spec discusses per-task vs org-level Workfront webhook subscriptions. Which does the current API support? Verify.
- Webhook signature format — HMAC-SHA256? What is the shared secret derivation? Where does the spec say to get it?
- Webhook retry behavior — if orchestrator returns 5xx, how many times does Workfront retry, at what intervals? What's the deduplication strategy on the orchestrator side if the same event arrives 5 times over 10 minutes?
- Timestamp-based replay defense — spec mentions this is a TODO or "verify". Is it actually specified now? If so, what's the acceptance window? How is clock skew handled?
- Webhook endpoint must be public HTTPS. Spec mentions `<vps>.monks.dev/webhooks/workfront`. Is DNS provisioned? Is TLS certificate strategy documented (Let's Encrypt? internal CA?)?

### 3. Publish double-gate bypass paths (Adobe MCP / Orchestrator MCP)

This is the highest-risk surface. Live publish to a real brand site is a blast-radius-of-the-world event.

- Walk through every code path that could reach `eds.publish_live`. Is the env flag check + brief metadata check enforced at BOTH the Adobe MCP and Orchestrator MCP layers? Is one layer defensive against the other being misconfigured?
- What happens if env flag is set to true but brief says false? What happens if brief says true but env says false?
- Are there any test/dev paths that could leak into prod config?
- Is there an audit log of every live publish attempt, including the ones that were rejected by the gate?
- Does the gate fail-closed if its state is unreadable (e.g., config service down)?

### 4. Cost-cap fail-closed semantics (LLM MCP)

- $1/brief cap is stated. But what exactly happens at $0.99 spent, with one more variant requested that might cost $0.05?
- How is the cost projected before the Anthropic call? Are we using model pricing from a config file that can go stale vs live-fetched rates?
- If the token-counting service is unavailable, does the call default-allow or default-deny?
- Daily $10 cap — is this rolling 24h or calendar day UTC? What happens at the boundary?

### 5. Voice.json enforcement (LLM MCP)

- `validation_hooks.post_generation` says "reject and regenerate once, then fail hard." After the second reject, what does "fail hard" mean — return error to orchestrator? Return a null variant? Retry with a different model? Specify.
- Banned vs never terms — are the checks case-insensitive? Substring vs whole-word? Does "cure" match "accurate"? Regex boundaries matter here.
- Competitor brand names — voice.json lists a few. Is this list exhaustive or a sample? Who owns keeping it current?
- Voice.json hot-reload — spec may punt to TTL cache. What's the TTL? What happens to in-flight briefs when voice.json changes mid-generation?

### 6. State machine invariants (Orchestrator MCP)

- Draw every transition. Now find the one the spec didn't consider: e.g., `generating → published` (skipped review), `rejected → under_review` (brief resubmitted to same ID). If these paths exist in code, do they fail loud or silently?
- Concurrency: two webhooks for the same brief arriving 100ms apart. `SELECT FOR UPDATE` vs advisory lock. Which does the spec commit to? How does it survive DB connection pool starvation?
- Cancel from `under_review` — does it clean up the Workfront task? Does it notify the approver?
- Rejected briefs — spec says they're terminal and must be resubmitted as new brief_id. But is there a linking field so analytics can trace rework? If not, is that acceptable or a v0 gap?

### 7. Observability-cost interaction

- 100% trace sampling in v0 is cheap at 10 briefs/day. At the v0 burst target (20 briefs in 10 minutes), is Loki/Tempo/Mimir actually sized to handle it? Document.
- Metric cardinality — every label combo is a series. Count them for every metric in the spec. Does the sum stay under the 10K v0 cap?
- Log redaction — spec says "redact prompt content at INFO." Is brief content also redacted at INFO? Is Workfront comment text? Pick one policy and check it's consistently applied.

### 8. Cross-spec contract drift

- LLM MCP spec defines `llm.generate_copy` return type. Orchestrator MCP calls it. Do the types match exactly?
- Adobe MCP spec defines `eds.publish_preview` input. Orchestrator calls it with `content_payload`. Does the payload shape the orchestrator constructs actually match the shape Adobe MCP expects?
- brief-schema-v0 defines fields. Both LLM MCP and Adobe MCP consume them. Does each MCP use the field name and type exactly as declared in the schema, or does one rename fields?
- `brief_id` formatting — consistent across all three specs? (YAML schema says human-readable `BLA-<year>-<quarter>-<brand>-<seq>`. Orchestrator open questions suggest global UUIDs. Pick one.)

### 9. NFR alignment

Check each spec against `docs/NFR-PERFORMANCE-TARGETS-v0.md`:
- Does every tool have a latency target in its spec that matches the NFR table?
- Does every tool have cost (if any) documented against the cost ceiling?
- Does every fail-closed claim in the NFR doc map to a specific enforcement in the relevant spec?
- Are there NFR claims that no spec is responsible for (gap)?
- Are there spec claims that exceed NFR targets without justification (over-spec)?

### 10. Implementation-blocker questions

For each spec, simulate being a new developer. Identify every place where you would stop and ask a question. Those are gaps.

Specific examples of what "implementation-blocker" looks like:
- Tool input/output type is vague ("structured block data" without shape)
- Error class name is missing ("AuthError" instead of `IMSAuthError`, `ClaudeAuthError`)
- Retry policy says "exponential backoff" without base/cap/jitter parameters
- Observability claims "latency metric" without the exact label set
- Test strategy says "fixture-based" without naming fixtures

---

## Output format

A single Markdown file: `docs/spec-review-findings-<date>.md`

Structure:

```
# MCP Spec Review Findings — <date>

## Summary
- Total findings: N
- CRITICAL: X
- HIGH: X  
- MEDIUM: X
- LOW: X
- Sign-off recommendation: BLOCK / REVISE / APPROVE_WITH_NOTES

## Findings

### [CRITICAL-1] <Short title>
- **Spec:** docs/mcp/<file>.md §<section>
- **Finding:** <what's wrong, with specifics>
- **Evidence:** <URL to official doc, quote, or counter-example>
- **Impact if not fixed:** <concrete downstream consequence>
- **Suggested fix:** <what to change in the spec>

### [HIGH-1] <Short title>
... (same structure)

### [MEDIUM-N] ...

### [LOW-N] ...

## Cross-spec drift (if any)
- <specific mismatch>: <which specs>, <which fields/types>, <which is correct>

## NFR misalignments (if any)
- <NFR target>: <which spec, what gap>

## Open questions for J
- <things you couldn't verify from docs alone>
```

---

## Budget

Spend up to 90 minutes of reviewer effort. If findings are still being generated at 90min, produce what you have — signal the estimated remaining surface area at the top of the report.

Tool use is fine: WebFetch for official docs, Grep across the repo for cross-spec checks, Read for the specs themselves. No code changes — this is review-only.

---

## What good looks like

A review that causes Claude Code to revise at least two of the three specs is doing its job. A review that finds zero changes probably missed something. Err on the side of flagging — LOW findings we can triage, but silent gaps become Phase 1 rework.

After the review, J decides per-finding whether to block CC on a revision or accept the gap as a known limitation.
