/**
 * Adobe auth credentials — three stores, one discipline.
 *
 * Matches `docs/PRD-BLA-FLYWHEEL-CONNECTORS-v2.md` §2 "Auth — three stores,
 * one discipline" (r3 2026-04-19) and `docs/mcp/adobe-mcp-spec.md` §3.3–3.5.
 *
 * Each store's credentials are fetched from Infisical under the indicated
 * path using Universal Auth machine identity; see `infisical-path-validator.ts`
 * for path hygiene enforcement.
 */

/**
 * Workfront — Adobe IMS OAuth Server-to-Server (client credentials).
 * Infisical path: /bla/{env}/adobe/workfront/
 * Token endpoint: https://ims-na1.adobelogin.com/ims/token/v3
 * Scope (comma-separated, Adobe-specific format):
 *   openid,AdobeID,profile,additional_info.projectedProductContext
 */
export interface WorkfrontCreds {
  readonly kind: 'workfront-ims-s2s';
  readonly clientId: string;
  readonly clientSecret: string;
  readonly orgId: string;
  readonly technicalAccountId: string;
  /** `<tenant>.my.workfront.com` — API base becomes `https://<tenant>.my.workfront.com/attask/api/v21.0`. */
  readonly tenant: string;
}

/**
 * Edge Delivery Services admin API keys (non-IMS), scoped per site.
 * Infisical path: /bla/{env}/adobe/eds/
 * Admin base: https://admin.hlx.page/
 * Auth: Bearer <apiKey> OR X-Auth-Token: <apiKey>
 * Isolation hard rule (PRD §4): `bla-demo` site only in v0.
 */
export interface EDSCreds {
  readonly kind: 'eds-admin-api-key';
  readonly apiKey: string;
  readonly githubOwner: string;
  readonly githubRepo: string;
}

/**
 * DA.live — Adobe IMS user-backed token (on behalf of a provisioned
 * technical service user).
 *
 * H4 resolved 2026-04-19 from public adobe/da-live source
 * (see docs/da-live-scope-query-2026-04-19.md):
 *   - IMS client ID: `darkalley`
 *   - Scope (comma-separated, Adobe-specific) — see DA_LIVE_IMS_SCOPE below.
 *
 * v0 Sprint 2 implementation: user-backed refresh-token flow (aligns
 * with darkalley's browser-first design). S2S variant is a parallel
 * exploration, non-blocking.
 *
 * Infisical path: /bla/{env}/adobe/da-live/
 *
 * Startup behavior (adobe-mcp-spec §3.4):
 * - `BLA_DA_LIVE_ENABLED=true` + credentials present → module active.
 * - `BLA_DA_LIVE_ENABLED=false` → DA.live module disabled, orchestrator
 *   degrades gracefully to pre-placed-asset mode for Revlon demo.
 */
export const DA_LIVE_IMS_CLIENT_ID = 'darkalley';
export const DA_LIVE_IMS_SCOPE =
  'ab.manage,AdobeID,gnav,openid,org.read,read_organizations,session,aem.frontend.all,additional_info.ownerOrg,additional_info.projectedProductContext,account_cluster.read';

export interface DaLiveCreds {
  readonly kind: 'da-live-ims-user';
  /** Long-lived refresh token from the darkalley browser OAuth flow. */
  readonly refreshToken: string;
  /** Short-lived access token, rotated on expiry. */
  readonly accessToken: string;
  /** Email of the provisioned technical user (for audit log + site-exchange calls). */
  readonly userEmail: string;
}

/** Discriminated union of all Adobe credential shapes. */
export type AdobeCreds = WorkfrontCreds | EDSCreds | DaLiveCreds;
