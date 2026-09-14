import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isBoundaryActive, isTimeInInterval } from '../../dist/chrome/core/policies/boundary-evaluator.js';
import type { BoundaryPolicy } from '../../src/core/models/boundary.js';

describe('Moment Boundary & Schedule Engine', () => {
  const basePolicy: BoundaryPolicy = {
    schedule: {
      enabled: false,
      intervals: [],
    },
    limits: { dailyMinutes: null, sessionMinutes: null },
    pause: { type: 'NONE', durationSeconds: 0, requireIntentionText: false },
    action: { type: 'BLOCK_PAGE', redirectUrl: null },
    strictMode: false,
  };

  it('Always-active boundary (schedule.enabled === false) is active 24/7', () => {
    assert.equal(isBoundaryActive(basePolicy, Date.now()), true);
    assert.equal(isBoundaryActive(basePolicy, 0), true);
  });

  it('Daytime schedule interval enforces inclusive start and exclusive end', () => {
    // Monday to Friday: 09:00 (540) to 17:00 (1020)
    const interval = {
      days: [1, 2, 3, 4, 5],
      startMinute: 540,
      endMinute: 1020,
    };

    // Monday (1)
    assert.equal(isTimeInInterval(1, 539, interval), false); // 08:59 -> inactive
    assert.equal(isTimeInInterval(1, 540, interval), true);  // 09:00 -> active (inclusive start)
    assert.equal(isTimeInInterval(1, 800, interval), true);  // 13:20 -> active
    assert.equal(isTimeInInterval(1, 1019, interval), true); // 16:59 -> active
    assert.equal(isTimeInInterval(1, 1020, interval), false);// 17:00 -> inactive (exclusive end)
    assert.equal(isTimeInInterval(1, 1021, interval), false);// 17:01 -> inactive

    // Saturday (6) -> outside scheduled days
    assert.equal(isTimeInInterval(6, 600, interval), false);
  });

  it('Overnight interval (22:00 -> 07:00) correctly spans midnight with exact endpoints', () => {
    // Monday night into Tuesday morning: 22:00 (1320) to 07:00 (420)
    const interval = {
      days: [1], // Scheduled for Monday
      startMinute: 1320, // 22:00
      endMinute: 420,    // 07:00
    };

    // Monday (day 1) evening
    assert.equal(isTimeInInterval(1, 1319, interval), false); // 21:59 -> inactive
    assert.equal(isTimeInInterval(1, 1320, interval), true);  // 22:00 -> active (inclusive start)
    assert.equal(isTimeInInterval(1, 1439, interval), true);  // 23:59 -> active

    // Tuesday (day 2) morning (spanned midnight)
    assert.equal(isTimeInInterval(2, 0, interval), true);    // 00:00 -> active
    assert.equal(isTimeInInterval(2, 419, interval), true);  // 06:59 -> active
    assert.equal(isTimeInInterval(2, 420, interval), false); // 07:00 -> inactive (exclusive end)
    assert.equal(isTimeInInterval(2, 421, interval), false); // 07:01 -> inactive

    // Wednesday (day 3) -> outside window
    assert.equal(isTimeInInterval(3, 1320, interval), false);
  });

  it('Evaluates isBoundaryActive against real Date timestamps', () => {
    // Active on Mondays 09:00 - 12:00
    const policy: BoundaryPolicy = {
      ...basePolicy,
      schedule: {
        enabled: true,
        intervals: [
          { days: [1], startMinute: 9 * 60, endMinute: 12 * 60 },
        ],
      },
    };

    // Create a known Monday at 10:30 UTC
    const mondayMorning = new Date();
    // Set to Monday (day 1)
    const currentDay = mondayMorning.getDay();
    const diff = (1 - currentDay + 7) % 7;
    mondayMorning.setDate(mondayMorning.getDate() + diff);
    mondayMorning.setHours(10, 30, 0, 0);

    assert.equal(isBoundaryActive(policy, mondayMorning.getTime()), true);

    // Change to 14:00 (outside window)
    mondayMorning.setHours(14, 0, 0, 0);
    assert.equal(isBoundaryActive(policy, mondayMorning.getTime()), false);
  });

  it('Safe fail-closed fallback on null policy or empty intervals', () => {
    assert.equal(isBoundaryActive(null, Date.now()), true);
    assert.equal(isBoundaryActive(undefined, Date.now()), true);

    const emptyIntervalPolicy: BoundaryPolicy = {
      ...basePolicy,
      schedule: { enabled: true, intervals: [] },
    };
    assert.equal(isBoundaryActive(emptyIntervalPolicy, Date.now()), false);
  });
});
