/**
 * Infisical path validator — MEDIUM finding M8.
 *
 * Infisical folder names allow letters, numbers, and dashes only — no
 * underscores, no dots, no spaces, no uppercase. PRD v2 r3 §4 isolation
 * protocol requires `/bla/{env}/...` paths and adobe-mcp §3 spells out
 * the per-store folder layout.
 *
 * This validator enforces the path hygiene so a typo at the call site
 * (`/bla/dev/adobe/work_front/...`) surfaces as a clear error instead
 * of silently 404ing at Infisical.
 *
 * Rules (matches Infisical folder-name constraints):
 * - Leading `/`.
 * - Segments separated by `/`.
 * - Each segment: `[a-z0-9-]+`, length ≥ 1, no leading/trailing dash.
 * - Total length ≤ 256.
 */

const SEGMENT_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const MAX_LENGTH = 256;

export interface PathValidationOk {
  readonly ok: true;
}

export interface PathValidationFail {
  readonly ok: false;
  readonly reason: string;
}

export type PathValidationResult = PathValidationOk | PathValidationFail;

export function validateInfisicalPath(path: string): PathValidationResult {
  if (typeof path !== 'string') {
    return { ok: false, reason: 'path must be a string' };
  }
  if (path.length === 0) {
    return { ok: false, reason: 'path must not be empty' };
  }
  if (path.length > MAX_LENGTH) {
    return { ok: false, reason: `path exceeds ${MAX_LENGTH} chars` };
  }
  if (!path.startsWith('/')) {
    return { ok: false, reason: 'path must start with "/"' };
  }
  if (path === '/') {
    return { ok: true };
  }
  if (path.endsWith('/')) {
    return { ok: false, reason: 'path must not end with "/"' };
  }

  const segments = path.slice(1).split('/');
  for (const segment of segments) {
    if (segment.length === 0) {
      return { ok: false, reason: 'path contains empty segment (consecutive "/")' };
    }
    if (!SEGMENT_RE.test(segment)) {
      return {
        ok: false,
        reason: `segment "${segment}" contains invalid characters (only a-z, 0-9, "-" allowed; no leading/trailing "-")`,
      };
    }
  }
  return { ok: true };
}

/**
 * Throwing variant for use at module boundaries where a bad path is a
 * programmer error, not a runtime condition.
 */
export function assertInfisicalPath(path: string): void {
  const result = validateInfisicalPath(path);
  if (!result.ok) {
    throw new Error(`invalid Infisical path "${path}": ${result.reason}`);
  }
}
