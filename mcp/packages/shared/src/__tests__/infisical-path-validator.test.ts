import { describe, it, expect } from 'vitest';
import {
  validateInfisicalPath,
  assertInfisicalPath,
} from '../infisical-path-validator.js';

describe('validateInfisicalPath', () => {
  describe('valid paths', () => {
    it.each([
      '/',
      '/bla',
      '/bla/dev',
      '/bla/dev/llm/anthropic',
      '/bla/dev/adobe/workfront',
      '/bla/dev/adobe/eds',
      '/bla/dev/adobe/da-live',
      '/bla/prod/adobe/workfront',
      '/a',
      '/a-b-c',
      '/abc123',
      '/123-xyz',
    ])('accepts %s', (path) => {
      expect(validateInfisicalPath(path)).toEqual({ ok: true });
    });
  });

  describe('invalid paths', () => {
    it('rejects empty string', () => {
      const r = validateInfisicalPath('');
      expect(r.ok).toBe(false);
    });

    it('rejects missing leading slash', () => {
      const r = validateInfisicalPath('bla/dev');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/must start with/);
    });

    it('rejects trailing slash', () => {
      const r = validateInfisicalPath('/bla/dev/');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/end with/);
    });

    it.each([
      ['/bla/dev//adobe', /empty segment/],
      ['/bla_dev', /invalid characters/],
      ['/bla/dev/api_key', /invalid characters/],
      ['/BLA/dev', /invalid characters/],
      ['/bla/dev/Workfront', /invalid characters/],
      ['/bla/dev/foo.bar', /invalid characters/],
      ['/bla/dev/foo bar', /invalid characters/],
      ['/bla/-dev', /invalid characters/],
      ['/bla/dev-', /invalid characters/],
      ['/bla/dev/-', /invalid characters/],
    ])('rejects %s', (path, reasonRe) => {
      const r = validateInfisicalPath(path);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(reasonRe);
    });

    it('rejects paths exceeding 256 chars', () => {
      const long = '/' + 'a'.repeat(257);
      const r = validateInfisicalPath(long);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/exceeds/);
    });

    it('rejects non-string input', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = validateInfisicalPath(42 as any);
      expect(r.ok).toBe(false);
    });
  });
});

describe('assertInfisicalPath', () => {
  it('does nothing on valid path', () => {
    expect(() => assertInfisicalPath('/bla/dev/llm/anthropic')).not.toThrow();
  });

  it('throws on invalid path with the reason', () => {
    expect(() => assertInfisicalPath('/bla/dev/api_key')).toThrow(/invalid characters/);
  });
});
