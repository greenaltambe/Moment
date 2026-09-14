/**
 * Unit Test Suite: Moment Phase 5.1 Validation & UX Audit
 * Validates product correctness, security invariants, domain validation,
 * specificity dominance, schedule semantics, and import/export safety.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateTargetPattern,
  formatScheduleNaturalLanguage,
  validateImportPayload,
} from '../../dist/chrome/core/validation/rules.js';
import { MomentDecisionEngine } from '../../dist/chrome/core/decisions/engine.js';
import { isTimeInInterval } from '../../dist/chrome/core/policies/boundary-evaluator.js';
import {
  calculateRemainingBudget,
  validateDailyLimit,
} from '../../dist/chrome/core/usage/accounting.js';
import { isValidMessage } from '../../dist/chrome/shared/messages.js';
import type { Collection } from '../../src/core/models/collection.js';
import { parseCanonicalUrl } from '../../dist/chrome/core/matching/url.js';
import { matchTarget } from '../../dist/chrome/core/matching/matcher.js';
import { resolveGrantDuration } from '../../dist/chrome/core/grants/grant-validator.js';

describe('Phase 5.1 Audit: Target Pattern Validation & WEBSITE Normalization', () => {
  describe('WEBSITE Target Normalization Semantics', () => {
    it('normalizes standard domain and strips protocol and trailing slash', () => {
      const res = validateTargetPattern('https://Example.com/', 'WEBSITE');
      assert.equal(res.valid, true);
      assert.equal(res.sanitized, 'example.com');
    });

    it('strips multiple trailing slashes cleanly', () => {
      const res = validateTargetPattern('https://example.com///', 'WEBSITE');
      assert.equal(res.valid, true);
      assert.equal(res.sanitized, 'example.com');
    });

    it('preserves www subdomains without broadening to apex domain', () => {
      const res = validateTargetPattern('https://www.example.com', 'WEBSITE');
      assert.equal(res.valid, true);
      assert.equal(res.sanitized, 'www.example.com');

      // Verify Core matching behavior: www.example.com does NOT match apex example.com
      const canonApex = parseCanonicalUrl('https://example.com')!;
      const canonWww = parseCanonicalUrl('https://www.example.com')!;
      const canonM = parseCanonicalUrl('https://m.example.com')!;

      const targetWww = { id: '1', pattern: 'www.example.com', type: 'WEBSITE' as const, isException: false, createdAt: 1 };
      assert.equal(matchTarget(targetWww, canonWww), true, 'www matches www');
      assert.equal(matchTarget(targetWww, canonApex), false, 'www target does not match apex');
      assert.equal(matchTarget(targetWww, canonM), false, 'www target does not match mobile subdomain');

      // Conversely, apex example.com matches apex, www, and m
      const targetApex = { id: '2', pattern: 'example.com', type: 'WEBSITE' as const, isException: false, createdAt: 1 };
      assert.equal(matchTarget(targetApex, canonApex), true);
      assert.equal(matchTarget(targetApex, canonWww), true);
      assert.equal(matchTarget(targetApex, canonM), true);
    });

    it('preserves m. subdomains without broadening', () => {
      const res = validateTargetPattern('m.example.com', 'WEBSITE');
      assert.equal(res.valid, true);
      assert.equal(res.sanitized, 'm.example.com');
    });

    it('accepts valid custom ports (localhost:3000, example.com:8080)', () => {
      const res1 = validateTargetPattern('localhost:3000', 'WEBSITE');
      assert.equal(res1.valid, true);
      assert.equal(res1.sanitized, 'localhost:3000');

      const res2 = validateTargetPattern('http://example.com:8080/', 'WEBSITE');
      assert.equal(res2.valid, true);
      assert.equal(res2.sanitized, 'example.com:8080');
    });

    it('rejects invalid or out-of-range port numbers', () => {
      const r1 = validateTargetPattern('example.com:abc', 'WEBSITE');
      assert.equal(r1.valid, false);
      assert.ok(r1.error?.includes('Invalid port'));

      const r2 = validateTargetPattern('example.com:99999', 'WEBSITE');
      assert.equal(r2.valid, false);
      assert.ok(r2.error?.includes('between 1 and 65535'));

      const r3 = validateTargetPattern('example.com:0', 'WEBSITE');
      assert.equal(r3.valid, false);
    });

    it('rejects paths, query strings, and wildcards in WEBSITE mode', () => {
      assert.equal(validateTargetPattern('example.com/news', 'WEBSITE').valid, false);
      assert.equal(validateTargetPattern('example.com?foo=bar', 'WEBSITE').valid, false);
      assert.equal(validateTargetPattern('*.example.com', 'WEBSITE').valid, false);
      assert.equal(validateTargetPattern('example.com/*', 'WEBSITE').valid, false);
    });
  });

  describe('EXACT_PAGE & PATH_PREFIX Validation', () => {
    it('rejects empty host in EXACT_PAGE mode (e.g. /page.html)', () => {
      const res = validateTargetPattern('/page.html', 'EXACT_PAGE');
      assert.equal(res.valid, false);
      assert.ok(res.error?.includes('must include a valid domain'));
    });

    it('accepts valid domain and page path in EXACT_PAGE mode', () => {
      const res = validateTargetPattern('https://example.com/page.html', 'EXACT_PAGE');
      assert.equal(res.valid, true);
      assert.equal(res.sanitized, 'example.com/page.html');
    });

    it('rejects wildcards in EXACT_PAGE mode', () => {
      const res = validateTargetPattern('example.com/page*.html', 'EXACT_PAGE');
      assert.equal(res.valid, false);
      assert.ok(res.error?.includes('cannot contain wildcards'));
    });

    it('rejects empty host in PATH_PREFIX mode (e.g. /restricted)', () => {
      const res = validateTargetPattern('/restricted', 'PATH_PREFIX');
      assert.equal(res.valid, false);
      assert.ok(res.error?.includes('must include a valid domain'));
    });

    it('rejects query strings in PATH_PREFIX mode', () => {
      const res = validateTargetPattern('example.com/feed?view=compact', 'PATH_PREFIX');
      assert.equal(res.valid, false);
      assert.ok(res.error?.includes('cannot contain query parameters'));
    });
  });
});

describe('Phase 5.1 Audit: Exception Precedence & Specificity Dominance Invariant', () => {
  it('enforces specificity dominance: specific restriction beats broad exception', () => {
    const engine = new MomentDecisionEngine();

    const collection: Collection = {
      id: 'col_mix',
      name: 'Mixed Precedence Test',
      color: '#15803d',
      icon: 'shield',
      enabled: true,
      createdAt: 1000,
      updatedAt: 1000,
      dailyLimitMs: null,
      boundary: {
        schedule: { enabled: false, intervals: [] },
        limits: { dailyMinutes: null, sessionMinutes: null },
        pause: { type: 'NONE', durationSeconds: 0, requireIntentionText: false },
        action: { type: 'BLOCK_PAGE', redirectUrl: null },
        strictMode: false,
      },
      targets: [
        // Broad exception: allow all of example.com
        {
          id: 't_broad_exception',
          pattern: 'example.com',
          type: 'WEBSITE',
          isException: true,
          createdAt: 1000,
        },
        // Specific restriction: block example.com/restricted/*
        {
          id: 't_specific_restriction',
          pattern: '*.example.com/restricted/*',
          type: 'GLOB',
          isException: false,
          createdAt: 1001,
        },
      ],
    };

    engine.setCollections([collection]);

    // 1. Navigation to general path -> matches broad exception -> ALLOW
    const normalDecision = engine.evaluate({
      url: 'https://example.com/about',
      tabId: 1,
      timestamp: Date.now(),
      collections: [collection],
      dailyUsageMs: {},
    });
    assert.equal(normalDecision.action, 'ALLOW');
    assert.equal(normalDecision.reason, 'EXCEPTION_RULE');

    // 2. Navigation to restricted path -> specific restriction is more specific -> BLOCK
    const restrictedDecision = engine.evaluate({
      url: 'https://sub.example.com/restricted/secrets',
      tabId: 1,
      timestamp: Date.now(),
      collections: [collection],
      dailyUsageMs: {},
    });
    assert.equal(restrictedDecision.action, 'BLOCK');
    assert.equal(restrictedDecision.matchedRuleId, 't_specific_restriction');
    assert.equal(restrictedDecision.reason, 'SCHEDULE_ACTIVE');
  });
});

describe('Phase 5.1 Audit: Boundary & Overnight Schedules', () => {
  it('formats overnight schedule (10:00 PM to 7:00 AM) and evaluates midnight intervals correctly', () => {
    // 22:00 = 1320, 07:00 = 420
    const interval = {
      days: [1], // Monday
      startMinute: 1320,
      endMinute: 420,
    };

    const formatted = formatScheduleNaturalLanguage({
      enabled: true,
      intervals: [interval],
    });
    assert.equal(formatted, 'Mon overnight from 10:00 PM to 7:00 AM');

    // Monday 22:00 -> IN INTERVAL
    assert.equal(isTimeInInterval(1, 1320, interval), true);
    // Monday 23:59 -> IN INTERVAL
    assert.equal(isTimeInInterval(1, 1439, interval), true);
    // Monday 21:59 -> OUTSIDE INTERVAL
    assert.equal(isTimeInInterval(1, 1319, interval), false);

    // Tuesday 00:00 (midnight following Monday) -> IN INTERVAL
    assert.equal(isTimeInInterval(2, 0, interval), true);
    // Tuesday 06:59 -> IN INTERVAL
    assert.equal(isTimeInInterval(2, 419, interval), true);
    // Tuesday 07:00 -> OUTSIDE INTERVAL (exclusive end)
    assert.equal(isTimeInInterval(2, 420, interval), false);
    // Tuesday 10:00 -> OUTSIDE INTERVAL
    assert.equal(isTimeInInterval(2, 600, interval), false);
  });
});

describe('Phase 5.1 Audit: Daily Limit Boundary Conditions (29:59.999, 30:00.000, 30:00.001)', () => {
  const limit30m = 30 * 60 * 1000; // 1,800,000 ms

  it('evaluates exactly at 29:59.999 (1,799,999 ms) as unexhausted', () => {
    const { remainingMs, isExhausted } = calculateRemainingBudget(1_799_999, limit30m);
    assert.equal(isExhausted, false);
    assert.equal(remainingMs, 1);
  });

  it('evaluates exactly at 30:00.000 (1,800,000 ms) as exhausted with 0 remaining', () => {
    const { remainingMs, isExhausted } = calculateRemainingBudget(1_800_000, limit30m);
    assert.equal(isExhausted, true);
    assert.equal(remainingMs, 0);
  });

  it('evaluates at 30:00.001 (1,800,001 ms) as exhausted and clamps remaining to 0', () => {
    const { remainingMs, isExhausted } = calculateRemainingBudget(1_800_001, limit30m);
    assert.equal(isExhausted, true);
    assert.equal(remainingMs, 0);
  });

  it('sanitizes daily limits safely: rejects zero, negative, NaN, and oversized limits', () => {
    assert.equal(validateDailyLimit(0), null);
    assert.equal(validateDailyLimit(-500), null);
    assert.equal(validateDailyLimit(NaN), null);
    assert.equal(validateDailyLimit(Infinity), null);
    assert.equal(validateDailyLimit('60'), null);
    assert.equal(validateDailyLimit(1800000), 1800000);
  });
});

describe('Phase 5.1 Audit: Import / Export Round-Trip & Malformed Payload Safety', () => {
  it('rejects unsupported schema versions (0, -1, 99)', () => {
    assert.equal(validateImportPayload({ schemaVersion: 0, collections: {} }).valid, false);
    assert.equal(validateImportPayload({ schemaVersion: -1, collections: {} }).valid, false);
    assert.equal(validateImportPayload({ schemaVersion: 99, collections: {} }).valid, false);
  });

  it('deeply sanitizes boundary intervals and pause configs during import', () => {
    const payload = {
      schemaVersion: 3,
      exportedAt: Date.now(),
      collections: {
        col_test: {
          id: 'col_test',
          name: 'Test',
          boundary: {
            schedule: {
              enabled: true,
              intervals: [
                {
                  days: [1, 2, 99], // 99 is invalid day
                  startMinute: -50, // negative minute
                  endMinute: 2000, // exceeds 1439
                },
              ],
            },
            pause: {
              type: 'INVALID_TYPE',
              durationSeconds: 9999, // exceeds 60s
            },
            limits: {
              dailyMinutes: 99999, // exceeds 1440
            },
          },
          targets: [],
        },
      },
      settings: {
        theme: 'invalid_theme',
      },
    };

    const res = validateImportPayload(payload);
    assert.equal(res.valid, true);

    const importedCol = (res.sanitized!.collections as Record<string, any>)['col_test'];
    assert.ok(importedCol);

    // Day 99 stripped, start clamped to 0, end clamped to 1439
    const inv = importedCol.boundary.schedule.intervals[0];
    assert.deepEqual(inv.days, [1, 2]);
    assert.equal(inv.startMinute, 0);
    assert.equal(inv.endMinute, 1439);

    // Pause sanitized to BREATHE and duration clamped to 60s
    assert.equal(importedCol.boundary.pause.type, 'BREATHE');
    assert.equal(importedCol.boundary.pause.durationSeconds, 60);

    // Daily minutes sanitized
    assert.equal(importedCol.boundary.limits.dailyMinutes, null);

    // Theme sanitized to default system
    assert.equal(res.sanitized!.settings.theme, 'system');
  });

  it('deduplicates duplicate collection IDs and target IDs safely on import', () => {
    const payload = {
      schemaVersion: 3,
      collections: {
        col_1: {
          id: 'dup_id',
          name: 'Col 1',
          targets: [
            { id: 'dup_target', pattern: 'site1.com', type: 'WEBSITE' },
            { id: 'dup_target', pattern: 'site2.com', type: 'WEBSITE' },
          ],
        },
      },
    };

    const res = validateImportPayload(payload);
    assert.equal(res.valid, true);
    const col = Object.values(res.sanitized!.collections)[0];
    assert.equal(col.targets.length, 2);
    assert.ok(col.targets[0].id !== col.targets[1].id, 'Target IDs must be deduplicated');
  });
});

describe('Phase 5.1 Audit: Message Security & Grant Duration Invariants', () => {
  it('validates message schemas and rejects malformed types', () => {
    assert.equal(isValidMessage(null), false);
    assert.equal(isValidMessage({}), false);
    assert.equal(isValidMessage({ type: 'UNKNOWN_TYPE' }), false);
    assert.equal(isValidMessage({ type: 'CREATE_RULE', collectionId: '' }), false);
    assert.equal(isValidMessage({ type: 'CREATE_RULE', collectionId: 'col', pattern: '', ruleType: 'WEBSITE' }), false);
    assert.equal(isValidMessage({ type: 'UPDATE_COLLECTION', collectionId: '' }), false);
  });

  it('preserves Phase 1.1 / 3.1 grant duration ceiling (max 10 minutes)', () => {
    // 24 hours requested -> clamped to 10 minutes (600,000 ms)
    const clamped = resolveGrantDuration(24 * 60 * 60 * 1000);
    assert.equal(clamped, 10 * 60 * 1000);

    // 0 requested -> falls back to DEFAULT_GRANT_DURATION_MS (60,000 ms)
    const minClamped = resolveGrantDuration(0);
    assert.equal(minClamped, 60 * 1000);
  });
});
