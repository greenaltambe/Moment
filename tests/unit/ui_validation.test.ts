/**
 * Unit Tests: Phase 5 UI Domain Validators and Schedule Formatters
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCollectionName,
  validateTargetPattern,
  formatMinuteToTime12h,
  formatScheduleNaturalLanguage,
  validateImportPayload,
} from '../../dist/chrome/core/validation/rules.js';
import type { ScheduleConfig } from '../../src/core/models/boundary.js';

describe('Phase 5 UI: Collection Name Validation', () => {
  it('accepts valid collection names and trims whitespace', () => {
    const res1 = validateCollectionName('Focus');
    assert.equal(res1.valid, true);
    assert.equal(res1.sanitized, 'Focus');

    const res2 = validateCollectionName('  Social Media  ');
    assert.equal(res2.valid, true);
    assert.equal(res2.sanitized, 'Social Media');
  });

  it('rejects empty or whitespace-only names', () => {
    assert.equal(validateCollectionName('').valid, false);
    assert.equal(validateCollectionName('   ').valid, false);
  });

  it('rejects names exceeding 64 characters', () => {
    const longName = 'a'.repeat(65);
    const res = validateCollectionName(longName);
    assert.equal(res.valid, false);
    assert.ok((res.error || '').includes('64 characters'));
  });

  it('rejects non-string inputs', () => {
    assert.equal(validateCollectionName(null).valid, false);
    assert.equal(validateCollectionName(123).valid, false);
    assert.equal(validateCollectionName({}).valid, false);
  });
});

describe('Phase 5 UI: Target Pattern Validation Across Modes', () => {
  describe('WEBSITE Mode', () => {
    it('accepts valid domains and strips protocol/trailing slash', () => {
      const r1 = validateTargetPattern('example.com', 'WEBSITE');
      assert.equal(r1.valid, true);
      assert.equal(r1.sanitized, 'example.com');

      const r2 = validateTargetPattern('https://Sub.Example.COM/', 'WEBSITE');
      assert.equal(r2.valid, true);
      assert.equal(r2.sanitized, 'sub.example.com');
    });

    it('rejects paths or query strings in WEBSITE mode', () => {
      const r1 = validateTargetPattern('example.com/feed', 'WEBSITE');
      assert.equal(r1.valid, false);

      const r2 = validateTargetPattern('example.com?q=1', 'WEBSITE');
      assert.equal(r2.valid, false);
    });

    it('rejects wildcards in WEBSITE mode', () => {
      const r = validateTargetPattern('*.example.com', 'WEBSITE');
      assert.equal(r.valid, false);
    });
  });

  describe('EXACT_HOST Mode', () => {
    it('accepts exact hostnames without paths or wildcards', () => {
      const r = validateTargetPattern('https://app.slack.com', 'EXACT_HOST');
      assert.equal(r.valid, true);
      assert.equal(r.sanitized, 'app.slack.com');
    });

    it('rejects wildcards or paths in EXACT_HOST mode', () => {
      assert.equal(validateTargetPattern('*.slack.com', 'EXACT_HOST').valid, false);
      assert.equal(validateTargetPattern('app.slack.com/messages', 'EXACT_HOST').valid, false);
    });
  });

  describe('PATH_PREFIX Mode', () => {
    it('accepts host with valid path prefix', () => {
      const r1 = validateTargetPattern('reddit.com/r/all', 'PATH_PREFIX');
      assert.equal(r1.valid, true);
      assert.equal(r1.sanitized, 'reddit.com/r/all');

      const r2 = validateTargetPattern('https://news.ycombinator.com/item', 'PATH_PREFIX');
      assert.equal(r2.valid, true);
      assert.equal(r2.sanitized, 'news.ycombinator.com/item');
    });

    it('rejects path prefix without path component', () => {
      const r = validateTargetPattern('reddit.com', 'PATH_PREFIX');
      assert.equal(r.valid, false);
    });
  });

  describe('EXACT_PAGE Mode', () => {
    it('accepts exact page URLs', () => {
      const r = validateTargetPattern('https://example.com/login.html', 'EXACT_PAGE');
      assert.equal(r.valid, true);
      assert.equal(r.sanitized, 'example.com/login.html');
    });

    it('rejects host-only in EXACT_PAGE mode', () => {
      const r = validateTargetPattern('example.com', 'EXACT_PAGE');
      assert.equal(r.valid, false);
    });
  });

  describe('GLOB Mode', () => {
    it('accepts valid glob patterns', () => {
      const r = validateTargetPattern('*.reddit.com/*popular*', 'GLOB');
      assert.equal(r.valid, true);
      assert.equal(r.sanitized, '*.reddit.com/*popular*');
    });

    it('rejects empty or whitespace glob patterns', () => {
      assert.equal(validateTargetPattern('', 'GLOB').valid, false);
      assert.equal(validateTargetPattern('   ', 'GLOB').valid, false);
    });
  });
});

describe('Phase 5 UI: 12-Hour Minute Formatter', () => {
  it('formats morning, noon, afternoon, evening, midnight correctly', () => {
    assert.equal(formatMinuteToTime12h(0), '12:00 AM');
    assert.equal(formatMinuteToTime12h(1), '12:01 AM');
    assert.equal(formatMinuteToTime12h(540), '9:00 AM');
    assert.equal(formatMinuteToTime12h(720), '12:00 PM');
    assert.equal(formatMinuteToTime12h(750), '12:30 PM');
    assert.equal(formatMinuteToTime12h(1020), '5:00 PM');
    assert.equal(formatMinuteToTime12h(1320), '10:00 PM');
    assert.equal(formatMinuteToTime12h(1439), '11:59 PM');
  });
});

describe('Phase 5 UI: Natural Language Schedule Formatter', () => {
  it('returns "Always active (24/7)" for disabled or empty schedules', () => {
    assert.equal(formatScheduleNaturalLanguage(null), 'Always active (24/7)');
    assert.equal(formatScheduleNaturalLanguage(undefined), 'Always active (24/7)');
    assert.equal(formatScheduleNaturalLanguage({ enabled: false, intervals: [] }), 'Always active (24/7)');
  });

  it('formats everyday daytime interval', () => {
    const config: ScheduleConfig = {
      enabled: true,
      intervals: [{
        days: [0, 1, 2, 3, 4, 5, 6],
        startMinute: 540, // 9:00 AM
        endMinute: 1020, // 5:00 PM
      }],
    };
    assert.equal(formatScheduleNaturalLanguage(config), 'Every day from 9:00 AM to 5:00 PM');
  });

  it('formats overnight interval spanning midnight', () => {
    const config: ScheduleConfig = {
      enabled: true,
      intervals: [{
        days: [0, 1, 2, 3, 4, 5, 6],
        startMinute: 1320, // 10:00 PM
        endMinute: 420, // 7:00 AM
      }],
    };
    assert.equal(formatScheduleNaturalLanguage(config), 'Every day overnight from 10:00 PM to 7:00 AM');
  });

  it('formats weekdays interval', () => {
    const config: ScheduleConfig = {
      enabled: true,
      intervals: [{
        days: [1, 2, 3, 4, 5],
        startMinute: 540,
        endMinute: 1020,
      }],
    };
    assert.equal(formatScheduleNaturalLanguage(config), 'Weekdays (Mon–Fri) from 9:00 AM to 5:00 PM');
  });

  it('formats weekends interval', () => {
    const config: ScheduleConfig = {
      enabled: true,
      intervals: [{
        days: [0, 6],
        startMinute: 600,
        endMinute: 1200,
      }],
    };
    assert.equal(formatScheduleNaturalLanguage(config), 'Weekends (Sat–Sun) from 10:00 AM to 8:00 PM');
  });
});

describe('Phase 5 UI: Import Payload Validator', () => {
  it('accepts valid export payload with collections and settings', () => {
    const payload = {
      schemaVersion: 3,
      exportedAt: Date.now(),
      collections: {
        col_focus: {
          id: 'col_focus',
          name: 'Focus',
          color: '#15803d',
          icon: 'shield',
          enabled: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          dailyLimitMs: 1800000,
          targets: [
            {
              id: 't_1',
              pattern: 'reddit.com',
              type: 'WEBSITE',
              isException: false,
              createdAt: Date.now(),
            },
          ],
          boundary: {
            schedule: { enabled: false, intervals: [] },
            limits: { dailyMinutes: 30, sessionMinutes: null },
            pause: { type: 'BREATHE', durationSeconds: 10, requireIntentionText: false },
            action: { type: 'BLOCK_PAGE', redirectUrl: null },
            strictMode: false,
          },
        },
      },
      settings: {
        theme: 'dark',
        timeFormat: '24h',
        reducedMotion: false,
        allowPrivateBrowsing: false,
      },
    };

    const res = validateImportPayload(payload);
    assert.equal(res.valid, true);
    assert.equal(Object.keys(res.sanitized!.collections).length, 1);
  });

  it('rejects payload if schemaVersion is missing or invalid', () => {
    assert.equal(validateImportPayload(null).valid, false);
    assert.equal(validateImportPayload('not json').valid, false);
    assert.equal(validateImportPayload({ schemaVersion: 'invalid' }).valid, false);
    assert.equal(validateImportPayload({ schemaVersion: 99 }).valid, false);
  });

  it('rejects payload if collection target has invalid pattern', () => {
    const badPayload = {
      schemaVersion: 3,
      collections: {
        col_bad: {
          id: 'col_bad',
          name: 'Bad Collection',
          targets: [
            {
              id: 't_bad',
              pattern: 'invalid/with/path',
              type: 'WEBSITE', // WEBSITE mode cannot have path
            },
          ],
        },
      },
    };

    const res = validateImportPayload(badPayload);
    assert.equal(res.valid, false);
    assert.ok((res.error || '').includes('Invalid target pattern'));
  });
});
