/**
 * Event type + signature stub.
 *
 * Implements the shape pinned in `docs/mcp/orchestrator-mcp-spec.md` §8.4.1
 * (Patch 2.2 / finding H3). The signature formula:
 *
 *   event_signature = SHA-256(JCS_canonical_json({
 *     source, event_id, event_time_utc_iso, entity_id
 *   }))
 *
 * - Canonicalization: RFC 8785 JSON Canonicalization Scheme (JCS).
 * - Hash: SHA-256, output as lowercase hex, 64 chars.
 * - Timestamp: ISO-8601 `Z`, milliseconds TRUNCATED (not rounded).
 *
 * v0 Sprint 1 ships the type + stub; Sprint 2 wires in `jsonc-canonicalization`
 * (or equivalent) + `node:crypto` createHash.
 */

import { NotImplementedError } from './errors.js';

export type EventSource = 'workfront' | 'eds' | 'manual';

export interface Event {
  readonly source: EventSource;
  /** Provider-issued ID. Workfront: event.new.ID; EDS: x-cdn-request-id; manual: UUID. */
  readonly event_id: string;
  /** ISO-8601 UTC `Z`. Milliseconds truncated. Example: `2026-04-19T14:07:23Z`. */
  readonly event_time_utc_iso: string;
  /** brief_id when bound; Workfront task_id when brief not yet resolved. */
  readonly entity_id: string;
}

/**
 * Compute the dedup signature for an event.
 *
 * Returns lowercase hex SHA-256 of the JCS-canonical JSON of the 4-field
 * object. Used by `webhook_events.event_signature CHAR(64) UNIQUE` — see
 * orchestrator-mcp-spec §4 schema.
 *
 * Stub until Sprint 2. Calling now throws `NotImplementedError` with a
 * pointer to the spec so the implementer knows where to look.
 */
export function eventSignature(_event: Event): string {
  throw new NotImplementedError(
    'eventSignature not yet implemented — see docs/mcp/orchestrator-mcp-spec.md §8.4.1',
  );
}
