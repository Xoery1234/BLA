# LLM MCP — Spec v0

**Status:** v0 — ready to implement (task #58)
**Owner:** J
**Last updated:** 2026-04-19
**Related:** PRD v2 §3.2 + §6.2, `docs/NFR-PERFORMANCE-TARGETS-v0.md` §1.1 + §3, `docs/brief-schema-v0.md`, `docs/brands/revlon/voice.json`, `docs/mcp/orchestrator-mcp-spec.md`, `docs/mcp/adobe-mcp-spec.md`

---

## 1. Overview

**Purpose.** Primary content generator for BLA Phase 0 piping. Wraps the Anthropic Claude API with brand voice injection. Called by Orchestrator MCP during the `generating` state.

**Scope v0.**
- Text generation only (no image, no audio).
- Single provider: Anthropic Claude via the Messages API.
- Brand voice injection from `docs/brands/{brand_id}/voice.json`.
- Input validation + post-generation safety checks (banned/never terms, word count, competitor name scan).
- Blocking responses only. Streaming deferred to v1.

**Out of scope for v0 (tracked for v1+).**
- Multi-provider support (OpenAI, Gemini) — deferred to v1.1.
- Streaming responses — deferred to v1.
- Embeddings / RAG — not in flywheel scope.
- Fine-tuning / custom models — not planned.

---

## 2. Tool surface

Three MCP tools. Contract schemas are authoritative: if the spec and a TypeScript interface disagree, the TypeScript wins at compile time — keep them in sync via `packages/shared/llm-types`.

### 2.1 `llm.generate_copy`

Generate block-scoped copy for a brief. Primary tool.

**Input:**
```ts
interface GenerateCopyInput {
  brief_id: string;            // for logging + tracing
  brand_id: string;            // voice.json lookup key, e.g. "revlon"
  block_type:                  // one of the BLA block catalogue
    | "statement" | "cta-grid" | "cta-sticky"
    | "product-hero" | "product-summary"
    | "feature-grid" | "reviews-condensed" | "press-quotes";
  brief_context: {             // subset of the parsed brief, shaped per block
    type: "product-launch" | "campaign" | "refresh";
    page_target: "home" | "pdp" | "campaign-lander";
    product?: object;          // present when type == product-launch
    campaign?: object;
    key_messages: string[];
    banned_terms: string[];    // brief-level additions to voice.json
    creative_direction?: string; // markdown body from the brief
  };
  tone_overrides?: {           // per-brief voice overrides
    emphasis?: string;
    energy?: "low" | "medium" | "medium-high" | "high";
    formality?: string;
  };
  reasoning?: {                // optional quality knob — see §4.2.1
    // When caller wants deeper reasoning, it passes one of:
    //   (a) `effort` — works on Opus 4.7, Opus 4.6, Sonnet 4.6, Opus 4.5.
    //                  Resolves to output_config.effort in the API call.
    //   (b) `budget_tokens` — manual extended thinking on Sonnet 4.6 / Haiku 4.5
    //                  (deprecated on Sonnet; Opus 4.7 rejects this shape with 400).
    // If both are passed and the selected model supports effort, effort wins.
    effort?: "low" | "medium" | "high" | "xhigh" | "max";
    budget_tokens?: number;    // manual thinking budget — see per-model support matrix
  };
  variant_count?: number;      // default 1, max 5
  request_id?: string;         // for idempotency (orchestrator supplies)
}
```

**Output:**
```ts
interface GenerateCopyOutput {
  variants: Array<{
    variant_id: string;        // uuid
    copy: Record<string, string>; // field → text, block-specific shape
    validation: {
      banned_terms_found: string[];
      never_terms_found: string[];
      word_count_in_range: boolean;
      competitor_mentions: string[];
    };
    confidence_score: number;  // 0-1, self-reported by model
  }>;
  metadata: {
    model: string;             // exact claude-* ID used
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    cost_usd: number;          // calculated client-side from token counts
    latency_ms: number;
    anthropic_request_id: string; // `request-id` response header
  };
}
```

**Behavior — prompt assembly pipeline.** Deterministic, no hidden state.

1. Load `voice.json` via `voice-loader` (TTL cache, see §5).
2. Merge `tone_overrides` over `voice.tone_parameters` (shallow — override wins).
3. Build **system prompt** = `voice.llm_prompt_injection.system_prompt_template` + `JSON.stringify(voice.llm_prompt_injection.inject_on → subset of voice.json)` + block-specific guidance from `voice.block_specific_guidance[block_type]`. Voice slice is attached as a single `<brand_voice>…</brand_voice>` block after the template sentence so the model sees it as reference, not instructions.
4. Build **user prompt** = structured brief context rendered as a minimal schema-like block: `<brief>key_messages=[…] product={…} banned_terms=[…] creative_direction="…"</brief>`. No prose wrapper.
5. Declare **cache breakpoints** (see §4.3): one on the `system` block, one on the `tools` array. User prompt is not cached (per-brief unique).
6. Call Messages API with `model` selected per §4.2, `max_tokens` per §8.3, `temperature: 0.7` for copy (`0.3` for `llm.summarize`, `0.5` for `llm.transform`).
7. Parse the response — the model is instructed to return a single JSON object matching the block's expected `copy` shape. Enforce with `response_format`-style assistant prefill: prefill the assistant turn with `{` so the model must continue with JSON.
8. Run **validation** (see §8). If any `banned_terms` or `never_terms` present, regenerate once with a reinforcing system message. If still failing, return a variant with the validation flags set — orchestrator decides what to do with a failed variant.

### 2.2 `llm.summarize`

Compress long-form input (e.g. a creative direction body) into a short-form summary.

**Input:**
```ts
interface SummarizeInput {
  brief_id?: string;           // optional — summarization may happen pre-brief
  brand_id: string;
  source_text: string;         // up to 100 KB
  target_length: "headline" | "subhead" | "body-short" | "body-standard";
    // maps to ideal_word_count in voice.block_specific_guidance
  target_block_type?: string;  // optional — pull word count from block guidance
  request_id?: string;
}
```

**Output:**
```ts
interface SummarizeOutput {
  summary: string;
  word_count: number;
  in_target_range: boolean;
  metadata: GenerateCopyOutput["metadata"];
}
```

**Length targets** (derived from voice.json, hardcoded v0 fallbacks):
- `headline` → 6–12 words (default), or `voice.block_specific_guidance[target_block_type].headline_word_count`.
- `subhead` → 15–25 words.
- `body-short` → 20–40 words.
- `body-standard` → 40–80 words.

**Model:** Haiku 4.5 by default (§4.2). Escalate to Sonnet 4.6 if `source_text > 50k tokens`.

### 2.3 `llm.transform`

Single tool covering tone shift, locale variant, and length adjustment. Declared separately (not a flag on `generate_copy`) because inputs and outputs are different shape — a flag would couple unrelated concerns.

**Input:**
```ts
interface TransformInput {
  brief_id?: string;
  brand_id: string;
  source_copy: string | Record<string, string>; // single string or block-copy map
  transformation: {
    type: "tone-shift" | "locale-variant" | "length-adjust";
    to: string;    // tone-shift: "confident" | "warm" | "editorial" …
                   // locale-variant: BCP-47 code, e.g. "fr-FR"
                   // length-adjust: "shorter" | "longer" | "<N>-words"
  };
  request_id?: string;
}
```

**Output:** same shape as `llm.generate_copy` (single variant).

**v0 scope:** tone-shift and length-adjust only. Locale-variant returns 501 NOT_IMPLEMENTED with a `Deferred-To: v1.1` response header — voice.json is English-only in v0 (see §10, deferred to v1.1).

---

## 3. Auth

**Secret source.** Infisical path `/bla/dev/llm/anthropic` (prod: `/bla/prod/...`). Secret name: `api_key`. Folder name `api-key` invalid per Infisical restrictions — folder names only allow letters, numbers, dashes. So: folder `/bla/dev/llm/anthropic/` → secret `api_key`.

**Auth method.** Anthropic API key sent as `x-api-key: <key>` header (NOT `Authorization: Bearer …` — Anthropic Messages API uses `x-api-key`). Alongside, always send `anthropic-version: 2023-06-01`.

Source: [Messages API overview](https://platform.claude.com/docs/en/api/overview) + [Versions](https://platform.claude.com/docs/en/api/versioning).

**Local dev.** `infisical run --env dev --path /bla/dev/llm/anthropic -- <cmd>` injects `ANTHROPIC_API_KEY` env var; the Anthropic SDK picks it up automatically. No hardcoded value ever.

**Runtime (on VPS).** Infisical Node.js SDK (`@infisical/sdk` v3+) with **Universal Auth machine identity**. Service identity `bla-llm-mcp-dev` holds a `clientId`/`clientSecret` pair; SDK exchanges those for a short-lived access token and caches it. One Infisical client per process.

Source: [Infisical Node SDK](https://infisical.com/docs/sdks/languages/node).

**Rotation policy.** 90 days on a calendar cron job. Rotation procedure:
1. Generate new Anthropic key in Anthropic Console.
2. Write new value to Infisical at the same path (Infisical supports two versions side-by-side during rollout).
3. Services re-read on next cache miss (cache TTL in §5).
4. After 24h confirm no requests on old key via Anthropic Console usage page, then revoke old key.

**No JWT anywhere. No key in git. No key in env files checked into git.**

---

## 4. External dependencies

### 4.1 Anthropic Messages API

- **Endpoint:** `POST https://api.anthropic.com/v1/messages`.
  Source: [Messages](https://platform.claude.com/docs/en/api/messages).
- **Required headers:** `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`.
- **SDK:** `@anthropic-ai/sdk` (pin to latest 0.x or 1.x major at install). Node.js ≥ 18.
- **Response `request-id` header:** captured into every log + trace for support cases.

### 4.2 Model selection

**Defaults v0** (confirmed against [Models overview](https://platform.claude.com/docs/en/about-claude/models/overview) — April 2026):

| Tool | Default model | Model ID (API) | Fallback (rate-limit overflow) |
|---|---|---|---|
| `llm.generate_copy` | Claude Sonnet 4.6 | `claude-sonnet-4-6` | Claude Haiku 4.5 (`claude-haiku-4-5`) |
| `llm.summarize` | Claude Haiku 4.5 | `claude-haiku-4-5` | Claude Sonnet 4.6 on very long input |
| `llm.transform` | Claude Sonnet 4.6 | `claude-sonnet-4-6` | Claude Haiku 4.5 |

**Rationale.** Sonnet 4.6 = best price/intelligence trade at $3/$15 per MTok. Haiku 4.5 = fastest + cheapest at $1/$5 per MTok, sufficient for summarization. **Opus 4.7 is NOT used in v0** — $5/$25 is 66% more expensive than Sonnet 4.6 and our copy tasks don't justify it. Opus escalation wired as v1.1 feature, gated on brief-level tagging.

Context window: Sonnet 4.6 = 1M tokens, Haiku 4.5 = 200k, Opus 4.7 = 1M. Max output: Sonnet 4.6 = 64k, Haiku 4.5 = 64k, Opus 4.7 = 128k.

### 4.2.1 Reasoning / thinking dispatcher (model capability matrix)

Per-model capability matrix, verified against [adaptive thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking), [effort](https://platform.claude.com/docs/en/build-with-claude/effort), and [extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking) docs on 2026-04-19:

| Model | `thinking: {type: "enabled", budget_tokens}` | `thinking: {type: "adaptive"}` | `output_config.effort` | Preferred shape |
|---|---|---|---|---|
| Opus 4.7 | **400 error** | ✓ (default) | ✓ (`low\|medium\|high\|xhigh\|max`) | adaptive + effort |
| Sonnet 4.6 | ✓ (deprecated) | ✓ | ✓ (`low\|medium\|high\|max` — no `xhigh`) | adaptive + effort |
| Haiku 4.5 | ✓ | not documented | not documented | manual only |
| Opus 4.5 | ✓ | ✓ | ✓ | either |
| Opus 4.6 | ✓ (deprecated) | ✓ | ✓ | adaptive + effort |

No beta header is required for `effort` or adaptive thinking. (J's search surfaced `task-budgets-2026-03-13`; the live docs do not reference that header for this feature.)

**Dispatcher — single source of truth in `packages/shared/prompt-builder/reasoning.ts`:**

```ts
export function buildReasoningConfig(
  model: ModelId,
  input: { effort?: Effort; budget_tokens?: number } | undefined,
): { thinking?: ThinkingConfig; output_config?: OutputConfig } {
  if (!input) return {};

  // Opus 4.7: adaptive thinking is default. budget_tokens is a 400.
  // Pass effort through output_config; ignore budget_tokens.
  if (model === 'claude-opus-4-7') {
    return input.effort
      ? { output_config: { effort: input.effort } }
      : {}; // no knob requested → rely on Opus 4.7 defaults
  }

  // Opus 4.6 and Sonnet 4.6: prefer effort over budget_tokens.
  if (model === 'claude-sonnet-4-6' || model === 'claude-opus-4-6') {
    if (input.effort) {
      return { output_config: { effort: input.effort } };
    }
    if (input.budget_tokens) {
      return {
        thinking: { type: 'enabled', budget_tokens: input.budget_tokens },
      };
    }
    return {};
  }

  // Haiku 4.5: manual extended thinking only.
  // `effort` is not documented on Haiku 4.5 — silently drop it.
  if (model === 'claude-haiku-4-5') {
    if (input.budget_tokens) {
      return {
        thinking: { type: 'enabled', budget_tokens: input.budget_tokens },
      };
    }
    return {};
  }

  // Older Claude 4 models (Opus 4.5, Sonnet 4.5): manual thinking works.
  if (input.budget_tokens) {
    return {
      thinking: { type: 'enabled', budget_tokens: input.budget_tokens },
    };
  }
  return {};
}
```

**v0 use:** the dispatcher ships but is unused — v0 briefs do not set `reasoning`. The code path is tested against each model's accepted shape so that v1.1 escalation turn-on is a pure config change, not a spec rewrite.

**Contract test per model (required):**

```
Test: reasoning-dispatch

Opus 4.7 + effort="xhigh"        → request body contains output_config.effort="xhigh",
                                    NO thinking block (adaptive is default).
Opus 4.7 + budget_tokens=5000    → budget_tokens dropped, no thinking block,
                                    warn log emitted ("opus-4-7-budget-tokens-ignored").
Sonnet 4.6 + effort="medium"     → output_config.effort="medium", no thinking block.
Sonnet 4.6 + budget_tokens=3000  → thinking: {type:"enabled", budget_tokens:3000}.
Sonnet 4.6 + effort + budget     → effort wins, budget_tokens dropped.
Haiku 4.5 + budget_tokens=1500   → thinking: {type:"enabled", budget_tokens:1500}.
Haiku 4.5 + effort="medium"      → effort dropped (not supported), no thinking block.
<any> + undefined                → empty object (no knobs).
```

**SDK-typed guard preferred over runtime check.** If `@anthropic-ai/sdk` exposes per-model parameter types that make `buildReasoningConfig` output → `MessagesCreateParams` a compile-time type error for invalid combinations, prefer that. Note the SDK major version requirement (~1.x+ when the effort+adaptive split landed; confirm at dependency pin time).

### 4.3 Prompt caching

v0 uses 5-minute ephemeral caching (default TTL) on the two static parts of every request:

1. **System prompt** (voice.json injection + template sentence) — cached on the last system block.
2. **Tools array** — cached on the last tool definition.

Breakpoints per request: 2 of the allowed 4.

#### 4.3.1 Per-model cache minimums (single source of truth)

```ts
// packages/shared/cost-calc/model-cache-min.ts
export const MODEL_CACHE_MIN: Record<ModelId, number> = {
  'claude-opus-4-7':   4096,
  'claude-opus-4-6':   4096,
  'claude-opus-4-5':   4096,
  'claude-sonnet-4-6': 2048,
  'claude-haiku-4-5':  4096,
};
```

<sup>Anthropic prompt-caching minimums verified against [platform.claude.com/docs/en/build-with-claude/prompt-caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) on 2026-04-19. Haiku 4.5 minimum is **4096** tokens; Sonnet 4.6 minimum is **2048** tokens; Opus 4.5/4.6/4.7 minimum is **4096** tokens. Re-verify at each major model release.</sup>

#### 4.3.2 Model-aware padding (replaces the prior unconditional pad-to-2048)

```ts
const cacheMin = MODEL_CACHE_MIN[model];
if (estimatedInputTokens < cacheMin) {
  applyPadding(cacheMin - estimatedInputTokens); // pad to exactly cacheMin
} else {
  skipPadding();                                  // already cacheable
}
```

Padding material is the serialized `voice.block_specific_guidance` block (all block-type entries, not just the one being generated) — stable content that also serves a real purpose at read time, so we're not padding with filler. Still cheaper than skipping cache: one 1.25× cache-write, many 0.1× reads thereafter.

**Contract test (required):**

```
Test: prompt-cache-boundary

Sonnet 4.6 (minimum 2048):  tokens ∈ {2047, 2048, 2049}
  Expect  2047 → padded to 2048, cache_creation_input_tokens > 0 on 1st call
          2048 → no padding,     cache_creation_input_tokens > 0 on 1st call
          2049 → no padding,     cache_read_input_tokens > 0 on 2nd call

Haiku 4.5  (minimum 4096):  tokens ∈ {4095, 4096, 4097}
  Expect  4095 → padded to 4096, cache_creation_input_tokens > 0 on 1st call
          4096 → no padding,     cache_creation_input_tokens > 0 on 1st call
          4097 → no padding,     cache_read_input_tokens > 0 on 2nd call

Opus 4.7   (minimum 4096):  tokens ∈ {4095, 4096, 4097}
  (Same shape as Haiku 4.5.)
```

#### 4.3.3 Cache economics per model

| Model | Input base | 5m cache write (1.25×) | Cache read (0.1×) |
|---|---|---|---|
| Sonnet 4.6 | $3.00 / MTok | $3.75 / MTok | $0.30 / MTok |
| Haiku 4.5  | $1.00 / MTok | $1.25 / MTok | $0.10 / MTok |
| Opus 4.7   | $5.00 / MTok | $6.25 / MTok | $0.50 / MTok |

Expected hit rate: >80% during a brief's full fan-out (8 blocks × same voice). Per-brief amortized voice-preamble cost:
- Sonnet 4.6 fan-out: ~$0.02
- Haiku 4.5 fan-out: ~$0.006

Source: [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

### 4.4 Rate limits

Default **Tier 1** (assumed until usage lifts tier — see [Rate limits](https://platform.claude.com/docs/en/api/rate-limits)):

| Model | RPM | ITPM | OTPM |
|---|---|---|---|
| Sonnet 4.x (4.6) | 50 | 30,000 | 8,000 |
| Haiku 4.5 | 50 | 50,000 | 10,000 |
| Opus 4.x (4.7) | 50 | 30,000 | 8,000 |

**Cache-aware ITPM:** `cache_read_input_tokens` does NOT count against ITPM for Claude 4.x models. Only `input_tokens` + `cache_creation_input_tokens`.

**Client-side limiter:** token-bucket implementation in `packages/shared/rate-limiter`. Configure at 80% of server-side caps (RPM 40, ITPM 24k on Sonnet, OTPM 6.4k) — this is the "headroom" referenced in the outline. Burst allowance = 1.5× sustained rate.

**429 handling:** respect `retry-after` header (seconds), exponential backoff from that baseline, max 5 retries. On 5th failure, classify as `rate_limit_exhausted` and bubble to orchestrator (see §7).

---

## 5. Internal dependencies

Shared packages live under `packages/shared/` in the Turborepo monorepo.

| Package | Purpose | Notes |
|---|---|---|
| `packages/shared/voice-loader` | Read `docs/brands/{brand_id}/voice.json`, TTL-cache by file mtime | TTL 60s (see §10 decision). Validates against `packages/shared/schemas/voice-schema.json` on load using `ajv@8` with `strict: true`. See §8.5 for fail-fast semantics. |
| `packages/shared/prompt-builder` | Assemble system + user prompts, apply cache_control markers | Pure functions, fully unit-testable without SDK. |
| `packages/shared/validator` | Run `voice.validation_hooks.post_generation` on output | Returns `{banned_terms_found, never_terms_found, ...}`. Never throws. |
| `packages/shared/rate-limiter` | Client-side token-bucket limiter per model | Separate bucket per model class. |
| `packages/shared/telemetry` | OTLP emitter (metrics + traces + logs) | See §6. |
| `packages/shared/cost-calc` | Token-count-to-USD computation per model | Static pricing table, one-touch update when Anthropic changes pricing. |
| `packages/shared/infisical-client` | Universal Auth machine-identity wrapper | Single client per process. |
| `packages/shared/errors` | Shared error class hierarchy | See §7. |

---

## 6. Observability

OTLP-exported via Grafana Alloy (on the VPS) → Mimir/Tempo/Loki. App emits to `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` by default (HTTP/protobuf — OTel Node SDK default).

### 6.0 Latency SLOs (per NFR §1.1)

| Tool | v0 P95 target | v1 P95 target | Measured via |
|---|---|---|---|
| `llm.generate_copy` (1 variant) | ≤ 8s | ≤ 5s | `llm_mcp_latency_seconds{tool="generate_copy"}` P95 |
| `llm.generate_copy` (3 variants) | ≤ 15s | ≤ 10s | Same metric, `variant_count=3` path |
| `llm.summarize` | ≤ 4s | ≤ 3s | `llm_mcp_latency_seconds{tool="summarize"}` P95 |
| `llm.transform` | ≤ 6s | ≤ 4s | `llm_mcp_latency_seconds{tool="transform"}` P95 |

Alert rule: Grafana alert on P95 breach for ≥5 min. Page J.


Source: [Grafana Alloy OTLP → LGTM](https://grafana.com/docs/alloy/latest/collect/opentelemetry-to-lgtm-stack/).

### 6.1 Metrics (Mimir via Alloy)

All names lowercase snake_case, `_total` suffix on counters, `_seconds` on durations, `_usd` on cost.

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `llm_mcp_requests_total` | counter | `tool`, `model`, `brand_id`, `status` | `status ∈ {ok, rate_limited, validation_failed, regenerated, content_policy, timeout, error}` |
| `llm_mcp_input_tokens_total` | counter | `tool`, `model`, `token_class` | `token_class ∈ {uncached, cache_creation, cache_read}` |
| `llm_mcp_output_tokens_total` | counter | `tool`, `model` | |
| `llm_mcp_latency_seconds` | histogram | `tool`, `model` | Buckets: `.25, .5, 1, 2, 5, 10, 30, 60, 120` |
| `llm_mcp_cost_usd_total` | counter | `tool`, `model`, `brand_id` | Calculated client-side. |
| `llm_mcp_cache_hit_ratio` | gauge | `tool`, `model` | Rolling 5-min average. |
| `llm_mcp_regenerate_total` | counter | `tool`, `brand_id`, `reason` | `reason ∈ {banned_term, never_term, word_count, competitor}` |
| `llm_mcp_safety_reject_total` | counter | `tool`, `brand_id`, `reason` | Hit after regenerate still fails. |

Label cardinality: `brand_id` is bounded (1–10 brands max in the flywheel lifetime), `tool` + `model` + `status` + `reason` are finite enums. Keeps cardinality under 1k series per metric.

Source: [Loki label best practices](https://grafana.com/docs/loki/latest/get-started/labels/bp-labels/) (cardinality rules apply to Mimir too).

### 6.2 Traces (Tempo via OTLP)

Span per tool call. Attributes on the root span:
- `bla.brief_id` (dot-namespaced per OTel semantic conventions)
- `bla.brand_id`
- `bla.tool_name`
- `bla.block_type` (when applicable)
- `bla.request_id` (idempotency key)
- `anthropic.model` (exact ID)
- `anthropic.request_id` (from response header — maps trace to Anthropic support case)
- `http.request.method`, `http.response.status_code`, `url.full` (OTel HTTP semconv — note: `http.method`/`http.status_code` are deprecated)

Child spans:
- `llm.prompt_build` — prompt assembly
- `llm.api_call` — Messages API round-trip
- `llm.validate` — post-generation validation
- `llm.regenerate` (conditional) — emitted when regeneration is triggered

Source: [OTel trace semconv](https://opentelemetry.io/docs/specs/semconv/general/trace/), [HTTP semconv](https://opentelemetry.io/docs/specs/semconv/http/http-spans/).

### 6.3 Logs (Loki via Alloy)

Structured JSON to stdout. Alloy tails container stdout and forwards to Loki.

**Labels (low cardinality — Loki stream-count limit):**
- `service: "bla-llm-mcp"`
- `env: "dev" | "staging" | "prod"`
- `level: "DEBUG" | "INFO" | "WARN" | "ERROR"`

**Fields (in JSON body, not labels):**
- `trace_id`, `span_id` (OTel-correlated)
- `brief_id`, `brand_id`, `tool`, `model`
- `anthropic_request_id`
- `prompt` — **DEBUG level only.** Never logged at INFO+ (prompts may contain unreleased brand copy).
- `response_summary` — first 200 chars at INFO, full at DEBUG.

---

## 7. Error handling

### 7.1 Error class hierarchy

All errors extend `LlmMcpError` (in `packages/shared/errors`).

```ts
class LlmMcpError extends Error {
  readonly code: string;       // stable enum, SAFE to match on
  readonly retryable: boolean;
  readonly http_status?: number;
  readonly anthropic_request_id?: string;
  readonly details?: unknown;
}

class AuthFailError extends LlmMcpError          { code = "auth_fail";           retryable = false; }
class RateLimitError extends LlmMcpError         { code = "rate_limit";          retryable = true;  }
class ContentPolicyError extends LlmMcpError     { code = "content_policy";      retryable = false; }
class TimeoutError extends LlmMcpError           { code = "timeout";             retryable = true;  }
class ValidationFailError extends LlmMcpError    { code = "validation_fail";     retryable = false; }
class SafetyRejectError extends LlmMcpError      { code = "safety_reject";       retryable = false; }
class ServiceUnavailableError extends LlmMcpError{ code = "service_unavailable"; retryable = true;  }
class BriefInvalidError extends LlmMcpError      { code = "brief_invalid";       retryable = false; }
class CostCapExceededError extends LlmMcpError   { code = "cost_cap_exceeded";   retryable = false; }
class UnknownModelError extends LlmMcpError      { code = "unknown_model";       retryable = false; }
class UnknownUpstreamError extends LlmMcpError   { code = "unknown";             retryable = false; }
```

### 7.2 Retry policy

Two distinct retry layers:

**Network/transient layer (Anthropic SDK or our wrapper):**
- Retry on `429`, `500`, `502`, `503`, `504` network errors.
- Exponential backoff with jitter — base `1s`, factor `2`, max `30s`, max `5` attempts.
- Respect `retry-after` header when present (seconds).
- Total deadline: 60s per tool call.

**Safety-regeneration layer (LLM-content level):**
- If post-generation validator flags `banned_term` OR `never_term`, regenerate **exactly once** with a reinforcing "Previous draft contained forbidden terms — avoid X, Y, Z" user message appended.
- Second failure → bubble `SafetyRejectError` to orchestrator. **Fail hard, do not loop.**
- Word-count-out-of-range → flag but do NOT regenerate (orchestrator decides).
- Competitor mention → regenerate once, same policy as banned_term.

### 7.3 Circuit breaker

Per-model circuit breaker in `packages/shared/rate-limiter`:
- Trip threshold: 50% error rate over 20-request sliding window, OR 5 consecutive 5xx.
- Half-open after 30s; single probe request; close on success.
- While open: all requests fail fast with `ServiceUnavailableError`.

### 7.4 Orchestrator contract

Errors propagate to orchestrator verbatim (as structured JSON). Orchestrator decides whether to:
- Retry (`retryable: true`).
- Transition the brief to `failed` state (`retryable: false`).
- Surface to human via Workfront comment (`SafetyRejectError`, `BriefInvalidError`).

Orchestrator MUST NOT swallow LLM errors silently. See `orchestrator-mcp-spec.md` §8.

---

## 8. Safety guardrails

### 8.1 Input validation
- `brand_id` required and must match a key in `docs/brands/*/voice.json`. Unknown brand → `BriefInvalidError`.
- `block_type` must be in the allowed 8-block enum. Unknown → `BriefInvalidError`.
- `brief_context.creative_direction` truncated at 20,000 chars (reject above).

### 8.2 Output validation (post-generation)

Every generated variant runs through `validator` before return.

**Matching semantics (authoritative):**
- **Case:** case-insensitive (`cure` matches `Cure`, `CURE`).
- **Boundary:** whole-word via regex `\b<term>\b` after Unicode-normalized lowercasing. `cure` does NOT match `accurate`, `obscure`, `manicure`.
- **Multi-word terms:** each whitespace run treated as `\s+`. `doctor recommended` matches `doctor  recommended` and `doctor recommended`.
- **Accents:** NFKD-fold before matching. `L'Oréal` matches `l'oreal`.
- **Terms checked in:** all rendered text in the generated variant, including block field values and any text wrapping. Not in JSON keys.

**Checks:**

1. **`banned_terms`** (union of `voice.vocabulary.avoid_terms` + `brief_context.banned_terms`) — flag, regenerate-once.
2. **`never_terms`** (from `voice.vocabulary.never_terms`) — flag, regenerate-once, then `SafetyRejectError`.
3. **`competitor_mentions`** — static list per brand in `voice.validation_hooks.competitor_names` (v0 Revlon list: L'Oréal, Maybelline, NYX, CoverGirl, e.l.f., Fenty, Charlotte Tilbury; **this list is a sample, J owns keeping it current — the voice.json file is the source of truth**). Flag, regenerate-once.
4. **`word_count`** — compare to `voice.block_specific_guidance[block_type].*_word_count` — warn only, do not regenerate.

**Regenerate-once semantics:**
- Same model, same temperature, same seed-free call.
- User message appended: `"Previous draft contained forbidden term(s): <list>. Rewrite to remove them without losing meaning."`.
- If second output still fails: return a `SafetyRejectError` to orchestrator (retryable: false). The orchestrator (per `orchestrator-mcp-spec.md` §8.2) transitions the brief to `failed` and logs the rejected variant for human review.

Source: voice.json `validation_hooks.post_generation` — four checks enumerated there. This spec is the authoritative implementation; voice.json is the source of intent.

### 8.3 Cost + token caps (NFR §3 alignment, fail-closed)

- **`max_tokens` per call:** 2,000 default (sufficient for 8-block copy with room to spare). Configurable per `block_type` — e.g. `product-summary` block up to 500 words × ~1.5 tokens/word + JSON wrapper ≈ 1,000 tokens. Never set above 4,000 for copy.

- **Per-brief cost cap: $1.00 USD v0 / $0.75 v1** per `brief_id` across all LLM calls for that brief. Orchestrator tracks cumulative spend in `brief_artifacts` (`artifact_type = 'cost_ledger'`, see `orchestrator-mcp-spec.md` §9.7) and — critically — the LLM MCP **projects** cost of an incoming call before dispatch:

  1. `projected_input_tokens = input_tokens(prompt) + input_tokens(voice_slice_if_first_in_brief)`.
  2. `projected_output_tokens = max_tokens` (worst case).
  3. `projected_call_cost = projected_input × model.input_rate + projected_output × model.output_rate` using the static pricing table in `packages/shared/cost-calc`.
  4. If `cumulative_brief_cost + projected_call_cost > cap` → `CostCapExceededError` returned **before** any Anthropic call.

- **Fail-closed when ledger unavailable.** If the orchestrator's cost-ledger read fails (DB down, timeout), LLM MCP **rejects** the call with `CostCapExceededError` rather than defaulting to allow. This is the fail-closed invariant from NFR §6.2.

- **Per-day org cap:** $10 USD v0 / $25 USD v1 per calendar day UTC, sustained across all briefs. Tracked by a rolling-24h counter in Postgres, populated by an hourly-aggregated sum over `brief_artifacts.cost_ledger`. Alert at 80%, reject at 100%. Calendar-day reset at 00:00 UTC — briefs submitted during a reject window retry automatically at the boundary (with jitter to prevent thundering herd).

- **Pricing-table staleness.** Static table in `cost-calc` reviewed monthly; automated health check compares our table to [the pricing page](https://platform.claude.com/docs/en/about-claude/pricing) and alerts on diff. If a model appears in the API that's not in our table, that tool call fails closed with `UnknownModelError`.

Note: adversarial review questioned "what happens at $0.99 with one more $0.05 variant requested?" Answer: rejected at the projection step (above). Caller sees `CostCapExceededError` with `details: { cumulative, projected, cap }` so the orchestrator can surface the reason to the human via Workfront comment.

### 8.4 Prompt-cache padding (model-aware)

See §4.3.2 for the authoritative padding dispatcher (`MODEL_CACHE_MIN[model]`).

**Why pad at all.** A prompt below the model's cache minimum is uncached entirely — every call pays base input pricing. Padding to the minimum costs one 1.25× write and unlocks 0.1× reads thereafter. Break-even after ≤3 reads on every model we use in v0.

**Why dynamic, not fixed.** The earlier spec unconditionally padded every prompt to 2048. That value is correct for Sonnet 4.6 but **wrong for Haiku 4.5 and Opus** (both 4096). Under the old code, Haiku calls with a voice preamble padded to 2048 still fell below Haiku's 4096 threshold and therefore cached nothing — we paid 1.25× write cost for no reads. The model-aware dispatcher fixes this.

### 8.5 voice.json schema validation (fail-fast on startup)

**Schema:** `packages/shared/schemas/voice-schema.json` (JSON Schema draft 2020-12).

**Validator:** `ajv@8` with `strict: true`. Loads the schema once per process and validates every voice.json on first read and on cache expiry.

**Required fields** (validator rejects voice.json without them): `brand_id`, `version`, `voice_characteristics`, `vocabulary` (with `never_terms`), `block_specific_guidance` (with at least one entry), `llm_prompt_injection` (with `system_prompt_template`), `validation_hooks` (with `post_generation`).

**Failure behavior:**
- **First read (MCP startup for default brand):** invalid voice.json → fail-fast boot, exit code 78 (EX_CONFIG). Error message includes the ajv error path (`instancePath`, `message`, `schemaPath`) so the fix target is obvious.
- **Lazy read (first brief for a new brand):** invalid voice.json → fail the request with `BriefInvalidError` tagged `reason: "voice_schema_invalid"`. Orchestrator transitions the brief to `failed` and surfaces the ajv error path in the Workfront comment. Subsequent briefs for the same brand also fail until voice.json is fixed (TTL cache holds the failure).
- **Cache refresh:** invalid voice.json on re-read → continue serving from the previous valid in-memory copy, log at WARN (`bla.warn=voice_schema_stale_on_refresh`) so author sees feedback without taking the MCP down. Grafana alert at >3 WARN in 10min.

**Why this matters.** Before this patch, LLM MCP read voice.json with no validation. A new brand onboarded post-Revlon (e.g., missing `voice_characteristics` or `block_specific_guidance`) would silently get default-tuned prompts at runtime — off-brand output would only surface in QA. Fail-fast on startup catches the problem before any brief lands.

Schema lives in `packages/shared/schemas/` so Adobe MCP's brand-metadata checks can share it if needed.

**Padding material.** Serialized `voice.block_specific_guidance` (all block-type entries). Stable content that also serves a real purpose at read time — so we're not padding with filler.

---

## 9. Testing strategy

### 9.1 Unit tests
- `prompt-builder`: voice.json merge rules (override precedence, deep vs shallow), cache_control marker placement, assistant prefill construction.
- `validator`: every banned_term shape, never_term shape, competitor scan, word count bucketing.
- `cost-calc`: every model × every token class round-trip to known fixtures.
- `rate-limiter`: token-bucket refill, burst handling, per-model isolation.

Fixture files: `packages/shared/__fixtures__/voice-revlon.json`, `…/brief-product-launch.json`, `…/expected-system-prompt.txt`.

### 9.2 Integration tests
- Mocked Anthropic SDK (via `msw` or `nock`). Verify:
  - Correct endpoint, headers, body shape per tool.
  - Cache breakpoints declared at the right places.
  - 429 response triggers backoff + retry.
  - 5xx triggers exponential backoff.
  - `retry-after` header respected.
  - Response `request-id` captured into logs + traces.

### 9.3 Contract tests
- voice.json schema validation against `packages/shared/schemas/voice-schema.json` (JSON Schema draft 2020-12). Fixture: validate `docs/brands/revlon/voice.json` succeeds; validate a synthetic minimal-but-valid voice; validate a missing-required-field case fails with expected ajv error path.
- Tool input/output shape validation via zod schemas derived from the TypeScript interfaces in §2.

### 9.4 E2E tests (gated — run against real Anthropic API)
- Fixture brief → call real `llm.generate_copy` → assert variant conforms to voice.json (no banned_terms, word count in range).
- Runs only when `ANTHROPIC_API_KEY` present in CI secrets. Skip on PR; gated nightly.
- Budget cap: `BLA_E2E_CLAUDE_MAX_SPEND_USD=2.00`.

### 9.5 Golden tests
- 6 fixture briefs × 8 block types × 1 variant each = 48 golden outputs.
- Brittle by design — regenerating the golden file requires human review.
- Catches silent regression when Anthropic changes model behavior without changing the model ID.

### 9.6 Chaos tests
- Simulate 429, 500, 502, timeout, truncated JSON, non-JSON response, validation-fail-twice, validation-fail-once-then-pass.
- Each scenario has an expected terminal state and expected log/metric output.

---

## 10. Resolved decisions

Every open question from the original outline now has an answer.

| Question | v0 decision | Rationale |
|---|---|---|
| All variants vs best-one | Return **all variants**, orchestrator picks. | Keeps LLM MCP stateless. Orchestrator owns the "which variant went to Workfront" record. |
| voice.json hot-reload | **60s TTL cache** by file mtime. | Balances authoring feedback loop with reload noise. Orchestrator calls bursts are < 60s so same voice used for one brief. |
| `dry_run` mode | **Included.** `dry_run: true` on `generate_copy` returns prompt + cache markers + estimated cost without calling API. | Useful for CI smoke + cost-preview. Cost increment: zero API calls. |
| Multi-locale | **Deferred to v1.1.** `voice.json` schema extended with `locales.<BCP47>` overrides. `llm.transform` with `type: locale-variant` returns 501 in v0. Tracked as issue BLA-72. |

---

## 11. Known gaps / deferred

Intentionally left open in v0 (documented for v1 pickup):

- **Streaming responses.** Messages API supports streaming; Orchestrator v0 is sync-call based, so no consumer. Revisit when we add a chat-style UI.
- **Token accounting accuracy.** `cost-calc` uses static pricing table. Anthropic pricing changes are rare but not zero. Wire to monthly health check that diffs against `pricing` page.
- **Priority Tier.** Available for all three models but not enabled in v0 (Priority Tier needs committed spend, we're pre-Tier-2). Revisit when we're consistently hitting Tier 1 caps.
- **Extended thinking / effort.** Dispatcher shipped in §4.2.1 but `reasoning` input left unset in v0. v1.1 turn-on: add `reasoning.effort` or `reasoning.budget_tokens` to the brief and let the orchestrator pass it through. Tag-driven enablement (`brief.requires_deep_reasoning`) maps to `reasoning.effort = "xhigh"` on Opus 4.7 or `reasoning.effort = "high"` on Sonnet 4.6.
- **Fast mode.** Beta research preview on Opus 4.6 only — not relevant to our Sonnet 4.6 default.
- **Prompt caching TTL upgrade.** 1-hour TTL available at 2× write cost. Break-even > 20 reads. At current 8-blocks-per-brief and low brief volume, 5-minute TTL is sufficient.
- **Batch API.** 50% discount on non-urgent work. Orchestrator v0 is synchronous; batching revisited if we add an overnight-generation feature.

---

## Sources

- [Anthropic Models overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- [Anthropic Messages API reference](https://platform.claude.com/docs/en/api/messages)
- [Anthropic Rate limits](https://platform.claude.com/docs/en/api/rate-limits)
- [Anthropic Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Anthropic API versioning](https://platform.claude.com/docs/en/api/versioning)
- [Infisical CLI run](https://infisical.com/docs/cli/commands/run)
- [Infisical Node SDK](https://infisical.com/docs/sdks/languages/node)
- [Infisical folder naming](https://infisical.com/docs/documentation/platform/folder)
- [Grafana Alloy OTLP → LGTM](https://grafana.com/docs/alloy/latest/collect/opentelemetry-to-lgtm-stack/)
- [Loki label best practices](https://grafana.com/docs/loki/latest/get-started/labels/bp-labels/)
- [OTel trace semantic conventions](https://opentelemetry.io/docs/specs/semconv/general/trace/)
- [OTel HTTP semantic conventions](https://opentelemetry.io/docs/specs/semconv/http/http-spans/)
