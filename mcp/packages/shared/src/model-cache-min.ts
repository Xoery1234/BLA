/**
 * Per-model prompt-cache minimums.
 *
 * Authoritative lookup for Patch 1.1 / finding C1 per
 * `docs/mcp/llm-mcp-spec.md` §4.3.1.
 *
 * Values verified against platform.claude.com/docs/en/build-with-claude/prompt-caching
 * on 2026-04-19. Re-verify at each major model release.
 *
 * Prompts below the model's minimum are uncached — the padding dispatcher
 * (§4.3.2) uses this table to decide whether to pad or skip.
 */

export type ModelId =
  | 'claude-opus-4-7'
  | 'claude-opus-4-6'
  | 'claude-opus-4-5'
  | 'claude-sonnet-4-6'
  | 'claude-haiku-4-5';

export const MODEL_CACHE_MIN: Record<ModelId, number> = {
  'claude-opus-4-7': 4096,
  'claude-opus-4-6': 4096,
  'claude-opus-4-5': 4096,
  'claude-sonnet-4-6': 2048,
  'claude-haiku-4-5': 4096,
};

/**
 * Whether a prompt of `estimatedInputTokens` would be cached on `model`.
 * Returns false for prompts below the model's minimum.
 */
export function isCacheable(model: ModelId, estimatedInputTokens: number): boolean {
  return estimatedInputTokens >= MODEL_CACHE_MIN[model];
}

/**
 * Tokens to pad to reach `model`'s cache minimum.
 * Returns 0 when the prompt is already cacheable.
 */
export function paddingNeeded(model: ModelId, estimatedInputTokens: number): number {
  const min = MODEL_CACHE_MIN[model];
  return estimatedInputTokens < min ? min - estimatedInputTokens : 0;
}
