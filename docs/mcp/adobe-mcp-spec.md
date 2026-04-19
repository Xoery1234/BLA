# Adobe MCP — Spec v0

**Status:** Outline — Claude Code to fill in technical detail
**Owner:** J
**Related:** PRD v2 §3.1, §6.1

---

## 1. Overview

**Purpose:** Unified MCP wrapping all Adobe services under a single IMS S2S OAuth auth flow. v0 scope compressed to Workfront + EDS for piping-first demo. Firefly/Content-Tagging/Photoshop/etc. added as additive modules in v1.5+.

**Scope v0:**
- Workfront API (task CRUD, status, comments, webhook subscriptions)
- Edge Delivery Services API (preview publish, live publish, config read)
- Unified Adobe IMS OAuth Server-to-Server authentication

**Explicitly out of scope for v0 (deferred to v1.5+):**
- Firefly API (image generation)
- Content Tagging API
- Photoshop / Illustrator / InDesign / Lightroom / Substance 3D APIs
- Frame.io V4 API
- Audio & Video API

---

## 2. Tool surface

### 2.1 Workfront module

**`workfront.create_task`**
- Input: `template_id`, `brief_id`, `assignees[]` (ordered approval_chain), `description`, `due_date`
- Output: `task_id`, `workfront_url`
- TODO: specify Workfront template naming convention (should match PRD v2 §4 isolation rules — `BLA_*` prefix)

**`workfront.update_status`**
- Input: `task_id`, `status` (enum: `in_progress`, `blocked`, `approved`, `rejected`)
- Output: confirmation + updated timestamp

**`workfront.add_comment`**
- Input: `task_id`, `comment_text`, `author_email` (optional, defaults to service account)
- Output: `comment_id`

**`workfront.subscribe_webhook`**
- Input: `task_id`, `event_types[]`, `callback_url`
- Output: `subscription_id`
- TODO: verify Workfront supports per-task webhook subscriptions in current API version; may need org-level subscription with filter

### 2.2 EDS module

**`eds.publish_preview`**
- Input: `brand_id`, `brief_id`, `page_target`, `content_payload` (structured block data)
- Output: `preview_url` (e.g. `https://main--bla--xoery1234.aem.page/revlon/<brief_id>/home`)
- Behavior: write content to DA.live at canonical path, trigger preview build
- TODO: specify the canonical DA.live path structure

**`eds.publish_live`**
- Input: `brand_id`, `brief_id`, `page_target`
- Output: `live_url`
- Behavior: promote preview to live (aem.live)
- **v0 note:** for Revlon demo we DO NOT publish live (pilot only). This tool exists in v0 API but returns 403 unless env-flag `ENABLE_LIVE_PUBLISH=true` is set.

**`eds.get_config`**
- Input: `brand_id`
- Output: current EDS config for the brand's site
- Read-only utility for orchestrator diagnostics

---

## 3. Auth

- **Single Dev Console project:** `bla-adobe-services-dev` (deferred creation per piping-first pivot — will be created when Q6 Workfront setup kicks off)
- **Product profile binding:** `BLA Workfront Dev` + future `BLA EDS Dev` profiles
- **OAuth flow:** Server-to-Server (client_credentials grant)
- **Scopes v0:** `openid`, `AdobeID`, plus Workfront + EDS specific scopes (TODO: verify exact scope strings)
- **Token caching:** cache access_token in memory with TTL 5 minutes shy of expiry; proactive refresh
- **Secret source:** Infisical `/bla/dev/adobe/services/` containing `client_id`, `client_secret`, `org_id`, `technical_account_id`
- **Rotation:** TODO — define rotation policy

---

## 4. External dependencies

### 4.1 Workfront
- API base: TODO — verify current base URL for Monks Workfront instance (`<tenant>.my.workfront.com/attask/api/v21.0`)
- Auth: access_token from IMS passed as `Authorization: Bearer` or specific Workfront session header (TODO: verify — Workfront auth via Adobe IMS may need `sessionID` exchange)
- API version: **v21** (breaking change in v21: multi-select fields now arrays)
- Rate limits: TODO — verify current Workfront API rate limits

### 4.2 Edge Delivery Services
- API base: TODO — verify (likely `admin.hlx.page` or similar for Helix 5)
- Auth: access_token from IMS
- Rate limits: TODO

---

## 5. Internal dependencies

- `packages/shared/ims-client` — Adobe IMS OAuth client with token caching (reused by Adobe MCP and any future Adobe-integrated service)
- `packages/shared/retry` — exponential backoff with jitter
- `packages/shared/telemetry` — LGTM emitter

---

## 6. Observability

Emit per call:
- Metric: `adobe_mcp_<service>_latency_ms` (service = `workfront` | `eds`)
- Metric: `adobe_mcp_<service>_error_total` (tagged by error_class)
- Metric: `adobe_mcp_ims_token_refresh_total`
- Trace: full span tagged by `service`, `tool`, `brief_id`
- Log: structured JSON, redact tokens and brief content

---

## 7. Error handling

- TODO: define retry policy per service (Workfront 429 retry-after, EDS rate limits)
- TODO: define circuit breaker
- TODO: classify errors:
  - `auth_fail` (bubble up immediately, do not retry)
  - `rate_limit` (retry with backoff)
  - `not_found` (bubble up to orchestrator for decision)
  - `validation_fail` (reject with detail)
  - `service_unavailable` (retry with longer backoff)
  - `unknown` (log loudly, bubble up)

---

## 8. Safety guardrails

- **Isolation protocol enforcement:** every Workfront task created must have `BLA_` prefix on template or visible `[BLA]` tag on name; every EDS publish path must be under `/bla-*` or `/<brand>/<brief_id>/*`
- **Publish gate:** `eds.publish_live` requires `ENABLE_LIVE_PUBLISH=true` env flag AND `allow_live_publish=true` in brief metadata. Double-gate for safety.
- **Rate limit pre-check:** before calling downstream Adobe API, check local budget counter; reject if exceeded
- **Credential scope audit:** on startup, log which scopes the current IMS token has; fail startup if required scopes missing

---

## 9. Testing strategy

- Unit: IMS client token refresh, error classification, payload builders
- Integration: mocked Adobe API, verify tool signatures + error paths
- Contract: OpenAPI spec validation for each Adobe service
- E2E: real Adobe API calls against isolated `bla-adobe-services-dev` project (only when creds are provisioned — post Phase 0.A)
- Fixture-based: golden Workfront task JSON, golden EDS publish request

---

## 10. Open questions

- Workfront auth via Adobe IMS — is the access_token passed directly or does Workfront require a session exchange? Needs validation during Q6 setup
- EDS publish endpoint — is it `admin.hlx.page` or a different Adobe-branded endpoint for paid EDS tier? Verify during Q6/Q9 setup
- Webhook delivery — Workfront webhook retries on 5xx? Orchestrator must be idempotent on webhook processing
- Live publish safety — current double-gate sufficient? Consider a third gate (MFA or out-of-band approval) for v1.5
- When Firefly is added in v1.5, does it get its own OAuth project or share `bla-adobe-services-dev`? Recommend sharing since credits are per-profile not per-project
