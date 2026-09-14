import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateGlobPattern, compileGlobMatcher } from '../../dist/chrome/core/matching/glob.js';
import { parseCanonicalUrl } from '../../dist/chrome/core/matching/url.js';

describe('Moment Bounded Glob Grammar & Compiler (Phase 0.2 Specification)', () => {
  describe('validateGlobPattern: Grammar Validation Rules', () => {
    it('Accepts valid glob patterns conforming to Phase 0.2 grammar', () => {
      assert.equal(validateGlobPattern('youtube.com/shorts/*').valid, true);
      assert.equal(validateGlobPattern('reddit.com/r/*').valid, true);
      assert.equal(validateGlobPattern('example.com/foo*').valid, true);
      assert.equal(validateGlobPattern('example.com/user/*/settings').valid, true);
      assert.equal(validateGlobPattern('*.example.com').valid, true);
      assert.equal(validateGlobPattern('example.com/*/posts/*').valid, true);
      assert.equal(validateGlobPattern('example.com/search/\\*').valid, true);
      assert.equal(validateGlobPattern('https://example.com/a/*').valid, true);
    });

    it('Rejects patterns with more than 2 path wildcards (triple wildcard limit)', () => {
      const res = validateGlobPattern('example.com/*/*/*');
      assert.equal(res.valid, false);
      assert.ok(res.error?.includes('wildcards'));
    });

    it('Rejects infix host wildcards', () => {
      const res = validateGlobPattern('ex*mple.com');
      assert.equal(res.valid, false);
      assert.ok(res.error?.includes('leading prefix'));
    });

    it('Rejects TLD wildcards', () => {
      const res1 = validateGlobPattern('google.*');
      assert.equal(res1.valid, false);

      const res2 = validateGlobPattern('*.com');
      assert.equal(res2.valid, false);
      assert.ok(res2.error?.includes('TLD wildcards are forbidden'));
    });

    it('Rejects wildcards in query strings (V1 exact-query invariant)', () => {
      const res = validateGlobPattern('site.com/watch?v=*');
      assert.equal(res.valid, false);
      assert.ok(res.error?.includes('query strings'));
    });

    it('Rejects oversized patterns exceeding 256 characters', () => {
      const longPattern = 'example.com/' + 'a'.repeat(260);
      const res = validateGlobPattern(longPattern);
      assert.equal(res.valid, false);
      assert.ok(res.error?.includes('exceeds maximum length'));
    });

    it('Rejects empty or malformed pattern input safely', () => {
      assert.equal(validateGlobPattern('').valid, false);
      assert.equal(validateGlobPattern('   ').valid, false);
      assert.equal(validateGlobPattern(null).valid, false);
      assert.equal(validateGlobPattern(undefined).valid, false);
    });
  });

  describe('compileGlobMatcher: Positive & Negative Matching Matrix', () => {
    it('Category 1 (Standard Prefix): youtube.com/shorts/*', () => {
      const matcher = compileGlobMatcher('youtube.com/shorts/*')!;
      assert.ok(matcher);

      assert.equal(matcher(parseCanonicalUrl('https://youtube.com/shorts/')!), true);
      assert.equal(matcher(parseCanonicalUrl('https://youtube.com/shorts/123')!), true);
      assert.equal(matcher(parseCanonicalUrl('https://www.youtube.com/shorts/123/comments')!), true);

      // Negative cases
      assert.equal(matcher(parseCanonicalUrl('https://youtube.com/watch?v=123')!), false);
      assert.equal(matcher(parseCanonicalUrl('https://notyoutube.com/shorts/1')!), false);
    });

    it('Category 2 (Directory Wildcard): reddit.com/r/*', () => {
      const matcher = compileGlobMatcher('reddit.com/r/*')!;
      assert.ok(matcher);

      assert.equal(matcher(parseCanonicalUrl('https://reddit.com/r/all')!), true);
      assert.equal(matcher(parseCanonicalUrl('https://reddit.com/r/programming/top')!), true);

      // Negative cases
      assert.equal(matcher(parseCanonicalUrl('https://reddit.com/user/alice')!), false);
      assert.equal(matcher(parseCanonicalUrl('https://reddit.com/')!), false);
    });

    it('Category 3 (Infix Slug Wildcard): example.com/foo*', () => {
      const matcher = compileGlobMatcher('example.com/foo*')!;
      assert.ok(matcher);

      assert.equal(matcher(parseCanonicalUrl('https://example.com/foo')!), true);
      assert.equal(matcher(parseCanonicalUrl('https://example.com/foobar')!), true);
      assert.equal(matcher(parseCanonicalUrl('https://example.com/foo/bar')!), true);

      // Negative cases
      assert.equal(matcher(parseCanonicalUrl('https://example.com/bar')!), false);
      assert.equal(matcher(parseCanonicalUrl('https://example.com/FOO')!), false); // Case-sensitive path
    });

    it('Category 4 (Mid-Path Parameter): example.com/user/*/settings', () => {
      const matcher = compileGlobMatcher('example.com/user/*/settings')!;
      assert.ok(matcher);

      assert.equal(matcher(parseCanonicalUrl('https://example.com/user/alice/settings')!), true);
      assert.equal(matcher(parseCanonicalUrl('https://example.com/user/123/settings')!), true);

      // Negative cases
      assert.equal(matcher(parseCanonicalUrl('https://example.com/user/alice/profile')!), false);
      assert.equal(matcher(parseCanonicalUrl('https://example.com/settings')!), false);
    });

    it('Category 5 (Leading Subdomain): *.example.com', () => {
      const matcher = compileGlobMatcher('*.example.com')!;
      assert.ok(matcher);

      assert.equal(matcher(parseCanonicalUrl('https://sub.example.com')!), true);
      assert.equal(matcher(parseCanonicalUrl('https://a.b.example.com')!), true);

      // Negative cases (does NOT match apex domain per Phase 0.2 spec)
      assert.equal(matcher(parseCanonicalUrl('https://example.com')!), false);
      assert.equal(matcher(parseCanonicalUrl('https://attacker.com')!), false);
    });

    it('Category 6 (Dual Wildcard): example.com/*/posts/*', () => {
      const matcher = compileGlobMatcher('example.com/*/posts/*')!;
      assert.ok(matcher);

      assert.equal(matcher(parseCanonicalUrl('https://example.com/u1/posts/100')!), true);
      assert.equal(matcher(parseCanonicalUrl('https://example.com/forum/posts/abc/edit')!), true);

      // Negative cases
      assert.equal(matcher(parseCanonicalUrl('https://example.com/posts/100')!), false);
    });

    it('Category 7 (Escaped Literal Wildcard): example.com/search/\\*', () => {
      const matcher = compileGlobMatcher('example.com/search/\\*')!;
      assert.ok(matcher);

      assert.equal(matcher(parseCanonicalUrl('https://example.com/search/*')!), true);
      assert.equal(matcher(parseCanonicalUrl('https://example.com/search/anything')!), false);
    });

    it('Category 8 (Adversarial Long Input & Polynomial Bound): Safe execution on 2000-char path', () => {
      const matcher = compileGlobMatcher('example.com/*a*b')!;
      assert.ok(matcher);

      // Adversarial path with repeating 'a' characters ending with non-matching 'c'
      const longPath = '/' + 'a'.repeat(2000) + 'c';
      const url = parseCanonicalUrl('https://example.com' + longPath)!;

      const start = performance.now();
      const res = matcher(url);
      const elapsed = performance.now() - start;

      assert.equal(res, false);
      // Confirms absence of exponential catastrophic backtracking (completes in < 50ms)
      assert.ok(elapsed < 50, `Matching took too long: ${elapsed}ms`);
    });
  });
});
