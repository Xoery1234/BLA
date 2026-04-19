# LLM MCP — Spec v0

**Status:** Outline — Claude Code to fill in technical detail
**Owner:** J
**Related:** PRD v2 §3.2, brief-schema-v0.md, brands/revlon/voice.json

---

## 1. Overview

**Purpose:** Primary content generator for BLA Phase 0 piping. Wraps Anthropic Claude API with brand voice injection. Called by Orchestrator MCP during the `generate` phase.

**Scope v0:**
- Text generation only (no image, no audio)
- Single provider (Anthropic Claude)
- Brand voice injection from `voice.json`
- Input validation + output safety checks

**Out of scope for v0:**
- Multi-provider support (OpenAI, Gemini) — deferred to v1+
- Streaming responses — deferred to v1 (blocking only in v0)
- Embeddings / RAG — not in flywheel scope

---

## 2. Tool surface

Three MCP tools exposed. Each tool has a clear input/output contract.

### 2.1 `llm.generate_copy`
**Input:**
- `brand_id` (required) — e.g. `"revlon"`
- `block_type` (required) — e.g. `"product-hero"`, `"statement"`, `"feature-grid"`
- `brief_context` (required) — relevant fields pulled from the brief
- `tone_overrides` (optional) — per-brief voice overrides
- `variant_count` (optional, default 1) — number of variants to return

**Output:**
- `variants[]` — array of generated copy objects with confidence score
- `metadata` — tokens used, latency, model, safety check results

**Behavior:**
- TODO: detail the prompt assembly pipeline — voice.json merge + brief injection + block-specific guidance + safety constraints

### 2.2 `llm.summarize`
- TODO: define input (long-form content) and output (short-form summary)
- TODO: specify length targets (block-specific word counts from voice.json)

### 2.3 `llm.transform`
- TODO: define transformations supported (tone shift, locale variant, length adjustment)
- TODO: clarify whether this is a separate tool or a flag on `generate_copy`

---

## 3. Auth

- **Secret source:** Infisical path `/bla/dev/llm/anthropic/api_key`
- **Auth method:** Claude API key (bearer)
- **Rotation:** TODO — define rotation policy (90 days? quarterly?) and automation
- **Local dev:** env var `ANTHROPIC_API_KEY` with Infisical CLI pull

---

## 4. External dependencies

- Claude API endpoint: TODO — verify current endpoint, should be `api.anthropic.com/v1/messages`
- Model selection: TODO — v0 defaults to Claude Sonnet 4.6 for copy, Haiku 4.5 for summarization (cost optimization)
- Rate limits: TODO — check current Anthropic tier limits, implement client-side rate limiter with generous headroom

---

## 5. Internal dependencies

- `packages/shared/voice-loader` — loads voice.json per brand_id
- `packages/shared/prompt-builder` — assembles system + user prompts with injection
- `packages/shared/validator` — post-generation safety checks (banned_terms, never_terms)
- `packages/shared/telemetry` — LGTM emitter (OTLP)

---

## 6. Observability

Emit per call:
- Metric: `llm_mcp_tokens_input_total`, `llm_mcp_tokens_output_total`, `llm_mcp_latency_ms`
- Metric: `llm_mcp_cost_usd_total` (calculated from tokens × model rate)
- Trace: full span with brief_id, brand_id, block_type tags
- Log: structured JSON, redact prompt content from INFO (DEBUG only)

---

## 7. Error handling

- TODO: define retry policy (exponential backoff? max attempts?)
- TODO: define circuit breaker thresholds
- TODO: classify error types (rate_limit, content_policy, timeout, auth_fail, unknown)
- TODO: Specify orchestrator contract — what errors propagate vs. which fail silently

---

## 8. Safety guardrails

- **Input validation:** reject requests with no brand_id or unknown brand_id
- **Output validation:** run voice.json `validation_hooks.post_generation` on every generated variant
- **Cost caps:** hard limit of $1 per brief generation (configurable)
- **Token caps:** max_tokens cap per call (TODO: set default)
- **Banned output:** if output contains any `never_terms` from voice.json, reject and regenerate once; fail hard on second reject

---

## 9. Testing strategy

- Unit: prompt builder tests (voice.json merge, injection rules)
- Integration: mocked Claude API, verify tool signatures + error paths
- Contract: voice.json schema validation
- E2E: real Claude API call with synthetic brief, assert output conforms to voice.json
- Golden tests: known brief → known output (brittle but useful for regression)

---

## 10. Open questions

- Should `generate_copy` return all variants or best-one-selected? v0 = all variants, orchestrator picks
- Voice.json hot-reload — how often does LLM MCP re-read the file? On every call or TTL cache?
- Should there be a `dry_run` mode that returns prompt without calling API? Useful for debugging, adds surface area
- Multi-locale — v0 is English only. How does voice.json extend for `fr-FR`, `ja-JP`?
