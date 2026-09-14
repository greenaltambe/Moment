import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getLocalDateKey,
  calculateActiveDelta,
  splitIntervalAtMidnight,
  validateDailyLimit,
  resolveCollectionLimitMs,
  calculateRemainingBudget,
  buildCollectionUsageBudget,
  getUsageRecordKey,
  formatDuration,
} from '../../dist/chrome/core/usage/accounting.js';
import { MAX_DISCRETE_ACTIVE_DELTA_MS } from '../../dist/chrome/shared/constants.js';

describe('Moment Core Usage Accounting Engine (Phase 4)', () => {
  describe('Calendar Date Key & Keys', () => {
    it('formats local date key correctly YYYY-MM-DD', () => {
      const fixedDate = new Date(2026, 8, 8, 14, 30, 0); // Sept 8, 2026 (0-indexed month 8 = Sept)
      assert.equal(getLocalDateKey(fixedDate), '2026-09-08');
    });

    it('generates standardized storage usage key', () => {
      assert.equal(getUsageRecordKey('2026-09-08', 'col_social'), '2026-09-08:col_social');
    });
  });

  describe('Active Delta Calculation & Discontinuity Defense', () => {
    it('accurately calculates normal elapsed delta within bounds', () => {
      const start = 1_000_000;
      const end = start + 15_000; // 15 seconds
      assert.equal(calculateActiveDelta(start, end), 15_000);
    });

    it('Audit 3: Matrix of short, medium, and large intervals', () => {
      const base = 10_000_000;
      // Legitimate short intervals preserved exactly:
      assert.equal(calculateActiveDelta(base, base + 10_000), 10_000);   // 10s
      assert.equal(calculateActiveDelta(base, base + 30_000), 30_000);   // 30s
      assert.equal(calculateActiveDelta(base, base + 59_000), 59_000);   // 59s
      assert.equal(calculateActiveDelta(base, base + 60_000), 60_000);   // 60s

      // Discontinuous / sleep-like intervals clamped to MAX_DISCRETE_ACTIVE_DELTA_MS:
      assert.equal(calculateActiveDelta(base, base + 61_000), 60_000);   // 61s clamped
      assert.equal(calculateActiveDelta(base, base + 300_000), 60_000);  // 5min clamped
      assert.equal(calculateActiveDelta(base, base + 3_600_000), 60_000);// 1h clamped
      assert.equal(calculateActiveDelta(base, base + 10_800_000), 60_000);// 3h clamped
    });

    it('handles clock rollback safely (returns 0 delta)', () => {
      const start = 1_000_000;
      // Modest backwards adjustment (-500ms, -5s)
      assert.equal(calculateActiveDelta(start, start - 500), 0);
      assert.equal(calculateActiveDelta(start, start - 5000), 0);
      // Large backwards adjustment (-65 minutes)
      assert.equal(calculateActiveDelta(start, start - 65 * 60 * 1000), 0);
    });

    it('returns 0 when start equals current timestamp', () => {
      const now = 1_000_000;
      assert.equal(calculateActiveDelta(now, now), 0);
    });

    it('clamps machine sleep / OS suspension exceeding MAX_DISCRETE_ACTIVE_DELTA_MS to 60s', () => {
      const start = 1_000_000;
      const sleepingLaptopWakeup = start + 3 * 60 * 60 * 1000; // 3 hours of sleep
      const delta = calculateActiveDelta(start, sleepingLaptopWakeup, MAX_DISCRETE_ACTIVE_DELTA_MS);
      assert.equal(delta, MAX_DISCRETE_ACTIVE_DELTA_MS);
      assert.equal(delta, 60_000);
    });

    it('handles large integer safe bounds without overflow', () => {
      const base = 1_000_000;
      const hugeTime = Number.MAX_SAFE_INTEGER;
      assert.equal(calculateActiveDelta(base, hugeTime), 60_000); // Safely clamped
    });
  });

  describe('Local Calendar Midnight Splitting', () => {
    it('returns single slice when interval is entirely within the same calendar day', () => {
      const start = new Date(2026, 8, 8, 10, 0, 0).getTime();
      const end = new Date(2026, 8, 8, 10, 15, 0).getTime();
      const slices = splitIntervalAtMidnight(start, end);

      assert.equal(slices.length, 1);
      assert.equal(slices[0].dateKey, '2026-09-08');
      assert.equal(slices[0].durationMs, 15 * 60 * 1000);
    });

    it('accurately splits interval spanning across local midnight into two days', () => {
      // 23:59:40 to 00:00:20 (40s total: 20s in yesterday, 20s in today)
      const yesterdayNight = new Date(2026, 8, 8, 23, 59, 40).getTime();
      const todayMorning = new Date(2026, 8, 9, 0, 0, 20).getTime();

      const slices = splitIntervalAtMidnight(yesterdayNight, todayMorning);
      assert.equal(slices.length, 2);
      assert.equal(slices[0].dateKey, '2026-09-08');
      assert.equal(slices[0].durationMs, 20_000);
      assert.equal(slices[1].dateKey, '2026-09-09');
      assert.equal(slices[1].durationMs, 20_000);
    });

    it('Audit 8: Exact 23:59:59 -> 00:00:00 boundary interval', () => {
      const at59 = new Date(2026, 8, 8, 23, 59, 59).getTime();
      const at00 = new Date(2026, 8, 9, 0, 0, 0).getTime();

      const slices = splitIntervalAtMidnight(at59, at00);
      assert.equal(slices.length, 1);
      assert.equal(slices[0].dateKey, '2026-09-08');
      assert.equal(slices[0].durationMs, 1000);
    });

    it('Audit 8: Exact 23:59:59 -> 00:00:01 boundary interval', () => {
      const at59 = new Date(2026, 8, 8, 23, 59, 59).getTime();
      const at01 = new Date(2026, 8, 9, 0, 0, 1).getTime();

      const slices = splitIntervalAtMidnight(at59, at01);
      assert.equal(slices.length, 2);
      assert.equal(slices[0].dateKey, '2026-09-08');
      assert.equal(slices[0].durationMs, 1000);
      assert.equal(slices[1].dateKey, '2026-09-09');
      assert.equal(slices[1].durationMs, 1000);
    });

    it('returns empty array when start >= end', () => {
      const now = 1000;
      assert.deepEqual(splitIntervalAtMidnight(now, now), []);
      assert.deepEqual(splitIntervalAtMidnight(now, now - 10), []);
    });
  });

  describe('Daily Limit Validation & Resolution', () => {
    it('validates daily limit duration numbers correctly', () => {
      assert.equal(validateDailyLimit(60000), 60000);
      assert.equal(validateDailyLimit(3600000.7), 3600000); // Truncates floats
      assert.equal(validateDailyLimit(0), null);
      assert.equal(validateDailyLimit(-500), null);
      assert.equal(validateDailyLimit(-1000), null);
      assert.equal(validateDailyLimit(NaN), null);
      assert.equal(validateDailyLimit(Infinity), null);
      assert.equal(validateDailyLimit(-Infinity), null);
      assert.equal(validateDailyLimit('60000'), null);
      assert.equal(validateDailyLimit(null), null);
      assert.equal(validateDailyLimit(undefined), null);
    });

    it('resolves collection daily limit ms preferring direct dailyLimitMs', () => {
      const col = {
        dailyLimitMs: 1_800_000, // 30 minutes
        boundary: {
          limits: { dailyMinutes: 45 },
        },
      };
      assert.equal(resolveCollectionLimitMs(col), 1_800_000);
    });

    it('falls back to boundary.limits.dailyMinutes converted to ms', () => {
      const col = {
        dailyLimitMs: null,
        boundary: {
          limits: { dailyMinutes: 20 },
        },
      };
      assert.equal(resolveCollectionLimitMs(col), 20 * 60 * 1000);
    });

    it('returns null when no valid limit is configured', () => {
      assert.equal(resolveCollectionLimitMs({}), null);
      assert.equal(resolveCollectionLimitMs({ dailyLimitMs: null }), null);
      assert.equal(
        resolveCollectionLimitMs({ boundary: { limits: { dailyMinutes: null } } }),
        null
      );
    });
  });

  describe('Remaining Budget & Exhaustion Calculation', () => {
    it('Audit 9: Millisecond boundary precision at 29:59.999, 30:00.000, 30:00.001', () => {
      const limitMs = 30 * 60 * 1000; // 1,800,000 ms

      // 29:59.999 = 1,799,999 ms -> remaining 1ms, NOT exhausted
      const b1 = calculateRemainingBudget(1_799_999, limitMs);
      assert.equal(b1.remainingMs, 1);
      assert.equal(b1.isExhausted, false);

      // 30:00.000 = 1,800,000 ms -> remaining 0ms, exhausted
      const b2 = calculateRemainingBudget(1_800_000, limitMs);
      assert.equal(b2.remainingMs, 0);
      assert.equal(b2.isExhausted, true);

      // 30:00.001 = 1,800,001 ms -> remaining 0ms, exhausted
      const b3 = calculateRemainingBudget(1_800_001, limitMs);
      assert.equal(b3.remainingMs, 0);
      assert.equal(b3.isExhausted, true);
    });

    it('returns remaining ms and isExhausted = false when used < limit', () => {
      const limitMs = 30 * 60 * 1000; // 30m
      const usedMs = 10 * 60 * 1000; // 10m
      const budget = calculateRemainingBudget(usedMs, limitMs);

      assert.equal(budget.remainingMs, 20 * 60 * 1000);
      assert.equal(budget.isExhausted, false);
    });

    it('marks budget as exhausted when used equals limit', () => {
      const limitMs = 30 * 60 * 1000;
      const usedMs = 30 * 60 * 1000;
      const budget = calculateRemainingBudget(usedMs, limitMs);

      assert.equal(budget.remainingMs, 0);
      assert.equal(budget.isExhausted, true);
    });

    it('marks budget as exhausted and clamps remaining to 0 when used exceeds limit', () => {
      const limitMs = 30 * 60 * 1000;
      const usedMs = 35 * 60 * 1000;
      const budget = calculateRemainingBudget(usedMs, limitMs);

      assert.equal(budget.remainingMs, 0);
      assert.equal(budget.isExhausted, true);
    });

    it('returns null remainingMs and isExhausted = false when no limit configured', () => {
      const budget = calculateRemainingBudget(100_000, null);
      assert.equal(budget.remainingMs, null);
      assert.equal(budget.isExhausted, false);
    });

    it('buildCollectionUsageBudget builds complete structure', () => {
      const view = buildCollectionUsageBudget('col1', '2026-09-08', 5000, 10000);
      assert.equal(view.collectionId, 'col1');
      assert.equal(view.dateKey, '2026-09-08');
      assert.equal(view.usedMs, 5000);
      assert.equal(view.limitMs, 10000);
      assert.equal(view.remainingMs, 5000);
      assert.equal(view.isExhausted, false);
    });
  });

  describe('Calm Human-Readable Duration Formatter', () => {
    it('formats durations calmly and cleanly', () => {
      assert.equal(formatDuration(0), '0m');
      assert.equal(formatDuration(-100), '0m');
      assert.equal(formatDuration(15_000), '15s');
      assert.equal(formatDuration(59_000), '59s');
      assert.equal(formatDuration(60_000), '1m');
      assert.equal(formatDuration(12 * 60 * 1000), '12m');
      assert.equal(formatDuration(60 * 60 * 1000), '1h');
      assert.equal(formatDuration(75 * 60 * 1000), '1h 15m');
      assert.equal(formatDuration(2 * 60 * 60 * 1000), '2h');
    });
  });
});
