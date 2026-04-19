# Adobe MCP — Spec v0

**Status:** v0 — ready to implement (task #57)
**Owner:** J
**Last updated:** 2026-04-19
**Related:** PRD v2 §3.1 + §6.1, `docs/NFR-PERFORMANCE-TARGETS-v0.md` §1.2, `docs/brief-schema-v0.md`, `docs/mcp/orchestrator-mcp-spec.md`, `docs/mcp/llm-mcp-spec.md`

---

## 1. Overview

**Purpose.** Unified MCP wrapping Adobe services behind a single auth surface. v0 scope compressed to **Workfront + EDS** per PRD v2's piping-first pivot. Firefly/Content-Tagging/Photoshop/etc. are additive modules in v1.5+.

**Scope v0.**
- **Workfront API v21** — task CRUD, status transitions, comments, event subscriptions.
- **Edge Delivery Services admin API** — preview publish, live publish (gated), config read.
- **DA.live source API** — write block-structured content into the authoring tree.
- **Adobe IMS S2S OAuth** — single auth flow for Workfront. (Note: EDS does NOT use IMS — see §3.3.)

**Explicitly out of scope for v0 (deferred to v1.5+).**
- Firefly API (image generation).
- Content Tagging API.
- Photoshop / Illustrator / InDesign / Lightroom / Substance 3D APIs.
- Frame.io V4 API.
- Audio & Video API.
- Cloud Manager (infra ops — J handles manually in v0).

---

## 2. Tool surface

MCP tool names use the pattern `<service>.<verb_noun>`. Services: `workfront`, `eds`, `da` (DA.live).

### 2.1 Workfront module

**`workfront.create_task`**
```ts
interface CreateTaskInput {
  brief_id: string;
  template_id: string;              // Workfront template ID, must start with `BLA_`
  project_id?: string;              // optional override; default = template's linked project
  name: string;                     // rendered `[BLA] {name}` — prefix auto-applied if missing
  description: string;              // markdown; rendered as Workfront HTML
  assignees_ordered: string[];      // emails, in approval_chain order
  due_date: string;                 // ISO-8601
  custom_fields?: Record<string, string>; // BLA_* prefix enforced (see §8.1)
  request_id?: string;              // idempotency
}

interface CreateTaskOutput {
  task_id: string;                  // Workfront objCode:TASK GUID
  workfront_url: string;            // canonical `/tasks/<id>/overview` URL
  assigned_to: string;              // email of first assignee
}
```

Template naming convention (per PRD v2 §4): `BLA_FlywheelReview`, `BLA_LegalSignoff`, `BLA_BrandApproval`. MCP validates the template name has `BLA_` prefix at startup (see §8.1) and refuses to issue `create_task` against a non-BLA template.

**`workfront.update_status`**
```ts
interface UpdateStatusInput {
  task_id: string;
  status: "IN_PROGRESS" | "BLOCKED" | "APPROVED" | "REJECTED" | "DONE";
  comment?: string;                 // appended as a system comment
  request_id?: string;
}

interface UpdateStatusOutput {
  task_id: string;
  status: string;
  updated_at: string;               // ISO-8601 from Workfront
}
```

Status values map to Workfront's built-in `status` field (`NEW`, `INP`, `CPL` etc.) via an internal enum map. `APPROVED` and `REJECTED` are surface labels; they map to Workfront `approvalStatus` transitions.

**`workfront.add_comment`**
```ts
interface AddCommentInput {
  task_id: string;
  comment_text: string;             // markdown, Workfront renders HTML
  author_email?: string;            // defaults to service account
  request_id?: string;
}

interface AddCommentOutput {
  comment_id: string;
  created_at: string;
}
```

**`workfront.subscribe_event`**
```ts
interface SubscribeEventInput {
  // v21 uses object-type + event-type subscriptions, NOT per-task.
  object_type: "TASK" | "PROJECT" | "ISSUE" | "DOCUMENT";
  event_types: Array<"CREATE" | "UPDATE" | "DELETE" | "SHARE">;
  filter_expression?: string;       // Workfront filter, e.g. "status=APPROVED"
  callback_url: string;             // must be HTTPS, Orchestrator's webhook endpoint
  request_id?: string;
}

interface SubscribeEventOutput {
  subscription_id: string;
  client_certificate_info: {
    // Workfront presents an x509 client cert; endpoint must validate it.
    expected_issuer: string;
    expected_cn: string;
  };
}
```

**Important finding.** Workfront event subscriptions are **org/object-level, NOT per-task.** You subscribe to "all TASK.UPDATE events" and filter in the callback (or via the optional `filter_expression`). The v0 subscribe call is one-per-event-type, set up at MCP startup, not per brief. Source: [Workfront Event Subscriptions](https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-api/event-subscriptions/event-sub-retries).

**Authentication.** Workfront uses **mutual TLS** (client-certificate presented by Workfront) for webhook delivery, NOT HMAC. Our webhook endpoint must terminate TLS somewhere that exposes the peer cert. See §8.4.

Source: [Workfront event-sub certs](https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-api/api-notes/event-sub-certs).

### 2.2 EDS admin module

**`eds.publish_preview`**
```ts
interface PublishPreviewInput {
  brand_id: string;                 // pathed into target URL
  brief_id: string;                 // uniqueness
  page_target: "home" | "pdp" | "campaign-lander";
  content_payload: BlockStructuredContent;  // See §4.4 content shape
  request_id?: string;
}

interface PublishPreviewOutput {
  preview_url: string;   // e.g. https://main--BLA--Xoery1234.aem.page/bla-demo/<brand>/<brief_id>/<page_target>
  content_source_url: string;       // DA.live source URL for the written doc
  published_at: string;
}
```

Behavior:
1. Write content to DA.live at canonical path `/bla-demo/{brand_id}/{brief_id}/{page_target}` via `da.update_source` (§2.3).
2. POST `https://admin.hlx.page/preview/Xoery1234/BLA/main/bla-demo/{brand_id}/{brief_id}/{page_target}` to trigger preview build.
3. Poll `GET admin.hlx.page/status/...` until preview build = `published` (max 60s).
4. Return preview URL.

**`eds.publish_live`**
```ts
interface PublishLiveInput {
  brand_id: string;
  brief_id: string;
  page_target: "home" | "pdp" | "campaign-lander";
  confirm_live: true;      // caller must literally pass `true`
  request_id?: string;
}

interface PublishLiveOutput {
  live_url: string;
  published_at: string;
}
```

**Double-gate (PRD v2 §4 safety invariant, non-negotiable):**
- Env flag `BLA_ALLOW_LIVE_PUBLISH=true` must be set on the Adobe MCP process.
- Input field `confirm_live` must literally equal `true`.
- AND the brief stored in orchestrator must carry `allow_live_publish: true` (orchestrator cross-checks before calling this tool — see `orchestrator-mcp-spec.md` §9).
- If any gate fails, return HTTP 403 with `LivePublishUnauthorizedError` + log at WARN.

v0 for Revlon demo: **live publish gates remain OFF**. Tool is callable (returns 403) to prove the wiring end-to-end without risk.

**`eds.get_config`**
```ts
interface GetConfigInput {
  brand_id: string;                 // informational only — BLA uses one repo
}
interface GetConfigOutput {
  config: Record<string, unknown>;  // parsed `helix-config` response
  apikeys: Array<{ id: string; description: string; expires_at?: string }>;
}
```

Read-only. Calls `GET https://admin.hlx.page/config/Xoery1234/sites/BLA/content.json`. Used by orchestrator for diagnostics and by a startup smoke test.

### 2.3 DA.live module

**`da.update_source`**
```ts
interface UpdateSourceInput {
  path: string;                     // `/bla-demo/{brand}/{brief_id}/{page}`
  content_type: "html" | "markdown";
  body: string;                     // serialized authored content per EDS doc conventions
  request_id?: string;
}
interface UpdateSourceOutput {
  da_url: string;
  updated_at: string;
}
```

Calls `POST https://admin.da.live/source/Xoery1234/BLA/{path}` with IMS user-backed bearer token (see §3.4).

**`da.get_source`**
```ts
interface GetSourceInput { path: string; }
interface GetSourceOutput { body: string; content_type: string; etag?: string; }
```

Read-only — used by orchestrator to diff before overwriting and by tests to assert write success.

Source: [DA.live developer docs](https://docs.da.live/developers) + [da-admin open source](https://github.com/adobe/da-admin) (authoritative API shape).

---

## 3. Auth

Single Dev Console project: `bla-adobe-services-dev` (to be created when Q6 Workfront setup kicks off — NOT created in v0 piping-first phase). Binds to product profiles `BLA Workfront Dev` and (future) `BLA EDS Dev`.

**Critical finding.** Despite PRD v2 §2's "unified Adobe IMS S2S OAuth" framing, **Edge Delivery Services does NOT use Adobe IMS.** EDS admin API uses its own API key scheme. DA.live uses IMS but via user-backed tokens, not S2S. This means Adobe MCP has **three distinct auth stores**:

| Service | Auth scheme | Secret source |
|---|---|---|
| Workfront | Adobe IMS S2S OAuth (access_token as Bearer) | `/bla/dev/adobe/services/` |
| EDS admin | Admin-scoped API key | `/bla/dev/adobe/eds-admin/` |
| DA.live source | IMS user-backed refresh token via `darkalley` client | `/bla/dev/adobe/da-live/` |

This is a deviation from the PRD's one-auth-flow model. Flagging to J — see §11 known gaps. It does not block v0 and the cost is one extra secret path; still worth knowing when documenting the architecture.

Source: [EDS admin API keys](https://www.aem.live/docs/admin-apikeys).

### 3.1 Adobe IMS S2S OAuth (Workfront)

- **Token endpoint:** `POST https://ims-na1.adobelogin.com/ims/token/v3`
- **Grant type:** `client_credentials`
- **Form body** (in request body, NOT query string — Adobe docs explicitly warn against URL-logging): `grant_type=client_credentials`, `client_id`, `client_secret`, `scope`
- **Scope format:** **Adobe uses comma-separated scopes** in a single `scope` param (not space-separated, unlike generic OAuth 2.1). Scope string for Workfront: `openid,AdobeID,profile,additional_info.projectedProductContext`. **There is no `workfront_api` scope** — authorization is enforced by the product profile attached to the credential in Dev Console.
- **Response:** `{"access_token":"…","token_type":"bearer","expires_in":86399}` (~24h).
- **Token caching:** in-memory per process, TTL `expires_in - 300s` (refresh 5 min before expiry). Proactive refresh on next request if within 60s of expiry.

Gotcha: most OAuth 2.1 libraries default to space-separated scopes and will silently get `invalid_scope` from IMS. Override the separator in `packages/shared/ims-client`.

Source: [Adobe IMS S2S](https://developer.adobe.com/developer-console/docs/guides/authentication/ServerToServerAuthentication/ims).

### 3.2 Workfront API auth

Pass the IMS access_token as `Authorization: Bearer <token>` on the Workfront REST base URL `https://<tenant>.my.workfront.com/attask/api/v21.0/...`. **No session-exchange step** — older `sessionID` flow is deprecated for IMS-enabled Workfront orgs. The Technical Account associated with the Dev Console credential auto-provisions as a Workfront user and inherits permissions from that user record.

Source: [Workfront API auth guide](https://developer.adobe.com/workfront-apis/guides/gaining-access/).

### 3.3 EDS admin API key

Separate from IMS. Create via one-time admin call:
```
POST https://admin.hlx.page/config/Xoery1234/sites/BLA/apiKeys.json
```

Key returned once; stored in Infisical at `/bla/dev/adobe/eds-admin/api_key`. Pass as `Authorization: Bearer <key>` OR `X-Auth-Token: <key>` on subsequent admin calls.

**Rotation:** quarterly via the same admin endpoint (POST creates new, DELETE revokes old). Keep a 24h overlap for zero-downtime rotation.

Source: [EDS admin API keys](https://www.aem.live/docs/admin-apikeys).

### 3.4 DA.live auth

IMS-backed bearer token. DA.live uses a fixed IMS client `darkalley` with a fixed scope string, sourced from [`adobe/da-live/scripts/scripts.js`](https://github.com/adobe/da-live/blob/main/scripts/scripts.js) (public repo) — verified 2026-04-19. See `docs/da-live-scope-query-2026-04-19.md` for resolution + auth-flow details.

**OAuth config:**

```
ims_client_id: darkalley
ims_scope:     ab.manage,AdobeID,gnav,openid,org.read,read_organizations,session,
               aem.frontend.all,additional_info.ownerOrg,
               additional_info.projectedProductContext,account_cluster.read
```

Comma-separated scopes on the wire (Adobe IMS convention — reuses `packages/shared/ims-client` separator handling from §3.1). Token endpoint: same as Workfront (§3.1).

**Token acquisition (v0 approach — user-backed refresh):**

`darkalley` is a browser-oriented client; v0 obtains a long-lived refresh token via a one-time interactive OAuth flow (owner: J), stores it in Infisical, and uses it for subsequent access-token refreshes. S2S (technical-account) variant explored in parallel (Phase 1 Sprint 2, non-blocking) — if Developer Console exposes `darkalley` for S2S provisioning, we switch. Fallback stays the service-user refresh-token model.

**Startup behavior (guards against operator misconfig):**

| `BLA_DA_LIVE_ENABLED` | `/bla/dev/adobe/da-live/*` secrets populated | Behavior |
|---|---|---|
| `true` | any required key missing | **Adobe MCP refuses to boot.** Clear error naming the missing key, references this §3.4. Exit code 78 (EX_CONFIG). |
| `true` | complete | Adobe MCP boots normally; `da.*` tools active. |
| `false` | any | Adobe MCP boots with DA.live module **disabled**. Orchestrator degrades gracefully: `eds.publish_preview` writes content via an alternate path (pre-placed assets / direct filesystem write in the `bla-demo` repo). Revlon demo is unaffected. |

Fail-fast is intentional — silent misconfig at startup would otherwise surface as an opaque 401 or 403 later, during the first demo call. Named exit-code rejection is faster to diagnose.

**Secret path `/bla/dev/adobe/da-live/` (v0):**
- `client_id` — static value `darkalley` (stored for rotation parity, not rotatable in practice)
- `scope` — static comma-separated scope string (same rationale)
- `service_user_email` — DA.live service user identity
- `refresh_token` — long-lived refresh token from initial browser OAuth (v0)

Storing the static values in Infisical rather than hardcoding preserves symmetry with other credential paths and gives us a single rotation surface if Adobe ever changes the client or scope.

**Still characterize on first production calls (non-blocking):**
- **Access token TTL** — decode JWT `exp - iat` on first successful refresh; log as `adobe_mcp_da_token_ttl_seconds` gauge, align refresh cadence accordingly.
- **Rate limits** — observe `X-RateLimit-*` / `Retry-After` headers; feed `adobe_mcp_requests_total{service="da",status="rate_limit"}`. Characterize empirically (same approach as Workfront REST, §4.1).

### 3.5 Secret paths (Infisical)

Per PRD v2 §4 isolation protocol and [Infisical folder rules](https://infisical.com/docs/documentation/platform/folder) (folder names: letters, numbers, dashes — no underscores):

```
/bla/dev/adobe/services/        # Workfront IMS S2S
  client_id
  client_secret
  org_id
  technical_account_id
  workfront_tenant              # <tenant>.my.workfront.com
/bla/dev/adobe/eds-admin/       # EDS admin key (rotatable)
  api_key
  github_owner                  # Xoery1234
  github_repo                   # BLA
/bla/dev/adobe/da-live/         # DA.live user-backed refresh flow
  client_id                     # static: "darkalley"
  scope                         # static: comma-separated scope string (§3.4)
  service_user_email            # DA.live service user identity
  refresh_token                 # long-lived token from initial browser OAuth
```

Prod paths mirror with `/bla/prod/adobe/...`.

### 3.6 Rotation policy

- **IMS client secret:** 90 days. Adobe Dev Console supports two side-by-side secrets — overlap 24h, rotate, revoke old.
- **EDS admin API key:** quarterly. POST/DELETE rotation with 24h overlap.
- **DA.live refresh token:** rotation cadence TBD per observed access-token TTL; interim align with IMS (90 days). Rotation requires re-running the one-time browser OAuth flow — document in operator runbook.

Calendar cron entries owned by J. Monitor expiry via `adobe_mcp_credential_days_until_expiry` gauge (§6).

---

## 4. External dependencies

### 4.1 Workfront REST v21

- **Base URL:** `https://<tenant>.my.workfront.com/attask/api/v21.0`
- **API version:** v21 (released 2025-10-23). v20 supported through 28.4 release (April 2028) — we start on v21.
- **Breaking changes from v20:**
  - Event Subscriptions v2 is default; multi-select fields always-array (previously sometimes scalar).
  - `AssignmentBillingRole` object + fields removed.
- **Rate limits:** Not officially published for core `/attask` REST. Empirical limits enforced via 429/503. **Policy: assume undocumented throttling; build backoff on 429/503 and do not budget to a known RPS.** Fusion-layer webhook rate limit is 100 req/s (relevant only if we route through Fusion — we don't).
- **Event subscription retries:** 11 retries over ~48h on non-2xx. First retry ~1.5 min, escalating.
- **Webhook delivery timeout:** endpoint must return 2xx within **5 seconds** or the delivery counts as failed.

Sources:
- [Workfront v21 release notes](https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-api/api-notes/new-api-version-21)
- [Event subscription retries](https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-api/event-subscriptions/event-sub-retries)

### 4.2 Edge Delivery Services admin API

- **Base URL:** `https://admin.hlx.page/` (unchanged despite `hlx.live → aem.live` rebrand — admin control plane kept the `admin.hlx.page` hostname).
- **Key endpoints:**
  - `POST /preview/{org}/{repo}/{ref}/{path}` — preview publish.
  - `POST /live/{org}/{repo}/{ref}/{path}` — live publish.
  - `DELETE /preview/...` / `DELETE /live/...` — unpublish.
  - `GET /status/{org}/{repo}/{ref}/{path}` — build status.
  - `GET /config/{org}/sites/{site}/content.json` — config read.
- **Rate limits:** 200 req/s per source IP across `*.aem.live`, `*.aem.page`, `admin.hlx.page`. Excess returns `429`. Upstream throttling wraps as `503` with `x-error: (429) <message>` header — **parse `x-error` before treating a 503 as genuine server error**, otherwise retry loops will hammer an already-throttled service.
- **Auth:** API key per §3.3.

Sources:
- [EDS architecture](https://www.aem.live/docs/architecture)
- [EDS rate limits](https://www.aem.live/docs/limits)

### 4.3 DA.live source API

- **Base URL:** `https://admin.da.live/source/{org}/{repo}/{path}`
- **Methods:** `GET` (read), `POST`/`PUT` (write), `DELETE` (remove).
- **Auth:** IMS-backed bearer (§3.4).
- **Path convention:** mirrors the public preview path. `/bla-demo/{brand}/{brief_id}/{page}` in DA maps to the preview URL at the same pathname.

Authoritative shape: verify against [`adobe/da-admin` repo](https://github.com/adobe/da-admin) route definitions before shipping — docs.da.live is thin.

### 4.4 Content payload shape

`content_payload` passed to `eds.publish_preview` is a normalized block-structured form:

```ts
interface BlockStructuredContent {
  page_metadata: {
    title: string;
    description: string;
    template: string;                // e.g. "pdp"
    brand: string;                   // e.g. "revlon"
  };
  blocks: Array<{
    block_name: string;              // e.g. "product-hero", one of the 8 block types
    block_options?: string[];        // e.g. ["h1"] — maps to da.live block-name class suffixes
    content: Record<string, unknown>; // block-specific, matches the block's model in _<name>.json
  }>;
}
```

MCP serializes `blocks[]` into DA.live's authored document shape (table-per-block convention) and writes it to the source path. The `block_name` + field names must exactly match the `_<name>.json` UE component-definition models in `/blocks/*`.

---

## 5. Internal dependencies

Shared packages (same Turborepo layout as LLM MCP):

| Package | Purpose |
|---|---|
| `packages/shared/ims-client` | Adobe IMS S2S client with token caching + comma-separated scope handling |
| `packages/shared/http-retry` | Exponential backoff + jitter, respects `Retry-After`, per-service policies |
| `packages/shared/circuit-breaker` | Per-service circuit breakers |
| `packages/shared/mtls-server` | Webhook endpoint TLS termination exposing peer cert (for Workfront mTLS) |
| `packages/shared/telemetry` | OTLP emitter |
| `packages/shared/infisical-client` | Universal Auth machine-identity wrapper (shared with LLM MCP) |
| `packages/shared/errors` | `AdobeMcpError` hierarchy (§7.1) |
| `packages/shared/da-serializer` | Block-structured content → DA.live authored HTML |

---

## 6. Observability

All metrics tagged by `service` label (`workfront` | `eds` | `da` | `ims`) — per the per-module routing inside Adobe MCP.

### 6.0 Latency SLOs (per NFR §1.2)

| Tool | v0 P95 | v1 P95 |
|---|---|---|
| `workfront.create_task` | ≤ 3s | ≤ 2s |
| `workfront.update_status` | ≤ 1.5s | ≤ 1s |
| `workfront.add_comment` | ≤ 1.5s | ≤ 1s |
| `workfront.subscribe_event` | ≤ 3s | ≤ 2s |
| `eds.publish_preview` | ≤ 10s | ≤ 6s |
| `eds.publish_live` | ≤ 10s | ≤ 6s |
| `eds.get_config` | ≤ 1s | ≤ 500ms |
| `da.update_source` | ≤ 5s | ≤ 3s |
| `da.get_source` | ≤ 1s | ≤ 500ms |

Measured via `adobe_mcp_latency_seconds{service,tool}` P95. Grafana alert on 5-min breach.


### 6.1 Metrics

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `adobe_mcp_requests_total` | counter | `service`, `tool`, `status` | `status ∈ {ok, auth_fail, rate_limit, not_found, validation_fail, service_unavailable, timeout, unknown}` |
| `adobe_mcp_latency_seconds` | histogram | `service`, `tool` | Buckets: `.1, .25, .5, 1, 2.5, 5, 10, 30` |
| `adobe_mcp_retries_total` | counter | `service`, `tool`, `reason` | `reason ∈ {rate_limit, 5xx, network}` |
| `adobe_mcp_circuit_state` | gauge | `service` | `0=closed, 1=open, 2=half-open` |
| `adobe_mcp_ims_token_refresh_total` | counter | `proactive` | `proactive ∈ {true, false}` |
| `adobe_mcp_ims_token_seconds_remaining` | gauge | (none) | For expiry alerting. |
| `adobe_mcp_credential_days_until_expiry` | gauge | `credential` | `credential ∈ {ims_client_secret, eds_api_key, da_refresh_token}` — alert at ≤14d |
| `adobe_mcp_da_token_ttl_seconds` | gauge | (none) | Observed DA.live access-token TTL from JWT `exp - iat`; characterization aid. |
| `adobe_mcp_webhook_received_total` | counter | `verified` | mTLS cert verification result |
| `adobe_mcp_eds_publish_total` | counter | `mode`, `gate_passed` | `mode ∈ {preview, live}`, `gate_passed ∈ {true, false}` |
| `adobe_mcp_workfront_subscription_active` | gauge | `object_type`, `event_type` | Confirms our subscriptions are live |

### 6.2 Traces

Span-per-tool-call. Root-span attributes:
- `bla.brief_id`, `bla.brand_id`, `bla.tool_name`
- `adobe.service` — `workfront | eds | da`
- `adobe.request_id` — Workfront returns `X-Request-ID`, EDS returns `x-cdn-request-id`
- `http.request.method`, `http.response.status_code`, `url.full`

Child spans for auth (`ims.token_refresh`), retries (`http.retry`), payload serialization (`da.serialize`).

### 6.3 Logs

Structured JSON to stdout. Labels: `service`, `env`, `level`.

**Security redaction (mandatory):**
- Never log `x-api-key`, `Authorization`, `client_secret`, raw IMS tokens, DA.live refresh tokens. Redact to `<redacted:16>`.
- Never log webhook `X-Client-Certificate` contents beyond subject CN.
- Brief content and generated copy at INFO are summarized (first 200 chars); full at DEBUG.

---

## 7. Error handling

### 7.1 Error class hierarchy

```ts
class AdobeMcpError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly service: "workfront" | "eds" | "da" | "ims";
  readonly http_status?: number;
  readonly adobe_request_id?: string;
  readonly details?: unknown;
}

class AuthFailError extends AdobeMcpError           { retryable = false; }  // 401, invalid_grant
class ScopeInsufficientError extends AdobeMcpError  { retryable = false; }  // 403 with scope detail
class RateLimitError extends AdobeMcpError          { retryable = true;  }  // 429 or wrapped 503
class NotFoundError extends AdobeMcpError           { retryable = false; }  // 404
class ValidationFailError extends AdobeMcpError     { retryable = false; }  // 400
class IsolationViolationError extends AdobeMcpError { retryable = false; }  // §8.1 guards
class ServiceUnavailableError extends AdobeMcpError { retryable = true;  }  // 500, 502, 503
class TimeoutError extends AdobeMcpError            { retryable = true;  }  // deadline exceeded
class LivePublishUnauthorizedError extends AdobeMcpError    { retryable = false; }  // triple-gate fail (see §8.5)
class WebhookVerifyFailError extends AdobeMcpError  { retryable = false; }  // mTLS cert invalid
class UnknownUpstreamError extends AdobeMcpError    { retryable = false; }
```

### 7.2 Retry policy

**Per-service policies:**

| Service | Retry on | Backoff | Max attempts | Deadline |
|---|---|---|---|---|
| Workfront | 429 (honor `Retry-After`), 500/502/503 | Exp. base 2s, factor 2, max 30s, jitter ±20% | 5 | 60s |
| EDS admin | 429, 503 (after parsing `x-error`) | Exp. base 1s, factor 2, max 20s | 5 | 45s |
| DA.live | 429, 5xx | Exp. base 1s, factor 2, max 20s | 3 | 30s |
| IMS | 429, 5xx | Exp. base 2s, factor 2, max 15s | 3 | 20s |

**Never retry:** 4xx (except 429 and 408), `AuthFailError`, `ScopeInsufficientError`, `IsolationViolationError`, `LivePublishUnauthorizedError`.

### 7.3 Circuit breaker

Per-service. Trip thresholds:
- Workfront: 50% error rate over 20-req sliding window OR 5 consecutive 5xx.
- EDS: 30% error rate OR 3 consecutive 5xx (tighter because rate-limit upstream wrap is deceptive).
- DA.live: 30% OR 3 consecutive 5xx.
- IMS: 50% OR 3 consecutive auth failures (separate because IMS outage takes all services with it).

Half-open after 30s, single probe, close on success.

### 7.4 Classification tree

- **`401`** → `AuthFailError` (log IMS token age, probably expired; force refresh + retry once).
- **`403` + scope mentioned in body** → `ScopeInsufficientError` (bubble up — fix Dev Console, not a retry).
- **`403` without scope detail, EDS** → `LivePublishUnauthorizedError` if call was `publish_live`; else `AuthFailError`.
- **`404`** → `NotFoundError` (bubble up).
- **`400`** → `ValidationFailError` (reject, include upstream detail).
- **`429`** → `RateLimitError` (retry with `Retry-After`).
- **`503` + `x-error: (429) …`** (EDS) → `RateLimitError`.
- **`5xx` otherwise** → `ServiceUnavailableError`.
- **Network timeout / DNS fail** → `TimeoutError`.
- **Unrecognized** → `UnknownUpstreamError` (log loudly, alert).

---

## 8. Safety guardrails

### 8.1 Isolation-protocol enforcement (PRD v2 §4, hard rules)

MCP refuses at tool-call time:

**Workfront:**
- `create_task` template must start with `BLA_`. Otherwise → `IsolationViolationError`.
- Task name rendered with `[BLA] ` prefix if not already present.
- Custom fields must start with `BLA_` prefix. Otherwise → `IsolationViolationError`.

**EDS:**
- All publish paths must be under `/bla-demo/*` or `/{brand}/bla-*/*` (v0 uses `/bla-demo/` exclusively).
- `publish_live` additionally gated per §2.2.

**DA.live:**
- Writes refused outside `/bla-demo/*`.

**Startup check:** MCP validates on boot that its bound product profile is exactly `BLA Workfront Dev` (via `GET /people/me` on Workfront) and the EDS org/repo is `Xoery1234/BLA`. Mismatch → fail startup with explicit error.

### 8.2 Scope audit

On startup, call IMS `/ims/validate_token` equivalent (or issue a known-scope test call) and log which scopes the current token advertises. If required scopes missing → fail startup.

### 8.3 Rate-limit pre-check

Before a downstream call, check local budget counter (§6 metrics feed this). If consecutive 429s exceed threshold → short-circuit with `RateLimitError` rather than hit the service.

### 8.4 Webhook authentication (mTLS)

Workfront webhooks use mTLS, not HMAC. Implementation:
1. Adobe MCP embeds (or has upstream) a TLS terminator that extracts the client certificate and passes its subject CN + issuer CN via `X-Client-Subject` / `X-Client-Issuer` headers.
2. `mtls-server` package validates those against the expected values from `subscribe_event` response (stored per subscription in memory + Postgres for restart survival).
3. On mismatch → return 401, increment `adobe_mcp_webhook_received_total{verified="false"}`, log at WARN.

The optional `authToken` header echoed by Workfront is also validated as a belt-and-suspenders check.

**Replay defense (clock skew tolerant):**
- Inbound webhooks are deduplicated by `event_signature = sha256(eventTime || objectId || newStatus)` at orchestrator (see `orchestrator-mcp-spec.md` §8.4).
- Acceptance window for `eventTime`: **±10 minutes** from current server time. Rejects events older than 10 minutes (suspected replay) and events from > 10 minutes in the future (suspected clock skew attack or misconfig).
- Clock skew: we assume VPS clocks within 60s of UTC via NTP. 10-minute window tolerates meaningful skew while still rejecting clear replays.

### 8.5 Live publish triple gate (fail-closed)

Three independent gates. ALL required for `eds.publish_live` to succeed.

| # | Gate | Owner | Where enforced |
|---|---|---|---|
| 1 | Env var `BLA_ALLOW_LIVE_PUBLISH=true` | Adobe MCP process env | Adobe MCP startup + per-call |
| 2 | Input `confirm_live: true` | Caller (orchestrator) | Adobe MCP per-call |
| 3 | Brief `allow_live_publish: true` | Orchestrator (brief schema) | Orchestrator per-call (see `orchestrator-mcp-spec.md` §9.4) |

**Fail-closed on unreadable gate state:**
- If env var unreadable (process-env corruption is improbable but worth naming) → treat as `false`.
- If input field missing → treat as `false` (NOT as default-true).
- If brief metadata unreachable (orchestrator DB down) → orchestrator returns error BEFORE calling this tool; Adobe MCP never sees a gated call with missing brief state.

**Any one gate failing → `LivePublishUnauthorizedError` (retryable: false).**

**Audit log (always, even on rejection):**
- Every call to `eds.publish_live` — accepted or rejected — writes a structured log line at INFO including:
  - `brief_id`, `brand_id`, `page_target`
  - `gate_1_env_flag`, `gate_2_input_ack`, `gate_3_brief_flag` (each true/false)
  - `result` = `accepted | rejected`
  - `rejected_reason` if any gate false
  - `caller_identity` (Infisical machine identity of the calling orchestrator)
- Log is forwarded to Loki under label `bla.audit=live_publish`. Retention: forever (audit-grade).

**v0 for Revlon demo:** gates #1 and #3 both OFF. `eds.publish_live` is reachable but always returns `LivePublishUnauthorizedError`. Verifies wiring without risk.

**Bypass paths checked:**
- `eds.publish_preview` does NOT call through `eds.publish_live` internally — preview and live are independent code paths.
- No testing shortcut; `publish_live` is the only path. Tests verify rejection by passing partial gates.
- Staging env defaults `BLA_ALLOW_LIVE_PUBLISH=true` (so we can test the happy path); prod env defaults `false`. **Never the reverse** (per NFR §11 trade-off note).

#### 8.5.1 Emergency kill switch (H7 — gate 0)

Independent of and **evaluated BEFORE** the triple-gate. A DB-backed kill switch that can disable every live publish call, organization-wide, without a deploy.

**Schema (applied to orchestrator's Postgres, see orchestrator-mcp-spec §4):**

```sql
CREATE TABLE system_flags (
  flag_name     TEXT PRIMARY KEY,
  flag_value    BOOLEAN NOT NULL,
  set_by        TEXT NOT NULL,    -- email of operator
  set_reason    TEXT NOT NULL,
  set_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed row required at deploy:
INSERT INTO system_flags (flag_name, flag_value, set_by, set_reason)
VALUES ('live_publish_kill', false, 'system', 'initial seed');
```

**Enforcement.** On every `eds.publish_live` call, BEFORE the triple-gate:

```ts
const kill = await db.one<{ flag_value: boolean }>(
  `SELECT flag_value FROM system_flags WHERE flag_name = 'live_publish_kill'`,
);
if (kill.flag_value === true) {
  throw new LivePublishUnauthorizedError('kill_switch_engaged');
}
```

**Fail-closed on DB error.** If the kill-switch read fails (DB down, row missing, timeout > 500ms), **treat as `kill=true`**:

```ts
try {
  // ... read above
} catch (err) {
  logger.error({ err, bla_audit: 'kill_switch_read_fail' });
  throw new LivePublishUnauthorizedError('kill_switch_read_unavailable');
}
```

Rationale: live publish under "we can't tell if it's safe" defaults to blocked. Restoring DB connectivity is a minutes-scale problem; a mistaken live publish during that window is a multi-hour incident.

**Flipping the switch** is a manual DB write, gated only by operator access:

```sql
UPDATE system_flags
   SET flag_value = true,  -- or false to unblock
       set_by = '<operator-email>',
       set_reason = '<free-text reason>',
       set_at = now()
 WHERE flag_name = 'live_publish_kill';
```

Audit trail captured by the trigger in orchestrator §3 (writes to `audit_log_publish_flags`).

**Expected flip frequency:** near-zero in v0 (live publish is off entirely). In v1+, flip to `true` during any suspected brand incident. Keep flipped until root cause identified.

#### 8.5.2 Per-brand allow list (H7 — gate 4)

Even if gates 1–3 are all green, a brand with `brands.live_publish_allowed = false` cannot live-publish. Enforced at the orchestrator level (orchestrator §9.4 extension) AND reconfirmed at Adobe MCP before the downstream call.

**Schema addendum to orchestrator §4:**

```sql
-- Brand registry table (created if not present):
CREATE TABLE IF NOT EXISTS brands (
  brand_id             TEXT PRIMARY KEY,         -- e.g. 'revlon'
  display_name         TEXT NOT NULL,
  live_publish_allowed BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Default: `false`.** Flipping to `true` for a brand is a manual DB write with audit trigger (§3 of orchestrator — see `audit_log_publish_flags`).

**v0 default state for Revlon:** `live_publish_allowed = false`. Demo publishes to `bla-demo` preview only; production Revlon never receives a v0 publish.

**Full gate evaluation order (all must pass, in this order):**

| Order | Gate | Evaluator |
|---|---|---|
| 0 | `system_flags.live_publish_kill = false` | Adobe MCP |
| 1 | `BLA_ALLOW_LIVE_PUBLISH=true` env | Adobe MCP |
| 2 | `confirm_live: true` input | Adobe MCP |
| 3 | `briefs.allow_live_publish = true` | Orchestrator |
| 4 | `brands.live_publish_allowed = true` | Orchestrator + Adobe MCP double-check |

Gate 0 short-circuits the rest. Gate 4 is evaluated twice (orchestrator before calling Adobe MCP, Adobe MCP before calling EDS) so a compromised orchestrator can't bypass by forging a request — the Adobe MCP reads the brand row itself.

### 8.6 Idempotency

Every tool call accepts `request_id`. MCP caches `(request_id → response)` for 10 minutes in-memory; replay returns cached response with `X-Replayed: true` header-equivalent field in the MCP response metadata.

---

## 9. Testing strategy

### 9.1 Unit tests
- `ims-client`: scope separator (commas not spaces), token refresh timing, proactive refresh threshold.
- `http-retry`: per-service policy application, `Retry-After` parsing, EDS `x-error` wrapping detection.
- `circuit-breaker`: trip, half-open probe, close, independent per service.
- `da-serializer`: block-structured → DA HTML round-trips golden files.
- Isolation guards: every prefix check, every path check.

### 9.2 Integration tests
- Mocked Adobe APIs (`msw` or `nock`):
  - IMS token exchange round-trip.
  - Workfront task create, update status, add comment, subscribe.
  - EDS preview publish → status poll → return.
  - EDS live publish → triple-gate rejection (each of the 3 gates tested independently via the 7-row matrix in NFR §6.2.1).
  - DA.live write + read.
  - 429 triggers backoff on each service.
  - 503 + `x-error:(429)` on EDS classified as `RateLimitError`, not `ServiceUnavailableError`.

### 9.3 Contract tests
- Tool input/output zod schemas derived from TypeScript interfaces in §2.
- Isolation-protocol rules (one test per rule).

### 9.4 E2E tests (gated — run against isolated `bla-adobe-services-dev`)
- Only run when IMS creds provisioned (post-Phase 0.A).
- Fixtures: `packages/shared/__fixtures__/workfront-task.json`, `…/eds-publish-request.json`, `…/da-source-write.json`.
- Budget cap: 10 Workfront test tasks per test run; cleaned up in `afterAll`.

### 9.5 mTLS webhook tests
- Standalone test using local cert authority (generate CA, sign Workfront-shaped cert, reject others).
- Expired cert → `WebhookVerifyFailError`.
- Wrong CN → `WebhookVerifyFailError`.
- Missing cert → 401.

### 9.6 Chaos tests
- Workfront 503 + `Retry-After: 60` → respects retry, one retry within 60s after deadline reset.
- EDS 503 + `x-error:(429) throttled` → single retry at exponential backoff, not hammering.
- IMS token expiry during in-flight request → proactive refresh kicks in, request succeeds without 401.
- mTLS cert missing → 401 + metric.
- Circuit breaker open → fail-fast without upstream call.

---

## 10. Resolved decisions

| Question | v0 decision | Rationale |
|---|---|---|
| Workfront IMS → Bearer vs sessionID | **Bearer directly**, no session exchange. | Verified: IMS-enabled orgs accept IMS access_token as Bearer on `/attask/api/v21.0`. |
| Webhook per-task vs org-level | **Org-level by `(object_type, event_type)`**; filter in callback. | Workfront v21 subscription model is object-level, not per-task. |
| EDS endpoint | **`admin.hlx.page`** (NOT `api.aem.live`). | Control plane didn't rebrand. Runtime hostnames did. |
| Live publish gate count | **Triple-gate** (env flag + input ack + brief flag). | Safety invariant. Orchestrator owns the brief-flag gate (see orchestrator §9). |
| Firefly shared project in v1.5 | **Share `bla-adobe-services-dev`**. | Credits are per product-profile, not per Dev Console project. One project = simpler rotation. |
| Scope strings Workfront | **`openid,AdobeID,profile,additional_info.projectedProductContext`**. | Verified — no distinct `workfront_api` scope exists; product-profile attachment provides authorization. |
| Scope strings DA.live | **`ab.manage,AdobeID,gnav,openid,org.read,read_organizations,session,aem.frontend.all,additional_info.ownerOrg,additional_info.projectedProductContext,account_cluster.read`** via `darkalley` client. | Sourced from `adobe/da-live/scripts/scripts.js` public repo, 2026-04-19. See §3.4. |
| Rate limit budget | **Empirical** (no published RPS for Workfront REST). Build backoff not budgeting. | Experience League doesn't publish core `/attask` RPS; Fusion tier is 100 req/s but we don't route through Fusion. |
| EDS 503 wrapping | **Parse `x-error` before retry classification.** | Otherwise retry-on-5xx loops amplify rate-limit pressure. |
| Webhook auth mechanism | **Mutual TLS + optional `authToken`** — NOT HMAC. | Verified in Workfront event-sub-certs docs. Significant impact on hosting choice. |
| JWT | **Never.** | EOL 2025-01-01 (SDK shut off). IMS S2S OAuth only. |

---

## 11. Known gaps / deferred

- **Three-auth-store deviation from PRD v2 §2.** EDS uses admin API keys (not IMS); DA.live uses IMS user-backed refresh-token flow (not pure S2S). Flag for J — the "unified Adobe IMS" architecture narrative is aspirational for EDS. Worth noting in the next PRD revision.
- **DA.live S2S path.** v0 uses user-backed refresh token via the `darkalley` client. S2S (technical-account) variant is a Phase 1 Sprint 2 exploration — if Developer Console exposes `darkalley` for S2S provisioning, we switch. Non-blocking for Revlon demo.
- **Workfront rate limits documented.** No official RPS for core REST. Build watch on `adobe_mcp_requests_total{service="workfront",status="rate_limit"}` to empirically characterize. Could be worth an SRE deep-dive in v1.
- **mTLS termination choice.** Running `mtls-server` inline in Node.js works but is fiddly behind managed load balancers. Alternative: nginx + `proxy_ssl_verify_client on` forwarding peer-cert headers. v0: inline Node (single-VPS deploy). v1 if we ever run behind a managed LB, revisit.
- **`eds.get_config` parse shape.** JSON blob unmarshalled as-is. No typed wrapper v0 — add in v1 when we care about specific keys.
- **Firefly, Content Tagging, Photoshop, Illustrator, InDesign, Lightroom, Substance 3D, Frame.io, Audio & Video.** All out of scope v0 per PRD v2 §6.1. Architectural seam is the per-service module pattern — add a new module under `src/services/<name>/` when Phase 1.5 kicks off.
- **Multi-org.** v0 assumes single tenant (Monks' IMS org). Multi-org support needs a tenancy layer in `ims-client` and per-org Infisical paths. Deferred to whenever tenant #2 lands.
- **Frame.io V4.** Entitled but off. v1.1+ wires as a sibling module; reuses the IMS client.

---

## Sources

- [Adobe IMS Server-to-Server Authentication](https://developer.adobe.com/developer-console/docs/guides/authentication/ServerToServerAuthentication/ims)
- [Workfront API — Gaining Access](https://developer.adobe.com/workfront-apis/guides/gaining-access/)
- [Workfront API v21 release notes](https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-api/api-notes/new-api-version-21)
- [Workfront Event Subscription Retries](https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-api/event-subscriptions/event-sub-retries)
- [Workfront Event Subscription Certificates (mTLS)](https://experienceleague.adobe.com/en/docs/workfront/using/adobe-workfront-api/api-notes/event-sub-certs)
- [EDS architecture](https://www.aem.live/docs/architecture)
- [EDS admin API keys](https://www.aem.live/docs/admin-apikeys)
- [EDS limits](https://www.aem.live/docs/limits)
- [DA.live developer docs](https://docs.da.live/developers)
- [adobe/da-live public repo](https://github.com/adobe/da-live)
- [da-admin open source repo](https://github.com/adobe/da-admin)
- [MCP spec 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)
- [Infisical folder naming](https://infisical.com/docs/documentation/platform/folder)
- [Grafana Alloy OTLP → LGTM](https://grafana.com/docs/alloy/latest/collect/opentelemetry-to-lgtm-stack/)
- [OTel trace semantic conventions](https://opentelemetry.io/docs/specs/semconv/general/trace/)
