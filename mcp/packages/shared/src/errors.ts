/**
 * Shared error hierarchy.
 *
 * Mirrors the error taxonomies in:
 *   - docs/mcp/llm-mcp-spec.md §7.1
 *   - docs/mcp/adobe-mcp-spec.md §7.1
 *   - docs/mcp/orchestrator-mcp-spec.md §8.1
 *
 * Every error carries a stable `code` enum (safe to match on) and a
 * `retryable` boolean consumed by the orchestrator retry policy.
 */

export interface BlaErrorDetails {
  readonly [key: string]: unknown;
}

export abstract class BlaError extends Error {
  abstract readonly code: string;
  abstract readonly retryable: boolean;
  readonly details?: BlaErrorDetails;

  constructor(message: string, details?: BlaErrorDetails) {
    super(message);
    this.name = this.constructor.name;
    if (details !== undefined) {
      this.details = details;
    }
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * Base auth error — extended per-store in adobe-mcp. Covers:
 *   - IMS token-refresh failure (401/invalid_grant)
 *   - EDS admin API key missing/invalid
 *   - DA.live scope unresolved at boot
 */
export class AuthError extends BlaError {
  readonly code = 'auth_fail';
  readonly retryable = false;
}

/**
 * Live publish triple-gate failure (NFR §6.2).
 * Any one of (BLA_ALLOW_LIVE_PUBLISH env, per-brief flag, per-call confirm_live)
 * being false raises this. Fail-closed on unreadable state.
 */
export class LivePublishUnauthorizedError extends BlaError {
  readonly code = 'live_publish_unauthorized';
  readonly retryable = false;
}

/**
 * Per-brief or per-day cost cap breach (llm-mcp §8.3).
 * Raised at the projection step, before any Anthropic call.
 * Also raised fail-closed when cost-ledger read is unavailable.
 */
export class CostCapExceededError extends BlaError {
  readonly code = 'cost_cap_exceeded';
  readonly retryable = false;
}

/**
 * Brief validation failure (orchestrator §8.5, llm-mcp §8.1).
 * Returned synchronously from `orchestrator.submit_brief` with ajv-style
 * error paths; also used when a voice.json invalidation propagates at
 * lazy-read time.
 */
export class BriefInvalidError extends BlaError {
  readonly code = 'brief_invalid';
  readonly retryable = false;
}

/**
 * Placeholder for every MCP app's `src/index.ts` until Sprint 2 replaces
 * each with real entry points. Intentionally loud so CI and the orchestrator
 * never accidentally "succeed" against a stub.
 */
export class NotImplementedError extends BlaError {
  readonly code = 'not_implemented';
  readonly retryable = false;
}
