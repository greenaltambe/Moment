import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isTargetAuthorized,
  resolveGrantDuration,
  isGrantValidForNavigation,
} from '../../dist/chrome/core/grants/grant-validator.js';
import {
  DEFAULT_GRANT_DURATION_MS,
  MAX_GRANT_DURATION_MS,
} from '../../dist/chrome/shared/constants.js';
import type { TemporaryAccessGrant } from '../../src/core/models/grant.js';

describe('Moment Centralized Grant Validation (Production Validator)', () => {
  describe('isTargetAuthorized: Adversarial URL Target Matching', () => {
    it('Authorizes exact same URL', () => {
      assert.equal(
        isTargetAuthorized('https://example.com/target', 'https://example.com/target'),
        true
      );
    });

    it('Authorizes same origin with root grant target for subpaths', () => {
      assert.equal(isTargetAuthorized('https://example.com', 'https://example.com/feed'), true);
      assert.equal(isTargetAuthorized('https://example.com/', 'https://example.com/feed/sub'), true);
    });

    it('Enforces strict path boundary matching on specific grant targets', () => {
      // Subpaths authorized under path prefix
      assert.equal(
        isTargetAuthorized('https://example.com/feed', 'https://example.com/feed/comments'),
        true
      );
      // Boundary collision prevented: /feedback is NOT under /feed
      assert.equal(
        isTargetAuthorized('https://example.com/feed', 'https://example.com/feedback'),
        false
      );
    });

    it('Rejects different origin', () => {
      assert.equal(isTargetAuthorized('https://example.com', 'https://attacker.com/feed'), false);
    });

    it('Rejects subdomains (grant target is origin-specific)', () => {
      assert.equal(isTargetAuthorized('https://example.com', 'https://sub.example.com/feed'), false);
      assert.equal(isTargetAuthorized('https://sub.example.com', 'https://example.com/feed'), false);
    });

    it('Rejects lookalike hostnames and suffix tricks', () => {
      assert.equal(
        isTargetAuthorized('https://example.com', 'https://example.com.attacker.com/page'),
        false
      );
      assert.equal(
        isTargetAuthorized('https://example.com', 'https://evil-example.com/page'),
        false
      );
    });

    it('Rejects query parameter injection of granted URL', () => {
      assert.equal(
        isTargetAuthorized('https://example.com', 'https://evil.com/?redirect=https://example.com'),
        false
      );
    });

    it('Rejects hash fragment injection of granted URL', () => {
      assert.equal(
        isTargetAuthorized('https://example.com', 'https://evil.com/#https://example.com'),
        false
      );
    });

    it('Rejects malformed URLs and non-web schemes', () => {
      assert.equal(isTargetAuthorized('https://example.com', 'not-a-valid-url'), false);
      assert.equal(isTargetAuthorized('not-a-valid-url', 'https://example.com'), false);
      assert.equal(isTargetAuthorized('https://example.com', 'javascript:alert(1)'), false);
      assert.equal(isTargetAuthorized('https://example.com', 'data:text/html,evil'), false);
    });

    it('Properly parses URLs containing embedded credentials', () => {
      assert.equal(
        isTargetAuthorized('https://example.com/feed', 'https://user:pass@example.com/feed'),
        true
      );
    });

    it('Rejects protocol mismatch (HTTP vs HTTPS are distinct)', () => {
      assert.equal(isTargetAuthorized('http://example.com', 'https://example.com'), false);
      assert.equal(isTargetAuthorized('https://example.com', 'http://example.com'), false);
    });

    it('Rejects port mismatch when explicit ports are defined', () => {
      assert.equal(
        isTargetAuthorized('https://example.com:8080/app', 'https://example.com:9090/app'),
        false
      );
      assert.equal(
        isTargetAuthorized('https://example.com:8080/app', 'https://example.com:8080/app'),
        true
      );
    });

    it('Handles bare hostname grant targets without authorizing subdomains', () => {
      assert.equal(isTargetAuthorized('example.com', 'https://example.com/feed'), true);
      assert.equal(isTargetAuthorized('example.com', 'https://sub.example.com/feed'), false);
      assert.equal(isTargetAuthorized('example.com', 'https://example.com.evil.com'), false);
      assert.equal(isTargetAuthorized('example.com/invalid', 'https://example.com/feed'), false);
    });
  });

  describe('resolveGrantDuration: Validation & Clamping', () => {
    it('Falls back to DEFAULT_GRANT_DURATION_MS when omitted', () => {
      assert.equal(resolveGrantDuration(undefined), DEFAULT_GRANT_DURATION_MS);
      assert.equal(resolveGrantDuration(), DEFAULT_GRANT_DURATION_MS);
    });

    it('Accepts valid duration within bounds', () => {
      assert.equal(resolveGrantDuration(120_000), 120_000);
      assert.equal(resolveGrantDuration(30_000), 30_000);
    });

    it('Falls back to default on zero or negative values', () => {
      assert.equal(resolveGrantDuration(0), DEFAULT_GRANT_DURATION_MS);
      assert.equal(resolveGrantDuration(-5_000), DEFAULT_GRANT_DURATION_MS);
    });

    it('Falls back to default on NaN, Infinity, and -Infinity', () => {
      assert.equal(resolveGrantDuration(NaN), DEFAULT_GRANT_DURATION_MS);
      assert.equal(resolveGrantDuration(Infinity), DEFAULT_GRANT_DURATION_MS);
      assert.equal(resolveGrantDuration(-Infinity), DEFAULT_GRANT_DURATION_MS);
    });

    it('Falls back to default on non-numeric types', () => {
      assert.equal(resolveGrantDuration('120000' as any), DEFAULT_GRANT_DURATION_MS);
      assert.equal(resolveGrantDuration({} as any), DEFAULT_GRANT_DURATION_MS);
      assert.equal(resolveGrantDuration(null as any), DEFAULT_GRANT_DURATION_MS);
    });

    it('Accepts duration exactly at maximum', () => {
      assert.equal(resolveGrantDuration(MAX_GRANT_DURATION_MS), MAX_GRANT_DURATION_MS);
    });

    it('Clamps duration exceeding MAX_GRANT_DURATION_MS', () => {
      assert.equal(resolveGrantDuration(MAX_GRANT_DURATION_MS + 10_000), MAX_GRANT_DURATION_MS);
      assert.equal(resolveGrantDuration(999_999_999), MAX_GRANT_DURATION_MS);
    });

    it('Phase 1.1 / Phase 3.1 Invariant: requested duration > 10 minutes -> resulting grant duration <= 10 minutes', () => {
      const tenMinutesMs = 10 * 60 * 1000;
      assert.equal(MAX_GRANT_DURATION_MS, tenMinutesMs);
      assert.ok(resolveGrantDuration(15 * 60 * 1000) <= tenMinutesMs);
      assert.equal(resolveGrantDuration(15 * 60 * 1000), tenMinutesMs);
      assert.ok(resolveGrantDuration(86400 * 1000) <= tenMinutesMs);
      assert.equal(resolveGrantDuration(86400 * 1000), tenMinutesMs);
    });

    it('Floors fractional numbers to integers', () => {
      assert.equal(resolveGrantDuration(45_000.7), 45_000);
    });
  });

  describe('isGrantValidForNavigation: Full Domain Lifecycle Checks', () => {
    const baseGrant: TemporaryAccessGrant = {
      id: 'g_test',
      tabId: 5,
      target: 'https://distracting.site',
      grantedAt: 1000,
      expiresAt: 5000,
      nonce: 'valid_nonce',
      singleUse: true,
    };

    it('Accepts valid grant when tab, target, and time match', () => {
      assert.equal(
        isGrantValidForNavigation(baseGrant, 5, 'https://distracting.site/feed', 2000),
        true
      );
    });

    it('Rejects grant when tabId differs (strict tab isolation)', () => {
      assert.equal(
        isGrantValidForNavigation(baseGrant, 6, 'https://distracting.site/feed', 2000),
        false
      );
    });

    it('Rejects grant when target origin does not match', () => {
      assert.equal(
        isGrantValidForNavigation(baseGrant, 5, 'https://another.site/feed', 2000),
        false
      );
    });

    it('Rejects grant when expired (now >= expiresAt)', () => {
      assert.equal(
        isGrantValidForNavigation(baseGrant, 5, 'https://distracting.site/feed', 5000),
        false
      );
      assert.equal(
        isGrantValidForNavigation(baseGrant, 5, 'https://distracting.site/feed', 5001),
        false
      );
    });

    it('Rejects grant when timestamp is before grantedAt (clock skew anomaly)', () => {
      assert.equal(
        isGrantValidForNavigation(baseGrant, 5, 'https://distracting.site/feed', 999),
        false
      );
    });

    it('Rejects grant with invalid duration window (grantedAt >= expiresAt)', () => {
      const corruptGrant: TemporaryAccessGrant = {
        ...baseGrant,
        grantedAt: 5000,
        expiresAt: 5000,
      };
      assert.equal(
        isGrantValidForNavigation(corruptGrant, 5, 'https://distracting.site/feed', 2000),
        false
      );
    });

    it('Rejects grant exceeding MAX_GRANT_DURATION_MS', () => {
      const oversizedGrant: TemporaryAccessGrant = {
        ...baseGrant,
        grantedAt: 1000,
        expiresAt: 1000 + MAX_GRANT_DURATION_MS + 1000,
      };
      assert.equal(
        isGrantValidForNavigation(oversizedGrant, 5, 'https://distracting.site/feed', 2000),
        false
      );
    });

    it('Rejects null or undefined grant safely', () => {
      assert.equal(isGrantValidForNavigation(undefined, 5, 'https://distracting.site/feed', 2000), false);
      assert.equal(isGrantValidForNavigation(null, 5, 'https://distracting.site/feed', 2000), false);
    });
  });
});
