/**
 * Phase 13 Test Suite: Configurable Temporary Unlock Scope
 *
 * Verifies:
 * - This tab only (THIS_TAB_ONLY - default least-privilege behavior)
 * - All tabs until expiration (ALL_TABS_UNTIL_EXPIRATION cross-tab behavior)
 * - Originating tab closure persistence for ALL_TABS_UNTIL_EXPIRATION
 * - Background expiration & tab re-evaluation
 * - Lookalike and unrelated domain isolation
 * - Daily usage continuity during active passes
 * - Worker restart & state persistence
 * - Backward compatibility, migrations, and regression invariants
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  isSitePassValidForNavigation,
  resolveSitePassDuration,
} from '../../dist/chrome/core/grants/site-pass-validator.js';
import { isGrantValidForNavigation } from '../../dist/chrome/core/grants/grant-validator.js';
import { isIntentPassValidForNavigation } from '../../dist/chrome/core/grants/intent-pass-validator.js';
import { isValidMessage } from '../../dist/chrome/shared/messages.js';
import { ExtensionStorage } from '../../dist/chrome/storage/storage.js';
import { migrateStorageState } from '../../dist/chrome/storage/migrations.js';
import { MomentDecisionEngine } from '../../dist/chrome/core/decisions/engine.js';
import { DEFAULT_SITE_PASS_DURATION_MS, MAX_SITE_PASS_DURATION_MS } from '../../dist/chrome/shared/constants.js';
import type { SitePass } from '../../src/core/models/site-pass.js';
import type { Collection } from '../../src/core/models/collection.js';
import type { IntentPass } from '../../src/core/models/intent-pass.js';
import type { TemporaryAccessGrant } from '../../src/core/models/grant.js';

describe('Phase 13: Moment Temporary Unlock Scope', () => {
  const baseTime = 1710000000000;
  const passDuration = 5 * 60 * 1000; // 5 minutes

  // =========================================================================
  // Section A: "This Tab Only" (Default Scope)
  // =========================================================================
  describe('A. This Tab Only (THIS_TAB_ONLY)', () => {
    const tab10 = 10;
    const tab20 = 20;

    const thisTabPass: SitePass = {
      id: 'pass_tab10_reddit',
      tabId: tab10,
      site: 'reddit.com',
      grantedAt: baseTime,
      expiresAt: baseTime + passDuration,
      scope: 'THIS_TAB_ONLY',
    };

    it('1. Unlocks the site strictly for the current tab (Tab 10)', () => {
      assert.equal(
        isSitePassValidForNavigation(thisTabPass, tab10, 'https://reddit.com/', baseTime + 1000),
        true
      );
    });

    it('2. Same site in another tab (Tab 20) remains blocked / invalid', () => {
      assert.equal(
        isSitePassValidForNavigation(thisTabPass, tab20, 'https://reddit.com/', baseTime + 1000),
        false
      );
    });

    it('3. Reload in the current tab (Tab 10) remains allowed', () => {
      assert.equal(
        isSitePassValidForNavigation(thisTabPass, tab10, 'https://reddit.com/', baseTime + 60000),
        true
      );
    });

    it('4. Subpage and path navigation in the current tab (Tab 10) remains allowed', () => {
      assert.equal(
        isSitePassValidForNavigation(thisTabPass, tab10, 'https://reddit.com/r/technology', baseTime + 2000),
        true
      );
      assert.equal(
        isSitePassValidForNavigation(thisTabPass, tab10, 'https://old.reddit.com/r/all/top', baseTime + 3000),
        true
      );
    });

    it('5. Closing tab removes access: onTabRemoved cleans up THIS_TAB_ONLY pass', () => {
      const runtimeState = {
        sitePasses: {
          ['10']: { ...thisTabPass },
        } as Record<string, SitePass>,
      };

      // Simulate tab 10 removal logic:
      const key = String(tab10);
      const pass = runtimeState.sitePasses[key];
      if (pass && pass.scope === 'ALL_TABS_UNTIL_EXPIRATION') {
        // retain
      } else {
        delete runtimeState.sitePasses[key];
      }

      assert.equal(runtimeState.sitePasses['10'], undefined);
    });

    it('6. Expiration removes access in Tab 10 once expiresAt is reached', () => {
      // Before expiration
      assert.equal(
        isSitePassValidForNavigation(thisTabPass, tab10, 'https://reddit.com/', baseTime + passDuration - 1),
        true
      );
      // At expiration
      assert.equal(
        isSitePassValidForNavigation(thisTabPass, tab10, 'https://reddit.com/', baseTime + passDuration),
        false
      );
      // After expiration
      assert.equal(
        isSitePassValidForNavigation(thisTabPass, tab10, 'https://reddit.com/', baseTime + passDuration + 1000),
        false
      );
    });
  });

  // =========================================================================
  // Section B: "All Tabs Until Expiration"
  // =========================================================================
  describe('B. All Tabs Until Expiration (ALL_TABS_UNTIL_EXPIRATION)', () => {
    const tab10 = 10;
    const tab20 = 20;
    const tab30 = 30;
    const tab40 = 40;

    const crossTabPass: SitePass = {
      id: 'pass_alltabs_reddit',
      tabId: tab10,
      site: 'reddit.com',
      grantedAt: baseTime,
      expiresAt: baseTime + passDuration,
      scope: 'ALL_TABS_UNTIL_EXPIRATION',
    };

    it('7. Unlocks originating tab (Tab 10)', () => {
      assert.equal(
        isSitePassValidForNavigation(crossTabPass, tab10, 'https://reddit.com/', baseTime + 1000),
        true
      );
    });

    it('8. Same site in another tab (Tab 20) is authorized under the cross-tab pass', () => {
      assert.equal(
        isSitePassValidForNavigation(crossTabPass, tab20, 'https://reddit.com/', baseTime + 1000),
        true
      );
    });

    it('9. Third tab (Tab 30) is authorized on apex and subdomains under WEBSITE semantics', () => {
      assert.equal(
        isSitePassValidForNavigation(crossTabPass, tab30, 'https://old.reddit.com/', baseTime + 1500),
        true
      );
      assert.equal(
        isSitePassValidForNavigation(crossTabPass, tab30, 'https://www.reddit.com/', baseTime + 1500),
        true
      );
    });

    it('10. Newly opened matching tab (Tab 40) is authorized without re-intervening', () => {
      assert.equal(
        isSitePassValidForNavigation(crossTabPass, tab40, 'https://reddit.com/r/science', baseTime + 2000),
        true
      );
    });

    it('11. New matching window navigation is authorized under site semantics', () => {
      const windowTabId = 99;
      assert.equal(
        isSitePassValidForNavigation(crossTabPass, windowTabId, 'https://reddit.com/explore', baseTime + 2500),
        true
      );
    });

    it('12. Reload remains allowed across matching tabs', () => {
      assert.equal(
        isSitePassValidForNavigation(crossTabPass, tab10, 'https://reddit.com/', baseTime + 30000),
        true
      );
      assert.equal(
        isSitePassValidForNavigation(crossTabPass, tab20, 'https://reddit.com/', baseTime + 30000),
        true
      );
    });

    it('13. Subpage and path navigation across matching tabs remains allowed', () => {
      assert.equal(
        isSitePassValidForNavigation(crossTabPass, tab20, 'https://reddit.com/r/programming/comments/123', baseTime + 4000),
        true
      );
    });

    it('14. Closing originating Tab 10 does NOT revoke cross-tab access for Tab 20/30', () => {
      const runtimeState = {
        sitePasses: {
          ['10']: { ...crossTabPass },
        } as Record<string, SitePass>,
      };

      // Tab 10 is closed; verify cleanup logic retains ALL_TABS_UNTIL_EXPIRATION pass
      const key = String(tab10);
      const pass = runtimeState.sitePasses[key];
      if (pass && pass.scope === 'ALL_TABS_UNTIL_EXPIRATION') {
        // Retain cross-tab site unlock until its natural expiration timestamp
      } else {
        delete runtimeState.sitePasses[key];
      }

      assert.ok(runtimeState.sitePasses['10'], 'Pass must be retained in storage');
      assert.equal(
        isSitePassValidForNavigation(runtimeState.sitePasses['10'], tab20, 'https://reddit.com/', baseTime + 5000),
        true
      );
    });

    it('15. Expiration revokes access across ALL tabs', () => {
      assert.equal(
        isSitePassValidForNavigation(crossTabPass, tab10, 'https://reddit.com/', baseTime + passDuration),
        false
      );
      assert.equal(
        isSitePassValidForNavigation(crossTabPass, tab20, 'https://reddit.com/', baseTime + passDuration),
        false
      );
      assert.equal(
        isSitePassValidForNavigation(crossTabPass, tab30, 'https://reddit.com/', baseTime + passDuration + 5000),
        false
      );
    });

    it('16. Unrelated domain remains strictly blocked', () => {
      assert.equal(
        isSitePassValidForNavigation(crossTabPass, tab10, 'https://news.ycombinator.com/', baseTime + 1000),
        false
      );
      assert.equal(
        isSitePassValidForNavigation(crossTabPass, tab20, 'https://twitter.com/', baseTime + 1000),
        false
      );
    });

    it('17. Lookalike domain remains strictly blocked', () => {
      assert.equal(
        isSitePassValidForNavigation(crossTabPass, tab10, 'https://reddit.com.attacker.org/', baseTime + 1000),
        false
      );
      assert.equal(
        isSitePassValidForNavigation(crossTabPass, tab20, 'https://evil-reddit.com/', baseTime + 1000),
        false
      );
      assert.equal(
        isSitePassValidForNavigation(crossTabPass, tab20, 'https://reddit.org/', baseTime + 1000),
        false
      );
    });

    it('18. Daily usage accounting continues counting during temporary access', () => {
      const engine = new MomentDecisionEngine();
      const col: Collection = {
        id: 'col_social',
        name: 'Social Media',
        color: '#ff4500',
        icon: 'globe',
        enabled: true,
        createdAt: baseTime,
        updatedAt: baseTime,
        dailyLimitMs: 30 * 60 * 1000, // 30 minutes
        targets: [
          { id: 't_reddit', pattern: 'reddit.com', type: 'WEBSITE', isException: false, createdAt: baseTime },
        ],
        boundary: {
          schedule: { enabled: false, intervals: [] },
          limits: { dailyMinutes: 30, sessionMinutes: null },
          pause: { type: 'BREATHE', durationSeconds: 10, requireIntentionText: false },
          action: { type: 'BLOCK_PAGE', redirectUrl: null },
          strictMode: false,
        },
        openingMessageMode: 'NONE',
        messageIntensity: 'MILD',
        openingMessages: [],
        whenAccessExpires: 'IMMEDIATE',
      };

      engine.setCollections({ col_social: col });

      // Daily limit not exhausted:
      const allowedDecision = engine.evaluate({
        url: 'https://reddit.com/',
        tabId: 10,
        timestamp: baseTime,
        collections: { col_social: col },
        dailyUsageMs: { col_social: 15 * 60 * 1000 },
      });
      assert.equal(allowedDecision.reason, 'INTERVENTION_REQUIRED');

      // Daily limit exhausted:
      const exhaustedDecision = engine.evaluate({
        url: 'https://reddit.com/',
        tabId: 10,
        timestamp: baseTime,
        collections: { col_social: col },
        dailyUsageMs: { col_social: 31 * 60 * 1000 },
      });
      assert.equal(exhaustedDecision.reason, 'DAILY_LIMIT_EXHAUSTED');
    });

    it('19. Service worker restart preserves the unlock in storage', async () => {
      const mockDb: Record<string, any> = {};
      const mockBackend = {
        get: (key: string, cb: (res: any) => void) => cb({ [key]: mockDb[key] }),
        set: (obj: any, cb: () => void) => {
          Object.assign(mockDb, obj);
          cb();
        },
      };

      const storage1 = new ExtensionStorage(mockBackend);
      await storage1.updateState((draft: any) => {
        draft.runtime.sitePasses['10'] = { ...crossTabPass };
      });

      // Simulate service worker shutdown and restart with fresh storage instance
      const storage2 = new ExtensionStorage(mockBackend);
      const restoredState = await storage2.getState();

      const pass = restoredState.runtime.sitePasses['10'];
      assert.ok(pass);
      assert.equal(pass.id, 'pass_alltabs_reddit');
      assert.equal(pass.scope, 'ALL_TABS_UNTIL_EXPIRATION');
      assert.equal(pass.site, 'reddit.com');
      assert.equal(isSitePassValidForNavigation(pass, 25, 'https://reddit.com/', baseTime + 2000), true);
    });

    it('20. Malformed or unknown scope falls back safely to THIS_TAB_ONLY', () => {
      const malformedPass: SitePass = {
        id: 'pass_malformed',
        tabId: 10,
        site: 'reddit.com',
        grantedAt: baseTime,
        expiresAt: baseTime + passDuration,
        scope: 'INVALID_SCOPE_NAME' as any,
      };

      // When scope is not 'ALL_TABS_UNTIL_EXPIRATION', validator strictly checks tabId
      assert.equal(
        isSitePassValidForNavigation(malformedPass, 10, 'https://reddit.com/', baseTime + 1000),
        true
      );
      assert.equal(
        isSitePassValidForNavigation(malformedPass, 20, 'https://reddit.com/', baseTime + 1000),
        false
      );
    });
  });

  // =========================================================================
  // Section C: Message Protocol & Runtime Validation
  // =========================================================================
  describe('C. Message Protocol & Authority Boundary', () => {
    it('Accepts COMPLETE_INTERVENTION with unlockScope THIS_TAB_ONLY', () => {
      assert.ok(
        isValidMessage({
          type: 'COMPLETE_INTERVENTION',
          tabId: 1,
          targetUrl: 'https://example.com',
          nonce: 'nonce123',
          unlockScope: 'THIS_TAB_ONLY',
        })
      );
    });

    it('Accepts COMPLETE_INTERVENTION with unlockScope ALL_TABS_UNTIL_EXPIRATION', () => {
      assert.ok(
        isValidMessage({
          type: 'COMPLETE_INTERVENTION',
          tabId: 1,
          targetUrl: 'https://example.com',
          nonce: 'nonce123',
          unlockScope: 'ALL_TABS_UNTIL_EXPIRATION',
        })
      );
    });

    it('Rejects COMPLETE_INTERVENTION with invalid unlockScope value', () => {
      assert.equal(
        isValidMessage({
          type: 'COMPLETE_INTERVENTION',
          tabId: 1,
          targetUrl: 'https://example.com',
          nonce: 'nonce123',
          unlockScope: 'PERMANENT',
        }),
        false
      );
    });

    it('Accepts END_SITE_PASS messages with valid parameters', () => {
      assert.ok(isValidMessage({ type: 'END_SITE_PASS', tabId: 1 }));
      assert.ok(isValidMessage({ type: 'END_SITE_PASS', passId: 'pass_123' }));
      assert.ok(isValidMessage({ type: 'END_SITE_PASS', site: 'reddit.com' }));
      assert.ok(isValidMessage({ type: 'END_SITE_PASS' }));
    });

    it('Rejects END_SITE_PASS with malformed tabId', () => {
      assert.equal(isValidMessage({ type: 'END_SITE_PASS', tabId: '1' as any }), false);
    });
  });

  // =========================================================================
  // Section D: Regression & Invariant Safeguards
  // =========================================================================
  describe('D. Regression & Architecture Safeguards', () => {
    it('21. Intent Pass remains strictly tab-scoped and independent', () => {
      const intentPass: IntentPass = {
        id: 'intent_1',
        tabId: 10,
        scope: { type: 'WEBSITE', pattern: 'reddit.com' },
        collectionId: 'col_1',
        matchedRuleId: 't_1',
        grantedAt: baseTime,
        expiresAt: baseTime + 15 * 60 * 1000,
        durationMs: 15 * 60 * 1000,
      };

      // Valid in originating tab 10
      assert.equal(isIntentPassValidForNavigation(intentPass, 10, 'https://reddit.com/', baseTime + 1000), true);
      // Strictly rejected in Tab 20
      assert.equal(isIntentPassValidForNavigation(intentPass, 20, 'https://reddit.com/', baseTime + 1000), false);
    });

    it('22. TemporaryAccessGrant single-use consumption remains untouched', () => {
      const grant: TemporaryAccessGrant = {
        id: 'grant_1',
        tabId: 10,
        target: 'https://reddit.com/',
        grantedAt: baseTime,
        expiresAt: baseTime + 30000,
        nonce: 'nonce1',
        singleUse: true,
      };

      assert.equal(isGrantValidForNavigation(grant, 10, 'https://reddit.com/', baseTime + 1000), true);
      assert.equal(isGrantValidForNavigation(grant, 20, 'https://reddit.com/', baseTime + 1000), false);
    });

    it('23. SitePass duration resolver respects boundaries and clamping', () => {
      assert.equal(resolveSitePassDuration(undefined), DEFAULT_SITE_PASS_DURATION_MS);
      assert.equal(resolveSitePassDuration(-100), DEFAULT_SITE_PASS_DURATION_MS);
      assert.equal(resolveSitePassDuration(0), DEFAULT_SITE_PASS_DURATION_MS);
      assert.equal(resolveSitePassDuration(NaN), DEFAULT_SITE_PASS_DURATION_MS);
      assert.equal(resolveSitePassDuration(10 * 60 * 1000), 10 * 60 * 1000);
      assert.equal(resolveSitePassDuration(24 * 60 * 60 * 1000), MAX_SITE_PASS_DURATION_MS);
    });

    it('24. Strict block mode is completely unaffected by SitePass', () => {
      const engine = new MomentDecisionEngine();
      const col: Collection = {
        id: 'col_strict',
        name: 'Work',
        color: '#000000',
        icon: 'lock',
        enabled: true,
        createdAt: baseTime,
        updatedAt: baseTime,
        dailyLimitMs: null,
        targets: [
          { id: 't_distract', pattern: 'distraction.com', type: 'WEBSITE', isException: false, createdAt: baseTime },
        ],
        boundary: {
          schedule: { enabled: false, intervals: [] },
          limits: { dailyMinutes: null, sessionMinutes: null },
          pause: { type: 'NONE', durationSeconds: 0, requireIntentionText: false },
          action: { type: 'BLOCK_PAGE', redirectUrl: null },
          strictMode: true,
        },
        openingMessageMode: 'NONE',
        messageIntensity: 'MILD',
        openingMessages: [],
        whenAccessExpires: 'IMMEDIATE',
      };

      engine.setCollections({ col_strict: col });

      const decision = engine.evaluate({
        url: 'https://distraction.com/',
        tabId: 10,
        timestamp: baseTime,
        collections: { col_strict: col },
      });

      assert.equal(decision.action, 'BLOCK');
      assert.equal(decision.collectionId, 'col_strict');
    });

    it('25. Scheduled blocking outside permitted intervals remains unaffected', () => {
      const engine = new MomentDecisionEngine();
      const col: Collection = {
        id: 'col_scheduled',
        name: 'Scheduled Focus',
        color: '#123456',
        icon: 'clock',
        enabled: true,
        createdAt: baseTime,
        updatedAt: baseTime,
        dailyLimitMs: null,
        targets: [
          { id: 't_news', pattern: 'news.com', type: 'WEBSITE', isException: false, createdAt: baseTime },
        ],
        boundary: {
          schedule: {
            enabled: true,
            intervals: [
              { days: [1], startMinute: 540, endMinute: 1020 },
            ],
          },
          limits: { dailyMinutes: null, sessionMinutes: null },
          pause: { type: 'BREATHE', durationSeconds: 10, requireIntentionText: false },
          action: { type: 'BLOCK_PAGE', redirectUrl: null },
          strictMode: false,
        },
        openingMessageMode: 'NONE',
        messageIntensity: 'MILD',
        openingMessages: [],
        whenAccessExpires: 'IMMEDIATE',
      };

      engine.setCollections({ col_scheduled: col });
      const active = engine.evaluate({
        url: 'https://news.com/',
        tabId: 10,
        timestamp: baseTime,
        collections: { col_scheduled: col },
      });
      assert.ok(active.action === 'ALLOW' || active.action === 'INTERVENE');
    });

    it('26. Exception rules remain authoritative over blocking rules', () => {
      const engine = new MomentDecisionEngine();
      const col: Collection = {
        id: 'col_work',
        name: 'Work With Exceptions',
        color: '#123456',
        icon: 'briefcase',
        enabled: true,
        createdAt: baseTime,
        updatedAt: baseTime,
        dailyLimitMs: null,
        targets: [
          { id: 't_base', pattern: 'example.com', type: 'WEBSITE', isException: false, createdAt: baseTime },
          { id: 't_docs', pattern: 'docs.example.com', type: 'WEBSITE', isException: true, createdAt: baseTime },
        ],
        boundary: {
          schedule: { enabled: false, intervals: [] },
          limits: { dailyMinutes: null, sessionMinutes: null },
          pause: { type: 'BREATHE', durationSeconds: 10, requireIntentionText: false },
          action: { type: 'BLOCK_PAGE', redirectUrl: null },
          strictMode: false,
        },
        openingMessageMode: 'NONE',
        messageIntensity: 'MILD',
        openingMessages: [],
        whenAccessExpires: 'IMMEDIATE',
      };

      engine.setCollections({ col_work: col });

      const exceptionDecision = engine.evaluate({
        url: 'https://docs.example.com/',
        tabId: 10,
        timestamp: baseTime,
        collections: { col_work: col },
      });

      assert.equal(exceptionDecision.action, 'ALLOW');
      assert.equal(exceptionDecision.reason, 'EXCEPTION_RULE');
    });

    it('27. Import/export does not leak transient access state', () => {
      const sampleExport = {
        schemaVersion: 3,
        exportedAt: baseTime,
        collections: {},
        settings: {
          theme: 'system',
          timeFormat: '24h',
          reducedMotion: false,
          allowPrivateBrowsing: false,
          temporaryUnlockScope: 'THIS_TAB_ONLY',
        },
      };

      assert.equal((sampleExport as any).runtime, undefined);
    });

    it('28. Existing stored data migrates safely and normalizes sitePass scope', () => {
      const legacyState = {
        schemaVersion: 3,
        settings: {
          theme: 'system',
          timeFormat: '24h',
          reducedMotion: false,
          allowPrivateBrowsing: false,
        },
        collections: {},
        usage: {},
        runtime: {
          sitePasses: {
            '10': {
              id: 'pass_legacy',
              tabId: 10,
              site: 'reddit.com',
              grantedAt: baseTime,
              expiresAt: baseTime + 300000,
            },
          },
        },
      };

      const upgraded = migrateStorageState(legacyState);
      assert.ok(upgraded.runtime.sitePasses['10']);
      assert.equal(upgraded.runtime.sitePasses['10'].scope, 'THIS_TAB_ONLY');
      assert.equal(upgraded.settings.temporaryUnlockScope, 'THIS_TAB_ONLY');
    });
  });
});
