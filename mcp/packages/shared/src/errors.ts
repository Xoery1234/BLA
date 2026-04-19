/**
 * Stub error classes — Sprint 1 scaffold.
 *
 * Sprint 2 (step 2) replaces this with the full error hierarchy
 * mirroring docs/mcp/*.md §7.1/§8.1.
 */

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}
