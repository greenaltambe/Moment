import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchTarget } from '../../dist/chrome/core/matching/matcher.js';
import { parseCanonicalUrl } from '../../dist/chrome/core/matching/url.js';
import type { Target } from '../../src/core/models/target.js';

describe('Moment Target Matcher Engine (Audit 2 & 3 Semantics)', () => {
  describe('WEBSITE Target Type: Apex & Subdomain Semantics', () => {
    const websiteTarget: Target = {
      id: 't_website',
      pattern: 'example.com',
      type: 'WEBSITE',
      isException: false,
      createdAt: 1,
    };

    it('Matches apex domain directly', () => {
      const url = parseCanonicalUrl('https://example.com/some/path')!;
      assert.equal(matchTarget(websiteTarget, url), true);
    });

    it('Matches www. subdomain', () => {
      const url = parseCanonicalUrl('https://www.example.com/some/path')!;
      assert.equal(matchTarget(websiteTarget, url), true);
    });

    it('Matches m. mobile subdomain', () => {
      const url = parseCanonicalUrl('https://m.example.com/page')!;
      assert.equal(matchTarget(websiteTarget, url), true);
    });

    it('Matches arbitrary subdomains (e.g. sub.example.com, a.b.example.com)', () => {
      const u1 = parseCanonicalUrl('https://sub.example.com/')!;
      const u2 = parseCanonicalUrl('https://deep.sub.example.com/login')!;
      assert.equal(matchTarget(websiteTarget, u1), true);
      assert.equal(matchTarget(websiteTarget, u2), true);
    });

    it('Rejects lookalike domain with target as suffix (example.com.evil.com)', () => {
      const url = parseCanonicalUrl('https://example.com.evil.com/page')!;
      assert.equal(matchTarget(websiteTarget, url), false);
    });

    it('Rejects lookalike domain with hyphen prefix (evil-example.com)', () => {
      const url = parseCanonicalUrl('https://evil-example.com/page')!;
      assert.equal(matchTarget(websiteTarget, url), false);
    });

    it('Rejects completely different domain', () => {
      const url = parseCanonicalUrl('https://google.com/')!;
      assert.equal(matchTarget(websiteTarget, url), false);
    });
  });

  describe('EXACT_HOST Target Type: Pinned Hostname Semantics', () => {
    const exactTarget: Target = {
      id: 't_exact',
      pattern: 'example.com',
      type: 'EXACT_HOST',
      isException: false,
      createdAt: 1,
    };

    it('Matches exact hostname', () => {
      const url = parseCanonicalUrl('https://example.com/page')!;
      assert.equal(matchTarget(exactTarget, url), true);
    });

    it('Rejects subdomains (sub.example.com does not match exact:example.com)', () => {
      const url = parseCanonicalUrl('https://sub.example.com/page')!;
      assert.equal(matchTarget(exactTarget, url), false);
    });

    it('Rejects www. subdomain (www.example.com does not match exact:example.com)', () => {
      const url = parseCanonicalUrl('https://www.example.com/page')!;
      assert.equal(matchTarget(exactTarget, url), false);
    });
  });

  describe('PATH_PREFIX Target Type: Boundary-Safe Matching', () => {
    const prefixTarget: Target = {
      id: 't_prefix',
      pattern: 'example.com/feed',
      type: 'PATH_PREFIX',
      isException: false,
      createdAt: 1,
    };

    it('Matches exact path prefix /feed', () => {
      const url = parseCanonicalUrl('https://example.com/feed')!;
      assert.equal(matchTarget(prefixTarget, url), true);
    });

    it('Matches path prefix with trailing slash /feed/', () => {
      const url = parseCanonicalUrl('https://example.com/feed/')!;
      assert.equal(matchTarget(prefixTarget, url), true);
    });

    it('Matches nested sub-paths /feed/trending', () => {
      const url = parseCanonicalUrl('https://example.com/feed/trending')!;
      assert.equal(matchTarget(prefixTarget, url), true);
    });

    it('Strictly rejects lookalike path names (/feedback)', () => {
      const url = parseCanonicalUrl('https://example.com/feedback')!;
      assert.equal(matchTarget(prefixTarget, url), false);
    });
  });
});
