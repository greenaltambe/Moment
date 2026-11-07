import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MomentDecisionEngine } from '../../dist/chrome/core/decisions/engine.js';
import { resolveEffectiveLimitMs } from '../../dist/chrome/core/usage/accounting.js';
import { isValidMessage } from '../../dist/chrome/shared/messages.js';
import { migrateStorageState } from '../../dist/chrome/storage/migrations.js';

const MIN = 60_000;
const makeCol = (over: any = {}): any => ({
  id: 'c1', name: 'Video', enabled: true, createdAt: 1, updatedAt: 1, dailyLimitMs: 10 * MIN,
  targets: [{ id: 't1', pattern: 'youtube.com', type: 'WEBSITE', isException: false, createdAt: 1 }],
  boundary: {
    schedule: { enabled: false, intervals: [] },
    limits: { dailyMinutes: null, sessionMinutes: null },
    pause: { type: 'BREATHE', durationSeconds: 10, requireIntentionText: false },
    action: { type: 'BLOCK_PAGE', redirectUrl: null }, strictMode: false,
  },
  ...over,
});
const evalAt = (col: any, used: number, ext = 0, focus: any = null) =>
  new MomentDecisionEngine({ c1: col }).evaluate({
    url: 'https://www.youtube.com/', tabId: 1, timestamp: 1_000_000, collections: { c1: col },
    activeGrants: [], dailyUsageMs: { c1: used }, dailyExtensionMs: ext ? { c1: ext } : undefined, focusSession: focus,
  } as any);

describe('Daily budget model', () => {
  it('is free under budget, blocks once spent', () => {
    assert.deepEqual([evalAt(makeCol(), 0).action, evalAt(makeCol(), 0).reason], ['ALLOW', 'WITHIN_DAILY_BUDGET']);
    assert.equal(evalAt(makeCol(), 9 * MIN).action, 'ALLOW');
    const spent = evalAt(makeCol(), 10 * MIN);
    assert.equal(spent.action, 'BLOCK');
    assert.equal(spent.reason, 'DAILY_LIMIT_EXHAUSTED');
  });

  it('extensions raise the effective limit', () => {
    assert.equal(evalAt(makeCol(), 12 * MIN, 5 * MIN).action, 'ALLOW');
    assert.equal(evalAt(makeCol(), 15 * MIN, 5 * MIN).action, 'BLOCK');
    assert.equal(resolveEffectiveLimitMs(makeCol(), 5 * MIN), 15 * MIN);
    assert.equal(resolveEffectiveLimitMs(makeCol({ dailyLimitMs: null }), 5 * MIN), null);
    assert.equal(resolveEffectiveLimitMs(makeCol(), -5), 10 * MIN);
  });

  it('collections without a limit keep their pause on every visit', () => {
    const d = evalAt(makeCol({ dailyLimitMs: null }), 999 * MIN);
    assert.equal(d.action, 'INTERVENE');
  });

  it('Strict Block with a limit: open under budget, blocked after', () => {
    const strict = makeCol({ boundary: { ...makeCol().boundary, pause: { type: 'NONE', durationSeconds: 0, requireIntentionText: false } } });
    assert.equal(evalAt(strict, MIN).action, 'ALLOW');
    assert.equal(evalAt(strict, 11 * MIN).action, 'BLOCK');
  });

  it('Focus Mode stays stricter than the budget while under budget', () => {
    const focus = { id: 'f', startedAt: 0, expiresAt: 2_000_000, durationMs: 2_000_000, selectedCollectionIds: ['c1'], status: 'ACTIVE' };
    const d = evalAt(makeCol(), MIN, 0, focus);
    assert.equal(d.reason, 'FOCUS_MODE');
    assert.equal(d.action, 'INTERVENE');
  });

  it('outside a schedule window the budget is not applied', () => {
    const scheduled = makeCol({ boundary: { ...makeCol().boundary, schedule: { enabled: true, intervals: [] } } });
    assert.equal(evalAt(scheduled, 99 * MIN).reason, 'SCHEDULE_INACTIVE');
  });
});

describe('Budget messages & storage', () => {
  it('validates the new messages', () => {
    assert.ok(isValidMessage({ type: 'GET_BUDGET_STATUS', collectionId: 'c1' }));
    assert.ok(!isValidMessage({ type: 'GET_BUDGET_STATUS' }));
    assert.ok(isValidMessage({ type: 'REQUEST_BUDGET_EXTENSION', collectionId: 'c1', intentionText: 'reply once' }));
    assert.ok(!isValidMessage({ type: 'REQUEST_BUDGET_EXTENSION', collectionId: 'c1' }));
  });

  it('migration preserves extension fields on usage records', () => {
    const state: any = migrateStorageState({
      schemaVersion: 3, settings: {}, collections: {},
      usage: { '2026-11-07:c1': { dateKey: '2026-11-07', collectionId: 'c1', accumulatedMs: 5, updatedAt: 1, extendedMs: 300000, extensionCount: 1 } },
      runtime: {},
    });
    assert.equal(state.usage['2026-11-07:c1'].extendedMs, 300000);
    assert.equal(state.usage['2026-11-07:c1'].extensionCount, 1);
  });
});

import { isFocusRelevantCollection, getFocusEndGate } from '../../dist/chrome/core/focus/focus-validator.js';
import { isValidMessage as validMsg } from '../../dist/chrome/shared/messages.js';

describe('Focus Mode usefulness & early-end friction', () => {
  it('only lists collections Focus Mode would change', () => {
    assert.equal(isFocusRelevantCollection(makeCol({ dailyLimitMs: null })), false); // always on, no limit
    assert.equal(isFocusRelevantCollection(makeCol()), true); // has a daily limit
    const scheduled = makeCol({ dailyLimitMs: null });
    scheduled.boundary = { ...scheduled.boundary, schedule: { enabled: true, intervals: [] } };
    assert.equal(isFocusRelevantCollection(scheduled), true);
    assert.equal(isFocusRelevantCollection(makeCol({ enabled: false })), false);
    assert.equal(isFocusRelevantCollection(null as any), false);
  });

  const session = (over: any = {}): any => ({ id: 'f', startedAt: 0, expiresAt: 9e9, durationMs: 1, selectedCollectionIds: ['c1'], status: 'ACTIVE', ...over });

  it('ending early requires a recent request and a short wait', () => {
    assert.deepEqual(getFocusEndGate(session(), 1000).needsRequest, true);
    const asked = session({ endRequestedAt: 100_000 });
    assert.equal(getFocusEndGate(asked, 103_000).allowed, false);
    assert.equal(getFocusEndGate(asked, 109_500).allowed, true); // 10s minus 1s tolerance
    const stale = getFocusEndGate(asked, 100_000 + 6 * 60_000);
    assert.equal(stale.allowed, false);
    assert.equal(stale.needsRequest, true);
  });

  it('validates the new focus messages', () => {
    assert.ok(validMsg({ type: 'REQUEST_END_FOCUS_MODE' }));
    assert.ok(validMsg({ type: 'END_FOCUS_MODE' }));
    assert.ok(validMsg({ type: 'END_FOCUS_MODE', intentionText: 'done early' }));
    assert.ok(!validMsg({ type: 'END_FOCUS_MODE', intentionText: 5 }));
  });
});
