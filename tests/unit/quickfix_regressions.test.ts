import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCanonicalUrl } from '../../dist/chrome/core/matching/url.js';
import { matchTarget } from '../../dist/chrome/core/matching/matcher.js';
import { MomentDecisionEngine } from '../../dist/chrome/core/decisions/engine.js';
import { buildPassAlarmName, parsePassAlarmName } from '../../dist/chrome/background/alarm-names.js';

const site = (pattern: string, type = 'WEBSITE') =>
  ({ id: 't1', pattern, type, isException: false, createdAt: 1 }) as any;

describe('Trailing-dot hostname bypass', () => {
  it('canonicalizes trailing dots away', () => {
    assert.equal(parseCanonicalUrl('https://www.youtube.com./')!.hostname, 'www.youtube.com');
    assert.equal(parseCanonicalUrl('https://youtube.com.:443/watch')!.hostname, 'youtube.com');
    assert.equal(parseCanonicalUrl('https://youtube.com../')?.hostname ?? 'x', 'youtube.com');
  });

  it('WEBSITE, EXACT_HOST and GLOB rules match dotted hosts', () => {
    const u = parseCanonicalUrl('https://www.youtube.com./watch?v=1')!;
    assert.ok(matchTarget(site('youtube.com'), u));
    assert.ok(matchTarget(site('www.youtube.com', 'EXACT_HOST'), u));
    assert.ok(matchTarget(site('*.youtube.com', 'GLOB'), u));
  });

  it('does not over-match unrelated hosts', () => {
    const u = parseCanonicalUrl('https://notyoutube.com./')!;
    assert.equal(matchTarget(site('youtube.com'), u), false);
  });

  it('engine blocks/intervenes on the dotted host', () => {
    const col: any = {
      id: 'c1', name: 'Video', enabled: true, createdAt: 1, updatedAt: 1, dailyLimitMs: null,
      targets: [site('youtube.com')],
      boundary: {
        schedule: { enabled: false, intervals: [] },
        limits: { dailyMinutes: null, sessionMinutes: null },
        pause: { type: 'BREATHE', durationSeconds: 10, requireIntentionText: false },
        action: { type: 'BLOCK_PAGE', redirectUrl: null }, strictMode: false,
      },
    };
    const e = new MomentDecisionEngine({ c1: col });
    const d = e.evaluate({ url: 'https://www.youtube.com./', tabId: 1, timestamp: Date.now(),
      collections: { c1: col }, activeGrants: [], dailyUsageMs: {}, focusSession: null } as any);
    assert.ok(d.action !== 'ALLOW');
  });
});

describe('Pass-expiration alarm names', () => {
  it('round-trips both pass types', () => {
    for (const type of ['INTENT_PASS', 'SITE_PASS'] as const) {
      const name = buildPassAlarmName(type, 42, 1700000000000);
      assert.deepEqual(parsePassAlarmName(name), { passType: type, tabId: 42, expiresAt: 1700000000000 });
    }
  });

  it('rejects unrelated or malformed names', () => {
    assert.equal(parsePassAlarmName('flush_usage'), null);
    assert.equal(parsePassAlarmName('pass_expire_OTHER_1_2'), null);
    assert.equal(parsePassAlarmName('pass_expire_SITE_PASS_x_2'), null);
  });
});

import { buildPassWarnAlarmName, parsePassWarnAlarmName } from '../../dist/chrome/background/alarm-names.js';
import { hasPauseElapsed, requiredPauseMs } from '../../dist/chrome/core/interventions/state-machine.js';

describe('Pause enforcement & warning alarms', () => {
  const pending = (over: any = {}): any => ({
    id: 'i', tabId: 1, targetUrl: 'https://x.com/', collectionId: 'c', interventionType: 'TIMER',
    durationSeconds: 10, requireIntentionText: false, createdAt: 1000, updatedAt: 1000, nonce: 'n', status: 'PRESENTED', ...over,
  });

  it('requires the pause to have elapsed (with tolerance)', () => {
    assert.equal(hasPauseElapsed(pending(), 1000 + 3000), false);
    assert.equal(hasPauseElapsed(pending(), 1000 + 8600), true); // 10s - 1.5s tolerance
    assert.equal(hasPauseElapsed(pending({ presentedAt: 5000 }), 5000 + 3000), false);
    assert.equal(hasPauseElapsed(pending({ presentedAt: 5000 }), 5000 + 10_000), true);
  });

  it('CONFIRM has no wait; BREATHE is capped at 10s', () => {
    assert.equal(requiredPauseMs('CONFIRM', 30), 0);
    assert.equal(requiredPauseMs('NONE', 30), 0);
    assert.equal(requiredPauseMs('BREATHE', 30), 10_000);
    assert.equal(requiredPauseMs('TIMER', 30), 30_000);
    assert.equal(hasPauseElapsed(pending({ interventionType: 'CONFIRM' }), 1000), true);
  });

  it('warn alarm names round-trip and do not collide with expiry alarms', () => {
    const n = buildPassWarnAlarmName('SITE_PASS', 7, 123456);
    assert.deepEqual(parsePassWarnAlarmName(n), { passType: 'SITE_PASS', tabId: 7, expiresAt: 123456 });
    assert.equal(parsePassAlarmName(n), null);
    assert.equal(parsePassWarnAlarmName(buildPassAlarmName('SITE_PASS', 7, 123456)), null);
  });
});
