# DA.live OAuth scope — RESOLVED 2026-04-19

**Status:** ✅ RESOLVED — sourced from public Adobe source code.
**Date:** 2026-04-19
**Related:** H4 in `spec-review-findings-2026-04-19.md`, `docs/mcp/adobe-mcp-spec.md` §3.4

---

## Resolution

**Source:** [`adobe/da-live/scripts/scripts.js`](https://github.com/adobe/da-live/blob/main/scripts/scripts.js) — public repo, production DA.live client.

DA.live uses a fixed IMS OAuth client with a fixed scope list. No negotiation with Adobe contacts required — the values are compiled into the public DA.live client and reused by any integration authenticating as a DA.live user.

### Scope string

```
ab.manage,AdobeID,gnav,openid,org.read,read_organizations,session,aem.frontend.all,additional_info.ownerOrg,additional_info.projectedProductContext,account_cluster.read
```

Comma-separated (Adobe IMS convention, not space-separated per generic OAuth 2.1). Pass as the `scope` param to the IMS token endpoint (`https://ims-na1.adobelogin.com/ims/token/v3`). Reuses the comma-separated-scope handling in `packages/shared/ims-client` (already specified for Workfront in `adobe-mcp-spec.md` §3.1).

### IMS client ID

```
darkalley
```

DA.live's internal codename. Registered for the DA.live client; any third-party integration authenticating to DA.live uses this client identity.

### Auth flow (from `adobe/da-live/blocks/shared/utils.js`)

1. User obtains IMS access token via standard browser OAuth flow against `darkalley` client.
2. Subsequent API calls to `admin.da.live/source/...` pass `Authorization: Bearer ${accessToken}`.
3. For AEM content operations, DA.live exchanges the IMS token for a site-scoped token via `POST ${AEM_ORIGIN}/auth/adobe/exchange` with `{ org, site, accessToken }`.
4. Origins allowed for the exchange: `da.live`, `da.page`, `admin.da.live`, `admin.hlx.page`, `admin.aem.live`.

---

## Remaining implementation questions (non-blocking)

Questions 2–4 from the original query (token lifetime, rate limits, S2S variant) are not answered by the public source, but all are characterizable without external contacts.

1. **Token lifetime.** Decode the JWT returned on first successful token call; `exp - iat` = TTL. Log observed TTL at first boot as `adobe_mcp_da_token_ttl_seconds` gauge.
2. **Rate limits.** Observe `X-RateLimit-*` and `Retry-After` response headers on first production calls. Feed `adobe_mcp_requests_total{service="da",status="rate_limit"}` metric. Characterize empirically, same approach used for Workfront REST (per `adobe-mcp-spec.md` §4.1).
3. **S2S (service account) variant.** Register a technical account on Adobe Developer Console under J's org-admin access. If Developer Console does not expose the `darkalley` client for S2S provisioning (likely — DA.live is not listed as a discoverable API product), fall back to a service-user with stored refresh token. **Owner: J, Phase 1 Sprint 2 task.**

---

## Next actions (tracked in follow-up commits)

1. ✅ Update `docs/mcp/adobe-mcp-spec.md` §3.4 — replace `**DA.live OAuth scope: PENDING**` with the scope string above.
2. ✅ Update `docs/spec-review-findings-2026-04-19.md` H4 row — mark fully CLOSED.
3. Phase 1 Sprint 2 task: implement DA.live token acquisition in Adobe MCP. Default to user-backed refresh-token flow (aligns with the `darkalley` client's browser-first design); S2S exploration runs parallel, non-blocking.

*End of resolution doc.*
