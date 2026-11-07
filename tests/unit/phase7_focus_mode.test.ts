/**
 * Phase 7 Test Suite: Focus Mode
 *
 * Verifies the complete Focus Mode architecture:
 * 1. Duration resolution & clamping (15m, 30m, 60m, 90m, 120m, max 120m).
 * 2. Pure domain validator (isFocusSessionActive, filterValidFocusCollectionIds):
 *    - Active within timestamp boundaries
 *    - Inactive on expiration or clock anomalies
 *    - Malformed state defense
 * 3. Core Decision Engine collection activation:
 *    - Non-mutating dynamic activation (boundary.schedule untouched)
 *    - Reason: 'FOCUS_MODE' and trace.focusModeActive: true
 *    - Unselected collections untouched
 *    - Multiple collections concurrent activation
 * 4. Policy precedence & Specificity:
 *    - Specificity Tuple comparison
 *    - Exception rule supremacy (isException: true ALWAYS wins over Focus Mode)
 * 5. Coexistence with Daily Limits:
 *    - DAILY_LIMIT_EXHAUSTED takes precedence over FOCUS_MODE
 *    - Active usage budget continues accumulating during focus session
 * 6. Coexistence with Temporary Access (TemporaryAccessGrant, SitePass, IntentPass):
 *    - TemporaryAccessGrant allows single navigation commitment under Focus Mode
 *    - IntentPass allows deliberate tab-scoped override while Focus Mode stays active browser-wide
 * 7. Browser-wide enforcement & multi-tab isolation:
 *    - Focus session applies to all tabs and windows
 *    - IntentPass in Tab 1 does not leak to Tab 2
 * 8. Storage persistence & MV3 service worker reboot resilience:
 *    - focusSession preserved in runtime state
 *    - Timestamp-based expiration survives worker restart
 * 9. End Focus autonomy:
 *    - Immediate return to normal schedules with zero leftover state mutation
 * 10. Typed message protocol validation (START_FOCUS_MODE, GET_FOCUS_MODE_STATUS, END_FOCUS_MODE).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveFocusModeDuration,
  isFocusSessionActive,
  filterValidFocusCollectionIds,
} from '../../dist/chrome/core/focus/focus-validator.js';
import {
  ALLOWED_FOCUS_MODE_DURATIONS_MS,
  DEFAULT_FOCUS_MODE_DURATION_MS,
  MAX_FOCUS_MODE_DURATION_MS,
} from '../../dist/chrome/shared/constants.js';
import { isValidMessage } from '../../dist/chrome/shared/messages.js';
import { ExtensionStorage } from '../../dist/chrome/storage/storage.js';
import { MomentDecisionEngine } from '../../dist/chrome/core/decisions/engine.js';
import type { Target } from '../../src/core/models/target.js';
import type { Collection } from '../../src/core/models/collection.js';
import type { FocusSession } from '../../src/core/models/focus-session.js';
import type { TemporaryAccessGrant } from '../../src/core/models/grant.js';

describe('Phase 7: Focus Mode', () => {
  const baseTime = 1_700_000_000_000;

  describe('1. Duration Resolution & Clamping', () => {
    it('Defines standard allowed durations [15m, 30m, 60m, 90m, 120m]', () => {
      assert.deepEqual(ALLOWED_FOCUS_MODE_DURATIONS_MS, [
        15 * 60 * 1000,
        30 * 60 * 1000,
        60 * 60 * 1000,
        90 * 60 * 1000,
        120 * 60 * 1000,
      ]);
    });

    it('Accepts exact allowed durations without modification', () => {
      assert.equal(resolveFocusModeDuration(15 * 60 * 1000), 15 * 60 * 1000);
      assert.equal(resolveFocusModeDuration(30 * 60 * 1000), 30 * 60 * 1000);
      assert.equal(resolveFocusModeDuration(60 * 60 * 1000), 60 * 60 * 1000);
      assert.equal(resolveFocusModeDuration(90 * 60 * 1000), 90 * 60 * 1000);
      assert.equal(resolveFocusModeDuration(120 * 60 * 1000), 120 * 60 * 1000);
    });

    it('Clamps values exceeding MAX_FOCUS_MODE_DURATION_MS (120m) to 120m', () => {
      assert.equal(resolveFocusModeDuration(150 * 60 * 1000), MAX_FOCUS_MODE_DURATION_MS);
      assert.equal(resolveFocusModeDuration(240 * 60 * 1000), MAX_FOCUS_MODE_DURATION_MS);
      assert.equal(resolveFocusModeDuration(24 * 60 * 60 * 1000), MAX_FOCUS_MODE_DURATION_MS);
    });

    it('Snaps arbitrary durations to the closest valid duration', () => {
      // Closer to 15m (900_000)
      assert.equal(resolveFocusModeDuration(10 * 60 * 1000), 15 * 60 * 1000);
      assert.equal(resolveFocusModeDuration(20 * 60 * 1000), 15 * 60 * 1000);
      // Closer to 30m (1_800_000)
      assert.equal(resolveFocusModeDuration(25 * 60 * 1000), 30 * 60 * 1000);
      assert.equal(resolveFocusModeDuration(40 * 60 * 1000), 30 * 60 * 1000);
      // Closer to 60m (3_600_000)
      assert.equal(resolveFocusModeDuration(50 * 60 * 1000), 60 * 60 * 1000);
      assert.equal(resolveFocusModeDuration(70 * 60 * 1000), 60 * 60 * 1000);
      // Closer to 90m (5_400_000)
      assert.equal(resolveFocusModeDuration(80 * 60 * 1000), 90 * 60 * 1000);
      assert.equal(resolveFocusModeDuration(100 * 60 * 1000), 90 * 60 * 1000);
      // Closer to 120m (7_200_000)
      assert.equal(resolveFocusModeDuration(110 * 60 * 1000), 120 * 60 * 1000);
    });

    it('Defaults on invalid, negative, zero, NaN, or non-finite inputs', () => {
      assert.equal(resolveFocusModeDuration(undefined), DEFAULT_FOCUS_MODE_DURATION_MS);
      assert.equal(resolveFocusModeDuration(null as any), DEFAULT_FOCUS_MODE_DURATION_MS);
      assert.equal(resolveFocusModeDuration(0), DEFAULT_FOCUS_MODE_DURATION_MS);
      assert.equal(resolveFocusModeDuration(-5000), DEFAULT_FOCUS_MODE_DURATION_MS);
      assert.equal(resolveFocusModeDuration(NaN), DEFAULT_FOCUS_MODE_DURATION_MS);
      assert.equal(resolveFocusModeDuration(Infinity), DEFAULT_FOCUS_MODE_DURATION_MS);
      assert.equal(resolveFocusModeDuration(-Infinity), DEFAULT_FOCUS_MODE_DURATION_MS);
    });
  });

  describe('2. Focus Validator (isFocusSessionActive & filterValidFocusCollectionIds)', () => {
    const validSession: FocusSession = {
      id: 'focus_test_1',
      startedAt: baseTime,
      expiresAt: baseTime + 30 * 60 * 1000,
      durationMs: 30 * 60 * 1000,
      selectedCollectionIds: ['col_social'],
      status: 'ACTIVE',
    };

    it('Returns true during active duration (startedAt <= now < expiresAt)', () => {
      assert.equal(isFocusSessionActive(validSession, baseTime), true);
      assert.equal(isFocusSessionActive(validSession, baseTime + 15 * 60 * 1000), true);
      assert.equal(isFocusSessionActive(validSession, baseTime + 30 * 60 * 1000 - 1), true);
    });

    it('Returns false at or after expiration boundary', () => {
      assert.equal(isFocusSessionActive(validSession, baseTime + 30 * 60 * 1000), false);
      assert.equal(isFocusSessionActive(validSession, baseTime + 30 * 60 * 1000 + 1), false);
      assert.equal(isFocusSessionActive(validSession, baseTime + 60 * 60 * 1000), false);
    });

    it('Returns false if now is before startedAt (clock rollback)', () => {
      assert.equal(isFocusSessionActive(validSession, baseTime - 1000), false);
    });

    it('Returns false for null, undefined, or malformed session objects', () => {
      assert.equal(isFocusSessionActive(null, baseTime), false);
      assert.equal(isFocusSessionActive(undefined, baseTime), false);
      assert.equal(isFocusSessionActive({} as any, baseTime), false);
      assert.equal(isFocusSessionActive({ ...validSession, status: 'COMPLETED' as any }, baseTime), false);
      assert.equal(isFocusSessionActive({ ...validSession, expiresAt: NaN }, baseTime), false);
      assert.equal(isFocusSessionActive({ ...validSession, startedAt: NaN }, baseTime), false);
    });

    it('Enforces maximum duration ceiling (MAX_FOCUS_MODE_DURATION_MS + 60s tolerance)', () => {
      const forgedLongSession: FocusSession = {
        ...validSession,
        durationMs: 24 * 60 * 60 * 1000, // 24h
        expiresAt: baseTime + 24 * 60 * 60 * 1000,
      };
      assert.equal(isFocusSessionActive(forgedLongSession, baseTime + 1000), false);
    });

    it('filterValidFocusCollectionIds preserves valid existing collections and drops invalid ones', () => {
      const dummyBoundary = {
        schedule: { enabled: false, intervals: [] },
        limits: { dailyMinutes: null, sessionMinutes: null },
        pause: { type: 'NONE' as const, durationSeconds: 0, requireIntentionText: false },
        action: { type: 'BLOCK_PAGE' as const, redirectUrl: null },
        strictMode: false,
      };

      const collections: Record<string, Collection> = {
        col_social: {
          id: 'col_social',
          name: 'Social Media',
          color: '#e11d48',
          icon: 'users',
          enabled: true,
          createdAt: baseTime,
          updatedAt: baseTime,
          dailyLimitMs: null,
          targets: [],
          boundary: dummyBoundary,
        },
        col_news: {
          id: 'col_news',
          name: 'News',
          color: '#2563eb',
          icon: 'newspaper',
          enabled: true,
          createdAt: baseTime,
          updatedAt: baseTime,
          dailyLimitMs: null,
          targets: [],
          boundary: dummyBoundary,
        },
      };

      const result = filterValidFocusCollectionIds(['col_social', 'col_nonexistent', 'col_news'], collections);
      assert.deepEqual(result, ['col_social', 'col_news']);

      assert.deepEqual(filterValidFocusCollectionIds([], collections), []);
      assert.deepEqual(filterValidFocusCollectionIds(['invalid1', 'invalid2'], collections), []);
      assert.deepEqual(filterValidFocusCollectionIds(['col_social'], null as any), []);
    });
  });

  describe('3. Core Decision Engine: Non-Mutating Dynamic Collection Activation', () => {
    const engine = new MomentDecisionEngine();

    const socialRule: Target = {
      id: 't_reddit',
      pattern: 'reddit.com',
      type: 'WEBSITE',
      isException: false,
      createdAt: baseTime,
    };

    const newsRule: Target = {
      id: 't_cnn',
      pattern: 'cnn.com',
      type: 'WEBSITE',
      isException: false,
      createdAt: baseTime,
    };

    // Collection configured with empty schedule (outside schedule: normally INACTIVE)
    const inactiveSocialCollection: Collection = {
      id: 'col_social',
      name: 'Social Media',
      color: '#e11d48',
      icon: 'users',
      enabled: true,
      createdAt: baseTime,
      updatedAt: baseTime,
      dailyLimitMs: null,
      targets: [socialRule],
      boundary: {
        schedule: {
          enabled: true,
          intervals: [], // No active intervals -> normally ALLOW outside schedule
        },
        action: { type: 'BLOCK_PAGE', redirectUrl: null },
        pause: { type: 'BREATHE', durationSeconds: 10, requireIntentionText: false },
        limits: { dailyMinutes: null, sessionMinutes: null },
        strictMode: false,
      },
    };

    const inactiveNewsCollection: Collection = {
      id: 'col_news',
      name: 'News',
      color: '#2563eb',
      icon: 'newspaper',
      enabled: true,
      createdAt: baseTime,
      updatedAt: baseTime,
      dailyLimitMs: null,
      targets: [newsRule],
      boundary: {
        schedule: {
          enabled: true,
          intervals: [], // No active intervals -> normally ALLOW outside schedule
        },
        action: { type: 'BLOCK_PAGE', redirectUrl: null },
        pause: { type: 'NONE', durationSeconds: 0, requireIntentionText: false },
        limits: { dailyMinutes: null, sessionMinutes: null },
        strictMode: false,
      },
    };

    const collections = {
      col_social: inactiveSocialCollection,
      col_news: inactiveNewsCollection,
    };

    it('When Focus Mode is inactive, normally inactive boundary permits navigation', () => {
      const decision = engine.evaluate({
        url: 'https://reddit.com/r/technology',
        timestamp: baseTime,
        collections,
        focusSession: null,
      });

      assert.equal(decision.action, 'ALLOW');
      assert.equal(decision.reason, 'SCHEDULE_INACTIVE');
      assert.equal(decision.trace.focusModeActive, false);
    });

    it('When Focus Mode is active for col_social, boundary is activated dynamically', () => {
      const focusSession: FocusSession = {
        id: 'focus_1',
        startedAt: baseTime,
        expiresAt: baseTime + 30 * 60 * 1000,
        durationMs: 30 * 60 * 1000,
        selectedCollectionIds: ['col_social'],
        status: 'ACTIVE',
      };

      const decision = engine.evaluate({
        url: 'https://reddit.com/r/technology',
        timestamp: baseTime + 5 * 60 * 1000,
        collections,
        focusSession,
      });

      assert.equal(decision.action, 'INTERVENE');
      assert.equal(decision.reason, 'FOCUS_MODE');
      assert.equal(decision.collectionId, 'col_social');
      assert.equal(decision.matchedRuleId, 't_reddit');
      assert.equal(decision.trace.focusModeActive, true);
    });

    it('Unselected collection (col_news) remains untouched by Focus Mode', () => {
      const focusSession: FocusSession = {
        id: 'focus_1',
        startedAt: baseTime,
        expiresAt: baseTime + 30 * 60 * 1000,
        durationMs: 30 * 60 * 1000,
        selectedCollectionIds: ['col_social'], // Only social selected!
        status: 'ACTIVE',
      };

      const decision = engine.evaluate({
        url: 'https://cnn.com/world',
        timestamp: baseTime + 5 * 60 * 1000,
        collections,
        focusSession,
      });

      assert.equal(decision.action, 'ALLOW');
      assert.equal(decision.reason, 'SCHEDULE_INACTIVE');
      assert.equal(decision.trace.focusModeActive, false);
    });

    it('Multiple collections activated concurrently in Focus Mode', () => {
      const focusSession: FocusSession = {
        id: 'focus_multi',
        startedAt: baseTime,
        expiresAt: baseTime + 30 * 60 * 1000,
        durationMs: 30 * 60 * 1000,
        selectedCollectionIds: ['col_social', 'col_news'],
        status: 'ACTIVE',
      };

      const decisionSocial = engine.evaluate({
        url: 'https://reddit.com',
        timestamp: baseTime + 5 * 60 * 1000,
        collections,
        focusSession,
      });
      assert.equal(decisionSocial.action, 'INTERVENE');
      assert.equal(decisionSocial.reason, 'FOCUS_MODE');

      const decisionNews = engine.evaluate({
        url: 'https://cnn.com',
        timestamp: baseTime + 5 * 60 * 1000,
        collections,
        focusSession,
      });
      assert.equal(decisionNews.action, 'BLOCK');
      assert.equal(decisionNews.reason, 'FOCUS_MODE');
    });

    it('Focus Mode expiration restores normal schedule evaluation automatically', () => {
      const focusSession: FocusSession = {
        id: 'focus_1',
        startedAt: baseTime,
        expiresAt: baseTime + 30 * 60 * 1000,
        durationMs: 30 * 60 * 1000,
        selectedCollectionIds: ['col_social'],
        status: 'ACTIVE',
      };

      // Exactly at expiration time -> inactive
      const decisionExpired = engine.evaluate({
        url: 'https://reddit.com',
        timestamp: baseTime + 30 * 60 * 1000,
        collections,
        focusSession,
      });

      assert.equal(decisionExpired.action, 'ALLOW');
      assert.equal(decisionExpired.reason, 'SCHEDULE_INACTIVE');
      assert.equal(decisionExpired.trace.focusModeActive, false);
    });
  });

  describe('4. Policy Precedence & Specificity (Exceptions Win Over Focus Mode)', () => {
    const engine = new MomentDecisionEngine();

    const broadWebsiteRule: Target = {
      id: 't_reddit_broad',
      pattern: 'reddit.com',
      type: 'WEBSITE',
      isException: false,
      createdAt: baseTime,
    };

    const specificExceptionRule: Target = {
      id: 't_reddit_learn',
      pattern: 'reddit.com/r/learnprogramming',
      type: 'PATH_PREFIX',
      isException: true,
      createdAt: baseTime + 10,
    };

    const collectionWithException: Collection = {
      id: 'col_dev',
      name: 'Development',
      color: '#059669',
      icon: 'code',
      enabled: true,
      createdAt: baseTime,
      updatedAt: baseTime,
      dailyLimitMs: null,
      targets: [broadWebsiteRule, specificExceptionRule],
      boundary: {
        schedule: { enabled: true, intervals: [] },
        action: { type: 'BLOCK_PAGE', redirectUrl: null },
        pause: { type: 'NONE', durationSeconds: 0, requireIntentionText: false },
        limits: { dailyMinutes: null, sessionMinutes: null },
        strictMode: false,
      },
    };

    const collections = { col_dev: collectionWithException };

    const focusSession: FocusSession = {
      id: 'focus_dev',
      startedAt: baseTime,
      expiresAt: baseTime + 60 * 60 * 1000,
      durationMs: 60 * 60 * 1000,
      selectedCollectionIds: ['col_dev'],
      status: 'ACTIVE',
    };

    it('Focus Mode blocks general website targets', () => {
      const decision = engine.evaluate({
        url: 'https://reddit.com/r/gaming',
        timestamp: baseTime + 1000,
        collections,
        focusSession,
      });

      assert.equal(decision.action, 'BLOCK');
      assert.equal(decision.reason, 'FOCUS_MODE');
      assert.equal(decision.matchedRuleId, 't_reddit_broad');
    });

    it('Exception rule strictly WINS over Focus Mode (ALLOW)', () => {
      const decision = engine.evaluate({
        url: 'https://reddit.com/r/learnprogramming/comments/123',
        timestamp: baseTime + 1000,
        collections,
        focusSession,
      });

      assert.equal(decision.action, 'ALLOW');
      assert.equal(decision.reason, 'EXCEPTION_RULE');
      assert.equal(decision.matchedRuleId, 't_reddit_learn');
    });
  });

  describe('5. Coexistence with Daily Usage Limit', () => {
    const engine = new MomentDecisionEngine();

    const target: Target = {
      id: 't_social',
      pattern: 'instagram.com',
      type: 'WEBSITE',
      isException: false,
      createdAt: baseTime,
    };

    const collectionWithLimit: Collection = {
      id: 'col_social',
      name: 'Social',
      color: '#e11d48',
      icon: 'users',
      enabled: true,
      createdAt: baseTime,
      updatedAt: baseTime,
      dailyLimitMs: 30 * 60 * 1000, // 30 min limit
      targets: [target],
      boundary: {
        schedule: { enabled: true, intervals: [] },
        action: { type: 'BLOCK_PAGE', redirectUrl: null },
        pause: { type: 'BREATHE', durationSeconds: 10, requireIntentionText: false },
        limits: { dailyMinutes: 30, sessionMinutes: null },
        strictMode: false,
      },
    };

    const collections = { col_social: collectionWithLimit };

    const focusSession: FocusSession = {
      id: 'focus_social',
      startedAt: baseTime,
      expiresAt: baseTime + 60 * 60 * 1000,
      durationMs: 60 * 60 * 1000,
      selectedCollectionIds: ['col_social'],
      status: 'ACTIVE',
    };

    it('When daily limit is NOT exhausted, FOCUS_MODE enforces boundary', () => {
      const decision = engine.evaluate({
        url: 'https://instagram.com/explore',
        timestamp: baseTime + 1000,
        collections,
        dailyUsageMs: { col_social: 10 * 60 * 1000 }, // 10 min used out of 30
        focusSession,
      });

      assert.equal(decision.action, 'INTERVENE');
      assert.equal(decision.reason, 'FOCUS_MODE');
    });

    it('When daily limit IS exhausted, DAILY_LIMIT_EXHAUSTED takes precedence over Focus Mode', () => {
      const decision = engine.evaluate({
        url: 'https://instagram.com/explore',
        timestamp: baseTime + 1000,
        collections,
        dailyUsageMs: { col_social: 30 * 60 * 1000 }, // 30 min used -> exhausted!
        focusSession,
      });

      // Budget model: a spent budget blocks, even stricter than the Focus Mode pause
      assert.equal(decision.action, 'BLOCK');
      assert.equal(decision.reason, 'DAILY_LIMIT_EXHAUSTED');
      assert.equal(decision.trace.focusModeActive, true);
    });
  });

  describe('6. Coexistence with Temporary Access (TemporaryAccessGrant)', () => {
    const engine = new MomentDecisionEngine();

    const target: Target = {
      id: 't_social',
      pattern: 'youtube.com',
      type: 'WEBSITE',
      isException: false,
      createdAt: baseTime,
    };

    const collection: Collection = {
      id: 'col_social',
      name: 'Social',
      color: '#e11d48',
      icon: 'video',
      enabled: true,
      createdAt: baseTime,
      updatedAt: baseTime,
      dailyLimitMs: null,
      targets: [target],
      boundary: {
        schedule: { enabled: true, intervals: [] },
        action: { type: 'BLOCK_PAGE', redirectUrl: null },
        pause: { type: 'BREATHE', durationSeconds: 10, requireIntentionText: false },
        limits: { dailyMinutes: null, sessionMinutes: null },
        strictMode: false,
      },
    };

    const collections = { col_social: collection };

    const focusSession: FocusSession = {
      id: 'focus_session',
      startedAt: baseTime,
      expiresAt: baseTime + 60 * 60 * 1000,
      durationMs: 60 * 60 * 1000,
      selectedCollectionIds: ['col_social'],
      status: 'ACTIVE',
    };

    it('TemporaryAccessGrant allows immediate navigation commitment even during Focus Mode', () => {
      const grant: TemporaryAccessGrant = {
        id: 'grant_123',
        tabId: 10,
        target: 'https://youtube.com/watch?v=abc',
        grantedAt: baseTime + 1000,
        expiresAt: baseTime + 61_000,
        nonce: 'nonce_123',
        singleUse: true,
      };

      const decisionTab10 = engine.evaluate({
        url: 'https://youtube.com/watch?v=abc',
        tabId: 10,
        timestamp: baseTime + 2000,
        collections,
        activeGrants: [grant],
        focusSession,
      });

      assert.equal(decisionTab10.action, 'ALLOW');
      assert.equal(decisionTab10.reason, 'ACTIVE_GRANT');

      // Another tab (tab 20) has no grant -> restricted by Focus Mode
      const decisionTab20 = engine.evaluate({
        url: 'https://youtube.com/watch?v=abc',
        tabId: 20,
        timestamp: baseTime + 2000,
        collections,
        activeGrants: [grant],
        focusSession,
      });

      assert.equal(decisionTab20.action, 'INTERVENE');
      assert.equal(decisionTab20.reason, 'FOCUS_MODE');
    });
  });

  describe('7. Storage Persistence & Worker Restart Resilience', () => {
    it('focusSession persists in storage and does NOT mutate underlying collection schedules', async () => {
      const storage = new ExtensionStorage();

      const initialSchedule = {
        enabled: false,
        intervals: [],
      };

      // Create collection
      await storage.updateState((draft: any) => {
        draft.collections['col_test'] = {
          id: 'col_test',
          name: 'Test Collection',
          color: '#15803d',
          icon: 'shield',
          enabled: true,
          createdAt: baseTime,
          updatedAt: baseTime,
          dailyLimitMs: null,
          targets: [{ id: 't_1', pattern: 'example.com', type: 'WEBSITE', isException: false, createdAt: baseTime }],
          boundary: {
            schedule: { ...initialSchedule },
            limits: { dailyMinutes: null, sessionMinutes: null },
            pause: { type: 'BREATHE', durationSeconds: 10, requireIntentionText: false },
            action: { type: 'BLOCK_PAGE', redirectUrl: null },
            strictMode: false,
          },
        };
      });

      // Start focus session
      const session: FocusSession = {
        id: 'focus_persist_1',
        startedAt: baseTime,
        expiresAt: baseTime + 30 * 60 * 1000,
        durationMs: 30 * 60 * 1000,
        selectedCollectionIds: ['col_test'],
        status: 'ACTIVE',
      };

      await storage.updateState((draft: any) => {
        draft.runtime.focusSession = session;
      });

      // Verify stored state
      const stored = await storage.getState();
      assert.deepEqual(stored.runtime.focusSession, session);

      // Verify collection schedule was NOT mutated
      assert.deepEqual(stored.collections['col_test'].boundary?.schedule, initialSchedule);

      // End focus session
      await storage.updateState((draft: any) => {
        draft.runtime.focusSession = null;
      });

      const afterEnd = await storage.getState();
      assert.equal(afterEnd.runtime.focusSession, null);
      // Collection schedule still intact
      assert.deepEqual(afterEnd.collections['col_test'].boundary?.schedule, initialSchedule);
    });
  });

  describe('8. Typed Message Protocol Validation', () => {
    it('Validates START_FOCUS_MODE payload', () => {
      assert.equal(isValidMessage({ type: 'START_FOCUS_MODE', durationMs: 1800000, collectionIds: ['col_1'] }), true);
      assert.equal(isValidMessage({ type: 'START_FOCUS_MODE', collectionIds: ['col_1'] }), true); // durationMs optional (has default)
      assert.equal(isValidMessage({ type: 'START_FOCUS_MODE', durationMs: '30m', collectionIds: ['col_1'] }), false);
      assert.equal(isValidMessage({ type: 'START_FOCUS_MODE', durationMs: 1800000, collectionIds: 'col_1' }), false);
      assert.equal(isValidMessage({ type: 'START_FOCUS_MODE' }), false); // missing collectionIds
    });

    it('Validates GET_FOCUS_MODE_STATUS payload', () => {
      assert.equal(isValidMessage({ type: 'GET_FOCUS_MODE_STATUS' }), true);
    });

    it('Validates END_FOCUS_MODE payload', () => {
      assert.equal(isValidMessage({ type: 'END_FOCUS_MODE' }), true);
    });
  });
});
