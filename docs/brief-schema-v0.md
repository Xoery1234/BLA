# BLA Creative Brief Schema v0

**Status:** Draft v0
**Date:** 2026-04-18
**Owner:** J
**Consumers:** Orchestrator MCP (intake), LLM MCP (content generation), Adobe MCP (Workfront task payload)

---

## Purpose

Structured input format for the brand launch flywheel. A brief is the single source of truth that drives all downstream generation, review, and publishing steps. It must be:

- **Structured enough** for automation to parse reliably
- **Human-readable** so brand managers can author/edit without a schema validator
- **Extensible** so future brief types (seasonal campaign, product refresh, market launch) can add fields without breaking v0

## Format choice

**YAML front-matter + Markdown body** in a single `.md` file.

Rationale:
- Structured fields in YAML header, free-form creative direction in Markdown body
- Human-editable without specialized tooling
- Parseable by any orchestrator (js-yaml, Python PyYAML, etc.)
- Playbook pattern used across static site generators, Notion exports, Obsidian

JSON Schema provided separately (`brief-schema-v0.json`) for validation in the Orchestrator MCP intake.

---

## Schema — v0 fields

### Required (gating — orchestrator rejects brief if missing)

| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `brief_id` | string | `BLA-2026-Q2-REVLON-001` | Unique, human-readable. Format: `BLA-<year>-<quarter>-<brand>-<seq>` |
| `brand` | string | `revlon` | Matches voice.json lookup key |
| `type` | enum | `product-launch`, `campaign`, `refresh` | Determines downstream content requirements |
| `locale` | string | `en-US` | BCP 47. v0 supports single locale per brief |
| `owner_email` | string | `j@monks.com` | For Workfront task assignment + notifications |
| `page_targets` | array of enum | `[home, pdp]` | Which page types this brief produces. v0 supports `home`, `pdp`, `campaign-lander` |
| `approval_chain` | array of strings | `["j@monks.com", "creative-lead@revlon.com"]` | Ordered approvers for Workfront task routing |

### Recommended (strongly encouraged, orchestrator warns if missing)

| Field | Type | Example | Notes |
|-------|------|---------|-------|
| `product` | object | see below | Required when `type == "product-launch"` |
| `campaign` | object | see below | Required when `type == "campaign"` |
| `key_messages` | array of strings | 3-5 bullet-style messages | Fed into LLM MCP as must-convey content |
| `tone_overrides` | object | `{emphasis: "confidence"}` | Overrides default voice.json settings for this brief |
| `banned_terms` | array of strings | `["cure", "clinically proven"]` | Legal/regulatory guardrails, injected into LLM prompts |
| `reference_assets` | array of URLs | DA.live or external image URLs | Existing imagery/content to reference |
| `timeline` | object | `{draft_by, approve_by, publish_by}` | ISO 8601 dates. Orchestrator uses for SLA tracking |

### Optional (v1+ extensions)

| Field | Type | Notes |
|-------|------|-------|
| `target_audience` | object | Demographics, psychographics — v1.1 when we add segment-specific voice |
| `a_b_variants` | number | Generate N variants for testing — v1.1 |
| `source_brief_id` | string | If this brief is a refresh of an older launch |
| `metadata_tags` | array | SEO/categorization tags — v1.1 |

---

## Example — Revlon pilot brief

```yaml
---
brief_id: BLA-2026-Q2-REVLON-001
brand: revlon
type: product-launch
locale: en-US
owner_email: j@monks.com
page_targets:
  - home
  - pdp
approval_chain:
  - j@monks.com
  - creative-lead@revlon.com
product:
  name: "ColorStay Overtime Lipstick"
  sku: "CSL-2026-001"
  category: "lip-color"
  price_usd: 14.99
  shades_available: 12
  hero_claim: "16-hour wear, no touch-ups"
key_messages:
  - "Revolutionary 16-hour wear technology"
  - "Weightless comfort, no dry feel"
  - "12 shades designed for all skin tones"
  - "Dermatologist-tested, non-comedogenic"
banned_terms:
  - "cure"
  - "clinically proven"
  - "doctor recommended"
reference_assets:
  - "https://main--bla--xoery1234.aem.page/assets/revlon/colorstay/hero.jpg"
  - "https://main--bla--xoery1234.aem.page/assets/revlon/colorstay/swatches.jpg"
timeline:
  draft_by: "2026-04-22"
  approve_by: "2026-04-24"
  publish_by: "2026-04-25"
tone_overrides:
  emphasis: "confidence"
  energy: "high"
---

# Creative direction

Position ColorStay Overtime as the definitive all-day lip solution. Lead with
the 16-hour wear claim — this is the hero beat. Secondary beat: shade inclusivity
(12 shades). Close with comfort/texture story.

Home page should emphasize the campaign moment — bold editorial photography,
headline-driven narrative. PDP should convert browsers to buyers — lead with
product, price, shade picker, social proof.

Avoid medical/clinical framing. Lean into editorial/fashion language.
```

---

## How each MCP consumes the brief

### Orchestrator MCP
- Validates against JSON Schema on intake
- Stores full brief in Postgres (`briefs` table)
- Creates Workfront task from approval_chain + timeline
- Emits `brief.submitted` event with brief_id
- Triggers downstream generate step

### LLM MCP
- Receives: `brand`, `type`, `page_targets`, `key_messages`, `banned_terms`, `tone_overrides`, creative direction (Markdown body)
- Loads: `voice.json[brand]` for default voice
- Merges: voice.json + tone_overrides → effective voice config
- Generates: copy per page_target, respecting banned_terms
- Returns: `{page_target, block_id, copy_variant}[]` structured output

### Adobe MCP (Workfront module)
- Receives: `brief_id`, `owner_email`, `approval_chain`, `timeline`
- Creates Workfront task with template `BLA_FlywheelReview`
- Assigns sequentially per approval_chain
- Adds brief content as task description + attached YAML
- Webhook on approval event → calls orchestrator `approve`

### Adobe MCP (EDS module)
- Receives: generated content payload from orchestrator + `page_targets`
- Publishes to `<bla-demo>.aem.page` preview under path `/{brand}/{brief_id}/{page_target}`
- Returns preview URL for demo capture

---

## Open questions for v1

- Multi-locale — how does one brief fan out to 5 languages? Probably separate briefs per locale linked via `source_brief_id`.
- A/B variants — how many, scored how, selected by whom? Defer to v1.1.
- Brief templates — pre-populated scaffolds for common brief types. Low-effort quick win for v0.5.
- External brief authoring UX — v0 assumes YAML authored by Monks ops. v1 considers a lightweight web form backed by the JSON Schema.

---

## Next actions

1. Convert this doc into a machine-readable JSON Schema (`brief-schema-v0.json`) for Orchestrator validation — Claude Code task during MCP spec phase
2. Author 1-2 additional example briefs for test coverage (campaign type, refresh type)
3. Extend Orchestrator MCP spec to reference this schema
4. Extend LLM MCP spec to specify the prompt injection contract
