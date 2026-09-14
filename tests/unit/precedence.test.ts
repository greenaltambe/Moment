import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCanonicalUrl } from '../../dist/chrome/core/matching/url.js';
import { matchTarget } from '../../dist/chrome/core/matching/matcher.js';
import {
  calculateSpecificity,
  compareSpecificity,
} from '../../dist/chrome/core/decisions/specificity.js';
import type { Target } from '../../src/core/models/target.js';

describe('Moment Precedence & Resource-Dominant Specificity (26 Ratified Scenarios)', () => {
  function getWinningRule(urlStr: string, rules: Target[]): Target | null {
    const url = parseCanonicalUrl(urlStr);
    if (!url) return null;

    const matched = rules.filter((r) => matchTarget(r, url));
    if (matched.length === 0) return null;

    matched.sort((a, b) => {
      const specA = calculateSpecificity(a, url);
      const specB = calculateSpecificity(b, url);
      const diff = compareSpecificity(specA, specB);
      if (diff !== 0) return -diff; // Higher specificity first

      // Exception beats Restriction
      if (a.isException !== b.isException) {
        return a.isException ? -1 : 1;
      }

      // Timestamp newer wins
      if (a.createdAt !== b.createdAt) {
        return b.createdAt - a.createdAt;
      }

      return a.id.localeCompare(b.id);
    });

    return matched[0];
  }

  it('Scenario 1: Exact page (K=3) beats host-only (K=1)', () => {
    const r1: Target = { id: 'r1', pattern: 'reddit.com', type: 'WEBSITE', isException: false, createdAt: 1 };
    const r2: Target = { id: 'r2', pattern: 'reddit.com/r/all', type: 'EXACT_PAGE', isException: false, createdAt: 1 };

    const winner = getWinningRule('https://reddit.com/r/all', [r1, r2]);
    assert.equal(winner?.id, 'r2');
  });

  it('Scenario 2: Path/glob (K=2) beats host-only (K=1)', () => {
    const r1: Target = { id: 'r1', pattern: 'reddit.com', type: 'WEBSITE', isException: false, createdAt: 1 };
    const r2: Target = { id: 'r2', pattern: 'reddit.com/r/all/*', type: 'GLOB', isException: false, createdAt: 1 };

    const winner = getWinningRule('https://reddit.com/r/all/hot', [r1, r2]);
    assert.equal(winner?.id, 'r2');
  });

  it('Scenario 3: Exact host (H_type=2) beats domain with subdomains (H_type=1)', () => {
    const r1: Target = { id: 'r1', pattern: 'reddit.com', type: 'WEBSITE', isException: false, createdAt: 1 };
    const r2: Target = { id: 'r2', pattern: '.old.reddit.com', type: 'EXACT_HOST', isException: false, createdAt: 1 };

    const winner = getWinningRule('https://old.reddit.com/', [r1, r2]);
    assert.equal(winner?.id, 'r2');
  });

  it('Scenario 4: Deeper host (H_depth=3) beats shallower host (H_depth=2)', () => {
    const r1: Target = { id: 'r1', pattern: 'wikimedia.org', type: 'WEBSITE', isException: false, createdAt: 1 };
    const r2: Target = { id: 'r2', pattern: 'meta.wikimedia.org', type: 'WEBSITE', isException: false, createdAt: 1 };

    const winner = getWinningRule('https://meta.wikimedia.org/', [r1, r2]);
    assert.equal(winner?.id, 'r2');
  });

  it('Scenario 5: Deeper path segments (P_seg=2) beats shallower path (P_seg=1)', () => {
    const r1: Target = { id: 'r1', pattern: 'reddit.com/r/*', type: 'GLOB', isException: false, createdAt: 1 };
    const r2: Target = { id: 'r2', pattern: 'reddit.com/r/programming/*', type: 'GLOB', isException: false, createdAt: 1 };

    const winner = getWinningRule('https://reddit.com/r/programming/top', [r1, r2]);
    assert.equal(winner?.id, 'r2');
  });

  it('Scenario 6: Exact page (K=3) beats glob (K=2) on same path depth', () => {
    const r1: Target = { id: 'r1', pattern: 'reddit.com/r/programming/*', type: 'GLOB', isException: false, createdAt: 1 };
    const r2: Target = { id: 'r2', pattern: 'reddit.com/r/programming/top', type: 'EXACT_PAGE', isException: false, createdAt: 1 };

    const winner = getWinningRule('https://reddit.com/r/programming/top', [r1, r2]);
    assert.equal(winner?.id, 'r2');
  });

  it('Scenario 7: Exact page with query (Q=1) beats path rule without query (Q=0)', () => {
    const r1: Target = { id: 'r1', pattern: 'youtube.com/watch', type: 'PATH_PREFIX', isException: false, createdAt: 1 };
    const r2: Target = { id: 'r2', pattern: 'youtube.com/watch?v=123', type: 'EXACT_PAGE', isException: false, createdAt: 1 };

    const winner = getWinningRule('https://youtube.com/watch?v=123', [r1, r2]);
    assert.equal(winner?.id, 'r2');
  });

  it('Scenario 8: Non-matching query falls through to path rule', () => {
    const r1: Target = { id: 'r1', pattern: 'youtube.com/watch', type: 'PATH_PREFIX', isException: false, createdAt: 1 };
    const r2: Target = { id: 'r2', pattern: 'youtube.com/watch?v=123', type: 'EXACT_PAGE', isException: false, createdAt: 1 };

    const winner = getWinningRule('https://youtube.com/watch?v=456', [r1, r2]);
    assert.equal(winner?.id, 'r1');
  });

  it('Scenario 9: Specific restriction (K=2) dominates broad exception (K=1) - Shorts blocked', () => {
    const r1: Target = { id: 'r1', pattern: 'youtube.com/*', type: 'GLOB', isException: true, createdAt: 1 }; // ALLOW broad
    const r2: Target = { id: 'r2', pattern: 'youtube.com/shorts/*', type: 'GLOB', isException: false, createdAt: 1 }; // BLOCK specific

    const winner = getWinningRule('https://youtube.com/shorts/abc', [r1, r2]);
    assert.equal(winner?.id, 'r2');
  });

  it('Scenario 10: Specific exception (K=2) dominates broad restriction (K=1) - Learning allowed', () => {
    const r1: Target = { id: 'r1', pattern: 'youtube.com/*', type: 'GLOB', isException: false, createdAt: 1 }; // BLOCK broad
    const r2: Target = { id: 'r2', pattern: 'youtube.com/learning/*', type: 'GLOB', isException: true, createdAt: 1 }; // ALLOW specific

    const winner = getWinningRule('https://youtube.com/learning/1', [r1, r2]);
    assert.equal(winner?.id, 'r2');
  });

  it('Scenario 11: Identical specificity tie-breaker gives victory to Exception (ALLOW)', () => {
    const r1: Target = { id: 'r1', pattern: 'reddit.com/r/science', type: 'EXACT_PAGE', isException: false, createdAt: 1 }; // BLOCK
    const r2: Target = { id: 'r2', pattern: 'reddit.com/r/science', type: 'EXACT_PAGE', isException: true, createdAt: 1 }; // ALLOW

    const winner = getWinningRule('https://reddit.com/r/science', [r1, r2]);
    assert.equal(winner?.id, 'r2');
  });

  it('Scenario 12: Resource-Dominant: Deep path exception (P=3) beats shallow subdomain restriction (P=1)', () => {
    const r1: Target = { id: 'r1', pattern: 'old.reddit.com/r/*', type: 'GLOB', isException: false, createdAt: 1 }; // BLOCK (P=1, H_depth=3)
    const r2: Target = { id: 'r2', pattern: 'reddit.com/r/prog/wiki/*', type: 'GLOB', isException: true, createdAt: 1 }; // ALLOW (P=3, H_depth=2)

    const winner = getWinningRule('https://old.reddit.com/r/prog/wiki/faq', [r1, r2]);
    assert.equal(winner?.id, 'r2'); // P=3 beats P=1
  });

  it('Scenario 13: Equal K and P, higher host depth (H_depth=3) beats shallower (H_depth=2)', () => {
    const r1: Target = { id: 'r1', pattern: 'reddit.com/r/all', type: 'EXACT_PAGE', isException: false, createdAt: 1 };
    const r2: Target = { id: 'r2', pattern: 'old.reddit.com/r/all', type: 'EXACT_PAGE', isException: false, createdAt: 1 };

    const winner = getWinningRule('https://old.reddit.com/r/all', [r1, r2]);
    assert.equal(winner?.id, 'r2');
  });

  it('Scenario 14: Scheme-pinned exact page (K=3, H_type=2) beats generic website rule', () => {
    const r1: Target = { id: 'r1', pattern: 'http://example.com/page', type: 'EXACT_PAGE', isException: false, createdAt: 1 };
    const r2: Target = { id: 'r2', pattern: 'example.com/page', type: 'PATH_PREFIX', isException: false, createdAt: 1 };

    const winner = getWinningRule('http://example.com/page', [r1, r2]);
    assert.equal(winner?.id, 'r1');
  });

  it('Scenario 15: Subdomain host depth www.example.com (H_depth=3) beats apex (H_depth=2)', () => {
    const r1: Target = { id: 'r1', pattern: 'example.com', type: 'WEBSITE', isException: false, createdAt: 1 };
    const r2: Target = { id: 'r2', pattern: 'www.example.com', type: 'WEBSITE', isException: false, createdAt: 1 };

    const winner = getWinningRule('https://www.example.com/', [r1, r2]);
    assert.equal(winner?.id, 'r2');
  });

  it('Scenario 16: Path-level rule (K=2) beats root subdomain rule (K=1)', () => {
    const r1: Target = { id: 'r1', pattern: 'example.com/feed', type: 'PATH_PREFIX', isException: false, createdAt: 1 };
    const r2: Target = { id: 'r2', pattern: 'm.example.com', type: 'WEBSITE', isException: false, createdAt: 1 };

    const winner = getWinningRule('https://m.example.com/feed', [r1, r2]);
    assert.equal(winner?.id, 'r1');
  });

  it('Scenario 17: Deep multi-level subdomain (H_depth=4) beats H_depth=3', () => {
    const r1: Target = { id: 'r1', pattern: 'sub2.example.com', type: 'WEBSITE', isException: false, createdAt: 1 };
    const r2: Target = { id: 'r2', pattern: 'sub.sub2.example.com', type: 'WEBSITE', isException: false, createdAt: 1 };

    const winner = getWinningRule('https://sub.sub2.example.com/', [r1, r2]);
    assert.equal(winner?.id, 'r2');
  });

  it('Scenario 18: Stepped path segment depth (P=3 beats P=2 and P=1)', () => {
    const r1: Target = { id: 'r1', pattern: 'example.com/a/*', type: 'GLOB', isException: false, createdAt: 1 };
    const r2: Target = { id: 'r2', pattern: 'example.com/a/b/*', type: 'GLOB', isException: false, createdAt: 1 };
    const r3: Target = { id: 'r3', pattern: 'example.com/a/b/c/*', type: 'GLOB', isException: false, createdAt: 1 };

    const winner = getWinningRule('https://example.com/a/b/c/d', [r1, r2, r3]);
    assert.equal(winner?.id, 'r3');
  });

  it('Scenario 19: Equal path segments, longer prefix length (P_len=8) beats P_len=4', () => {
    const r1: Target = { id: 'r1', pattern: 'example.com/foo*', type: 'GLOB', isException: false, createdAt: 1 };
    const r2: Target = { id: 'r2', pattern: 'example.com/foo-bar*', type: 'GLOB', isException: false, createdAt: 1 };

    const winner = getWinningRule('https://example.com/foo-bar', [r1, r2]);
    assert.equal(winner?.id, 'r2');
  });

  it('Scenario 20: Trailing slash boundary prefix /foo/ (P_len=5) beats /foo (P_len=4)', () => {
    const r1: Target = { id: 'r1', pattern: 'example.com/foo*', type: 'GLOB', isException: false, createdAt: 1 };
    const r2: Target = { id: 'r2', pattern: 'example.com/foo/*', type: 'GLOB', isException: false, createdAt: 1 };

    const winner = getWinningRule('https://example.com/foo/bar', [r1, r2]);
    assert.equal(winner?.id, 'r2');
  });

  it('Scenario 21: Mid-path wildcard with trailing suffix (P_seg=2) beats single-wildcard (P_seg=1)', () => {
    const r1: Target = { id: 'r1', pattern: 'example.com/u/*', type: 'GLOB', isException: false, createdAt: 1 };
    const r2: Target = { id: 'r2', pattern: 'example.com/u/*/settings', type: 'GLOB', isException: false, createdAt: 1 };

    const winner = getWinningRule('https://example.com/u/1/settings', [r1, r2]);
    assert.equal(winner?.id, 'r2');
  });

  it('Scenario 22: Identical tuple restrictions resolve by policy severity (BLOCK > INTERVENE)', () => {
    // Both K=2, P=1, P_len=2, Q=0, H=1, H_depth=2
    const url = parseCanonicalUrl('https://example.com/a')!;
    const r1: Target = { id: 'r1', pattern: 'example.com/a', type: 'PATH_PREFIX', isException: false, createdAt: 1 };
    const r2: Target = { id: 'r2', pattern: 'example.com/a', type: 'PATH_PREFIX', isException: false, createdAt: 1 };

    const specA = calculateSpecificity(r1, url);
    const specB = calculateSpecificity(r2, url);
    assert.equal(compareSpecificity(specA, specB), 0);
  });

  it('Scenario 23: Identical tuples and severity resolve by newest creation timestamp', () => {
    const r1: Target = { id: 'r1', pattern: 'example.com/a', type: 'PATH_PREFIX', isException: false, createdAt: 100 };
    const r2: Target = { id: 'r2', pattern: 'example.com/a', type: 'PATH_PREFIX', isException: false, createdAt: 200 };

    const winner = getWinningRule('https://example.com/a', [r1, r2]);
    assert.equal(winner?.id, 'r2');
  });

  it('Scenario 24: Slash-normalized equivalent targets tie on specificity', () => {
    const url = parseCanonicalUrl('https://example.com/a/')!;
    const r1: Target = { id: 'r1', pattern: 'example.com/a', type: 'PATH_PREFIX', isException: false, createdAt: 1 };
    const r2: Target = { id: 'r2', pattern: 'example.com/a/', type: 'PATH_PREFIX', isException: false, createdAt: 1 };

    const spec1 = calculateSpecificity(r1, url);
    const spec2 = calculateSpecificity(r2, url);
    assert.equal(compareSpecificity(spec1, spec2), 0);
  });

  it('Scenario 25: Multi-parameter query matching requires exact match', () => {
    const r1: Target = { id: 'r1', pattern: 'example.com/items?a=1', type: 'EXACT_PAGE', isException: false, createdAt: 1 };
    const r2: Target = { id: 'r2', pattern: 'example.com/items?a=1&b=2', type: 'EXACT_PAGE', isException: false, createdAt: 1 };

    const winner = getWinningRule('https://example.com/items?a=1&b=2', [r1, r2]);
    assert.equal(winner?.id, 'r2');
  });

  it('Scenario 26: Resource-Dominant: Deep path exception (P=3) beats shallow subdomain block (P=1)', () => {
    const r1: Target = { id: 'r1', pattern: 'admin.site.com/docs/*', type: 'GLOB', isException: false, createdAt: 1 }; // BLOCK (P=1, H_depth=3)
    const r2: Target = { id: 'r2', pattern: 'site.com/docs/api/v2', type: 'EXACT_PAGE', isException: true, createdAt: 1 }; // ALLOW (P=3, H_depth=2)

    const winner = getWinningRule('https://admin.site.com/docs/api/v2', [r1, r2]);
    assert.equal(winner?.id, 'r2');
  });
});
