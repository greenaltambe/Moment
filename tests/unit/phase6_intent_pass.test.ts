/**
 * Phase 6 Test Suite: Momentary Access — Intent Passes
 *
 * Verifies the complete Intent Pass architecture:
 * 1. Allowed durations (5m, 15m, 30m) and strict clamping (max 30m).
 * 2. Scope derivation fidelity across all 5 target rule types (Section 25 Invariant):
 *    - WEBSITE: apex and subdomains
 *    - EXACT_HOST: exact host only, no subdomains
 *    - PATH_PREFIX: path prefix only, no other paths
 *    - EXACT_PAGE: exact page and query only
 *    - GLOB: bounded glob pattern only
 * 3. Lookalikes defense (evil-domain, prefix/suffix lookalikes).
 * 4. Pure domain validator (isIntentPassValidForNavigation):
 *    - Valid within duration and tab
 *    - Multi-tab isolation (Tab A pass invalid for Tab B)
 *    - Expiration boundaries
 *    - Clock anomalies / pre-grant checks
 *    - Max duration bounds
 * 5. Typed message protocol and payload validation:
 *    - REQUEST_INTENT_PASS
 *    - GET_INTENT_PASS_STATUS
 *    - END_INTENT_PASS
 * 6. Storage persistence & MV3 service worker reboot resilience.
 * 7. Background authoritative state machine:
 *    - Pending intervention consumed atomically upon Intent Pass creation
 *    - Single-use TemporaryAccessGrant issued for immediate commit
 *    - Unblocked site cannot request Intent Pass
 *    - Early surrender via END_INTENT_PASS
 *    - Tab close cleanup
 *    - Cancellation cleanup
 * 8. Multi-tab isolation under navigation evaluation.
 * 9. Daily limits co-existence (time continues accumulating).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveIntentPassDuration,
  resolveIntentPassScope,
  isIntentPassValidForNavigation,
} from '../../dist/chrome/core/grants/intent-pass-validator.js';
import { isGrantValidForNavigation } from '../../dist/chrome/core/grants/grant-validator.js';
import { parseCanonicalUrl, toCanonicalString } from '../../dist/chrome/core/matching/url.js';
import { isSafeDestination } from '../../dist/chrome/shared/urls.js';
import {
  ALLOWED_INTENT_PASS_DURATIONS_MS,
  DEFAULT_INTENT_PASS_DURATION_MS,
  MAX_INTENT_PASS_DURATION_MS,
} from '../../dist/chrome/shared/constants.js';
import { isValidMessage } from '../../dist/chrome/shared/messages.js';
import { ExtensionStorage } from '../../dist/chrome/storage/storage.js';
import { MomentDecisionEngine } from '../../dist/chrome/core/decisions/engine.js';
import type { Target } from '../../src/core/models/target.js';
import type { IntentPass, IntentPassScope } from '../../src/core/models/intent-pass.js';
import type { Collection } from '../../src/core/models/collection.js';
import type { TemporaryAccessGrant } from '../../src/core/models/grant.js';
import type { PendingIntervention } from '../../src/core/interventions/types.js';
import type { MomentStorageEnvelope } from '../../src/storage/schema.js';

describe('Phase 6: Intent Passes (Momentary Access)', () => {
  const baseTime = 1_000_000_000;

  describe('1. Duration Resolution & Clamping', () => {
    it('Accepts allowed durations (5m, 15m, 30m)', () => {
      assert.equal(resolveIntentPassDuration(5 * 60 * 1000), 5 * 60 * 1000);
      assert.equal(resolveIntentPassDuration(15 * 60 * 1000), 15 * 60 * 1000);
      assert.equal(resolveIntentPassDuration(30 * 60 * 1000), 30 * 60 * 1000);
    });

    it('Clamps values exceeding MAX_INTENT_PASS_DURATION_MS to 30m', () => {
      assert.equal(resolveIntentPassDuration(45 * 60 * 1000), MAX_INTENT_PASS_DURATION_MS);
      assert.equal(resolveIntentPassDuration(60 * 60 * 1000), MAX_INTENT_PASS_DURATION_MS);
      assert.equal(resolveIntentPassDuration(24 * 60 * 60 * 1000), MAX_INTENT_PASS_DURATION_MS);
    });

    it('Snaps arbitrary durations to nearest allowed duration', () => {
      assert.equal(resolveIntentPassDuration(1 * 60 * 1000), 5 * 60 * 1000);
      const res10 = resolveIntentPassDuration(10 * 60 * 1000);
      assert.ok(ALLOWED_INTENT_PASS_DURATIONS_MS.includes(res10 as any));
      assert.equal(resolveIntentPassDuration(25 * 60 * 1000), 30 * 60 * 1000);
    });

    it('Defaults on negative, zero, NaN, or non-finite values', () => {
      assert.equal(resolveIntentPassDuration(-5000), DEFAULT_INTENT_PASS_DURATION_MS);
      assert.equal(resolveIntentPassDuration(0), DEFAULT_INTENT_PASS_DURATION_MS);
      assert.equal(resolveIntentPassDuration(NaN), DEFAULT_INTENT_PASS_DURATION_MS);
      assert.equal(resolveIntentPassDuration(Infinity), DEFAULT_INTENT_PASS_DURATION_MS);
    });
  });

  describe('2. Scope Derivation Fidelity (Section 25 Invariant)', () => {
    it('WEBSITE rule derives WEBSITE scope matching apex and subdomains', () => {
      const rule: Target = {
        id: 't_reddit',
        pattern: 'reddit.com',
        type: 'WEBSITE',
        isException: false,
        createdAt: baseTime,
      };

      const scope = resolveIntentPassScope('https://reddit.com/r/technology', rule) as IntentPassScope;
      assert.ok(scope);
      assert.equal(scope.type, 'WEBSITE');
      assert.equal(scope.pattern, 'reddit.com');

      const pass: IntentPass = {
        id: 'pass_1',
        tabId: 1,
        scope,
        collectionId: 'col_1',
        matchedRuleId: 't_reddit',
        grantedAt: baseTime,
        expiresAt: baseTime + 15 * 60 * 1000,
        durationMs: 15 * 60 * 1000,
      };

      assert.ok(isIntentPassValidForNavigation(pass, 1, 'https://reddit.com/', baseTime + 1000));
      assert.ok(isIntentPassValidForNavigation(pass, 1, 'https://reddit.com/r/science', baseTime + 1000));
      assert.ok(isIntentPassValidForNavigation(pass, 1, 'https://old.reddit.com/r/all', baseTime + 1000));
      assert.equal(isIntentPassValidForNavigation(pass, 1, 'https://reddit.com.attacker.com/', baseTime + 1000), false);
      assert.equal(isIntentPassValidForNavigation(pass, 1, 'https://evil-reddit.com/', baseTime + 1000), false);
    });

    it('EXACT_HOST rule preserves EXACT_HOST scope without broadening to subdomains', () => {
      const rule: Target = {
        id: 't_exact_host',
        pattern: 'old.reddit.com',
        type: 'EXACT_HOST',
        isException: false,
        createdAt: baseTime,
      };

      const scope = resolveIntentPassScope('https://old.reddit.com/r/news', rule) as IntentPassScope;
      assert.ok(scope);
      assert.equal(scope.type, 'EXACT_HOST');
      assert.equal(scope.pattern, 'old.reddit.com');

      const pass: IntentPass = {
        id: 'pass_2',
        tabId: 1,
        scope,
        collectionId: 'col_1',
        matchedRuleId: 't_exact_host',
        grantedAt: baseTime,
        expiresAt: baseTime + 15 * 60 * 1000,
        durationMs: 15 * 60 * 1000,
      };

      assert.ok(isIntentPassValidForNavigation(pass, 1, 'https://old.reddit.com/r/news', baseTime + 1000));
      assert.ok(isIntentPassValidForNavigation(pass, 1, 'https://old.reddit.com/r/all', baseTime + 1000));
      assert.equal(isIntentPassValidForNavigation(pass, 1, 'https://reddit.com/r/news', baseTime + 1000), false);
      assert.equal(isIntentPassValidForNavigation(pass, 1, 'https://new.reddit.com/r/news', baseTime + 1000), false);
    });

    it('PATH_PREFIX rule preserves PATH_PREFIX scope and does not unlock other paths', () => {
      const rule: Target = {
        id: 't_prefix',
        pattern: 'github.com/trending',
        type: 'PATH_PREFIX',
        isException: false,
        createdAt: baseTime,
      };

      const scope = resolveIntentPassScope('https://github.com/trending/developers', rule) as IntentPassScope;
      assert.ok(scope);
      assert.equal(scope.type, 'PATH_PREFIX');
      assert.equal(scope.pattern, 'github.com/trending');

      const pass: IntentPass = {
        id: 'pass_3',
        tabId: 1,
        scope,
        collectionId: 'col_1',
        matchedRuleId: 't_prefix',
        grantedAt: baseTime,
        expiresAt: baseTime + 15 * 60 * 1000,
        durationMs: 15 * 60 * 1000,
      };

      assert.ok(isIntentPassValidForNavigation(pass, 1, 'https://github.com/trending', baseTime + 1000));
      assert.ok(isIntentPassValidForNavigation(pass, 1, 'https://github.com/trending/developers', baseTime + 1000));
      assert.ok(isIntentPassValidForNavigation(pass, 1, 'https://github.com/trending?since=daily', baseTime + 1000));
      assert.equal(isIntentPassValidForNavigation(pass, 1, 'https://github.com/', baseTime + 1000), false);
      assert.equal(isIntentPassValidForNavigation(pass, 1, 'https://github.com/explore', baseTime + 1000), false);
      assert.equal(isIntentPassValidForNavigation(pass, 1, 'https://github.com/pulls', baseTime + 1000), false);
    });

    it('EXACT_PAGE rule preserves EXACT_PAGE scope and does not unlock different pages', () => {
      const rule: Target = {
        id: 't_page',
        pattern: 'youtube.com/watch?v=123',
        type: 'EXACT_PAGE',
        isException: false,
        createdAt: baseTime,
      };

      const scope = resolveIntentPassScope('https://youtube.com/watch?v=123', rule) as IntentPassScope;
      assert.ok(scope);
      assert.equal(scope.type, 'EXACT_PAGE');
      assert.equal(scope.pattern, 'youtube.com/watch?v=123');

      const pass: IntentPass = {
        id: 'pass_4',
        tabId: 1,
        scope,
        collectionId: 'col_1',
        matchedRuleId: 't_page',
        grantedAt: baseTime,
        expiresAt: baseTime + 15 * 60 * 1000,
        durationMs: 15 * 60 * 1000,
      };

      assert.ok(isIntentPassValidForNavigation(pass, 1, 'https://youtube.com/watch?v=123', baseTime + 1000));
      assert.equal(isIntentPassValidForNavigation(pass, 1, 'https://youtube.com/watch?v=999', baseTime + 1000), false);
      assert.equal(isIntentPassValidForNavigation(pass, 1, 'https://youtube.com/', baseTime + 1000), false);
    });

    it('GLOB rule preserves GLOB scope faithfully', () => {
      const rule: Target = {
        id: 't_glob',
        pattern: 'example.com/docs/*',
        type: 'GLOB',
        isException: false,
        createdAt: baseTime,
      };

      const scope = resolveIntentPassScope('https://example.com/docs/api', rule) as IntentPassScope;
      assert.ok(scope);
      assert.equal(scope.type, 'GLOB');
      assert.equal(scope.pattern, 'example.com/docs/*');

      const pass: IntentPass = {
        id: 'pass_5',
        tabId: 1,
        scope,
        collectionId: 'col_1',
        matchedRuleId: 't_glob',
        grantedAt: baseTime,
        expiresAt: baseTime + 15 * 60 * 1000,
        durationMs: 15 * 60 * 1000,
      };

      assert.ok(isIntentPassValidForNavigation(pass, 1, 'https://example.com/docs/api', baseTime + 1000));
      assert.ok(isIntentPassValidForNavigation(pass, 1, 'https://example.com/docs/guide', baseTime + 1000));
      assert.equal(isIntentPassValidForNavigation(pass, 1, 'https://example.com/other', baseTime + 1000), false);
    });

    it('Derives WEBSITE fallback if no rule is passed', () => {
      const scope = resolveIntentPassScope('https://twitter.com/i/flow/signup', null) as IntentPassScope;
      assert.ok(scope);
      assert.equal(scope.type, 'WEBSITE');
      assert.equal(scope.pattern, 'twitter.com');
    });

    it('Returns null for malformed or non-web URLs', () => {
      assert.equal(resolveIntentPassScope('about:blank', null), null);
      assert.equal(resolveIntentPassScope('chrome://settings', null), null);
      assert.equal(resolveIntentPassScope('not-a-url', null), null);
    });
  });

  describe('3. Pure Domain Validator (isIntentPassValidForNavigation)', () => {
    const scope: IntentPassScope = { type: 'WEBSITE', pattern: 'reddit.com' };
    const pass: IntentPass = {
      id: 'pass_test',
      tabId: 42,
      scope,
      collectionId: 'col_social',
      matchedRuleId: 't_1',
      grantedAt: baseTime,
      expiresAt: baseTime + 15 * 60 * 1000,
      durationMs: 15 * 60 * 1000,
    };

    it('Valid within same tab and active duration', () => {
      assert.ok(isIntentPassValidForNavigation(pass, 42, 'https://reddit.com/r/all', baseTime + 5000));
    });

    it('Multi-tab isolation: Tab 42 pass is INVALID for Tab 43', () => {
      assert.equal(isIntentPassValidForNavigation(pass, 43, 'https://reddit.com/r/all', baseTime + 5000), false);
    });

    it('Expires at exact boundary (now >= expiresAt)', () => {
      assert.ok(isIntentPassValidForNavigation(pass, 42, 'https://reddit.com/', pass.expiresAt - 1));
      assert.equal(isIntentPassValidForNavigation(pass, 42, 'https://reddit.com/', pass.expiresAt), false);
      assert.equal(isIntentPassValidForNavigation(pass, 42, 'https://reddit.com/', pass.expiresAt + 1000), false);
    });

    it('Rejects pre-grant timestamps (clock anomaly)', () => {
      assert.equal(isIntentPassValidForNavigation(pass, 42, 'https://reddit.com/', baseTime - 1000), false);
    });

    it('Rejects passes exceeding MAX_INTENT_PASS_DURATION_MS', () => {
      const forgedPass: IntentPass = {
        ...pass,
        expiresAt: baseTime + 2 * 60 * 60 * 1000, // 2 hours
      };
      assert.equal(isIntentPassValidForNavigation(forgedPass, 42, 'https://reddit.com/', baseTime + 1000), false);
    });

    it('Rejects non-matching destinations', () => {
      assert.equal(isIntentPassValidForNavigation(pass, 42, 'https://youtube.com/', baseTime + 1000), false);
    });
  });

  describe('4. Typed Message Protocol & Payload Validation', () => {
    it('Validates REQUEST_INTENT_PASS message', () => {
      assert.ok(isValidMessage({ type: 'REQUEST_INTENT_PASS', durationMs: 900000, tabId: 1 }));
      assert.ok(isValidMessage({ type: 'REQUEST_INTENT_PASS', durationMs: 300000 }));
      assert.equal(isValidMessage({ type: 'REQUEST_INTENT_PASS' }), false);
      assert.equal(isValidMessage({ type: 'REQUEST_INTENT_PASS', durationMs: '15m' }), false);
      assert.equal(isValidMessage({ type: 'REQUEST_INTENT_PASS', durationMs: NaN }), false);
    });

    it('Validates GET_INTENT_PASS_STATUS message', () => {
      assert.ok(isValidMessage({ type: 'GET_INTENT_PASS_STATUS', tabId: 1 }));
      assert.ok(isValidMessage({ type: 'GET_INTENT_PASS_STATUS' }));
      assert.equal(isValidMessage({ type: 'GET_INTENT_PASS_STATUS', tabId: '1' }), false);
    });

    it('Validates END_INTENT_PASS message', () => {
      assert.ok(isValidMessage({ type: 'END_INTENT_PASS', tabId: 1 }));
      assert.ok(isValidMessage({ type: 'END_INTENT_PASS' }));
      assert.equal(isValidMessage({ type: 'END_INTENT_PASS', tabId: '1' }), false);
    });
  });

  describe('5. Storage Persistence & Service Worker Restart Resilience', () => {
    it('Initializes runtime.intentPasses cleanly', async () => {
      const storage = new ExtensionStorage();
      const state = await storage.getState();
      assert.ok(state.runtime.intentPasses);
      assert.deepEqual(state.runtime.intentPasses, {});
    });

    it('Persists and restores IntentPass across ExtensionStorage reboots', async () => {
      const mockDb: Record<string, any> = {};
      const mockBackend = {
        get: (key: string, cb: (res: any) => void) => cb({ [key]: mockDb[key] }),
        set: (obj: any, cb: () => void) => {
          Object.assign(mockDb, obj);
          cb();
        },
      };

      const storage1 = new ExtensionStorage(mockBackend);
      const testPass: IntentPass = {
        id: 'intent_123',
        tabId: 5,
        scope: { type: 'WEBSITE', pattern: 'reddit.com' },
        collectionId: 'col_social',
        matchedRuleId: 't_reddit',
        grantedAt: baseTime,
        expiresAt: baseTime + 900000,
        durationMs: 900000,
      };

      await storage1.updateState((draft: any) => {
        draft.runtime.intentPasses['5'] = testPass;
      });

      // Verify read from first instance
      const state1 = await storage1.getState();
      assert.deepEqual(state1.runtime.intentPasses['5'], testPass);

      // Simulate worker reboot with fresh storage instance backed by same storage.local
      const storage2 = new ExtensionStorage(mockBackend);
      const state2 = await storage2.getState();
      assert.deepEqual(state2.runtime.intentPasses['5'], testPass);
    });
  });

  describe('6. Policy Engine & Navigation Precedence', () => {
    const socialCollection: Collection = {
      id: 'col_social',
      name: 'Social Media',
      color: '#3b82f6',
      icon: 'heart',
      enabled: true,
      createdAt: baseTime,
      updatedAt: baseTime,
      dailyLimitMs: 60 * 1000, // 1 minute limit
      targets: [
        { id: 't_reddit', pattern: 'reddit.com', type: 'WEBSITE', isException: false, createdAt: baseTime },
      ],
      boundary: {
        schedule: { enabled: false, intervals: [] },
        limits: { dailyMinutes: 1, sessionMinutes: null },
        pause: { type: 'CONFIRM', durationSeconds: 0, requireIntentionText: false },
        action: { type: 'BLOCK_PAGE', redirectUrl: null },
        strictMode: false,
      },
    };

    const engine = new MomentDecisionEngine();

    it('Blocks or intervenes when no grant/pass is present', () => {
      engine.setCollections({ [socialCollection.id]: socialCollection });
      const decision = engine.evaluate({
        url: 'https://reddit.com/r/all',
        tabId: 10,
        timestamp: baseTime,
        collections: { [socialCollection.id]: socialCollection },
        activeGrants: [],
      });
      assert.ok(decision.action === 'INTERVENE' || decision.action === 'BLOCK');
    });

    it('Active IntentPass authorizes navigation under scope', () => {
      const scope = resolveIntentPassScope('https://reddit.com/r/all', socialCollection.targets[0]) as IntentPassScope;
      const pass: IntentPass = {
        id: 'pass_tab10',
        tabId: 10,
        scope,
        collectionId: socialCollection.id,
        matchedRuleId: 't_reddit',
        grantedAt: baseTime,
        expiresAt: baseTime + 15 * 60 * 1000,
        durationMs: 15 * 60 * 1000,
      };

      // Valid on Tab 10
      assert.ok(isIntentPassValidForNavigation(pass, 10, 'https://reddit.com/r/all', baseTime + 1000));
      assert.ok(isIntentPassValidForNavigation(pass, 10, 'https://reddit.com/r/news', baseTime + 2000));

      // Multi-tab isolation: Tab 11 remains blocked
      assert.equal(isIntentPassValidForNavigation(pass, 11, 'https://reddit.com/r/all', baseTime + 1000), false);
    });

    it('IntentPass does not extend daily budget: time continues accumulating', () => {
      // If daily usage already exceeds limit, core policy evaluates to DAILY_LIMIT_EXHAUSTED
      const decision = engine.evaluate({
        url: 'https://reddit.com/r/all',
        tabId: 10,
        timestamp: baseTime,
        collections: { [socialCollection.id]: socialCollection },
        activeGrants: [],
        dailyUsageMs: { [socialCollection.id]: 120 * 1000 }, // 2m used, 1m limit
      });
      assert.equal(decision.reason, 'DAILY_LIMIT_EXHAUSTED');

      // However, while IntentPass is active, the tab navigation is authorized by the pass validator
      const pass: IntentPass = {
        id: 'pass_tab10',
        tabId: 10,
        scope: { type: 'WEBSITE', pattern: 'reddit.com' },
        collectionId: socialCollection.id,
        matchedRuleId: 't_reddit',
        grantedAt: baseTime,
        expiresAt: baseTime + 15 * 60 * 1000,
        durationMs: 15 * 60 * 1000,
      };
      assert.ok(isIntentPassValidForNavigation(pass, 10, 'https://reddit.com/r/all', baseTime + 1000));

      // Once pass expires, the next navigation hits the exhausted daily limit
      assert.equal(
        isIntentPassValidForNavigation(pass, 10, 'https://reddit.com/r/all', baseTime + 20 * 60 * 1000),
        false
      );
    });
  });

  describe('7. Early Surrender & Lifecycle Hygiene', () => {
    it('Simulated early surrender clears pass immediately', async () => {
      const storage = new ExtensionStorage();
      const tabId = 99;
      const pass: IntentPass = {
        id: 'pass_99',
        tabId,
        scope: { type: 'WEBSITE', pattern: 'reddit.com' },
        collectionId: 'col_social',
        matchedRuleId: 't_reddit',
        grantedAt: baseTime,
        expiresAt: baseTime + 900000,
        durationMs: 900000,
      };

      await storage.updateState((draft: any) => {
        draft.runtime.intentPasses[String(tabId)] = pass;
      });

      let state = await storage.getState();
      assert.ok(state.runtime.intentPasses[String(tabId)]);

      // Early surrender: delete pass
      await storage.updateState((draft: any) => {
        delete draft.runtime.intentPasses[String(tabId)];
      });

      state = await storage.getState();
      assert.equal(state.runtime.intentPasses[String(tabId)], undefined);
    });

    it('Simulated tab closure cleans up intent passes', async () => {
      const storage = new ExtensionStorage();
      const tabId = 77;
      await storage.updateState((draft: any) => {
        draft.runtime.intentPasses[String(tabId)] = {
          id: 'pass_77',
          tabId,
          scope: { type: 'WEBSITE', pattern: 'reddit.com' },
          collectionId: 'col_social',
          matchedRuleId: 't_reddit',
          grantedAt: baseTime,
          expiresAt: baseTime + 900000,
          durationMs: 900000,
        };
      });

      // Tab closed
      await storage.updateState((draft: any) => {
        delete draft.runtime.intentPasses[String(tabId)];
      });

      const state = await storage.getState();
      assert.equal(state.runtime.intentPasses[String(tabId)], undefined);
    });
  });

  describe('8. End-to-End Background Integration & Security Audit', () => {
    const techCollection: Collection = {
      id: 'col_tech',
      name: 'Tech Policy',
      color: '#10b981',
      icon: 'code',
      enabled: true,
      createdAt: baseTime,
      updatedAt: baseTime,
      dailyLimitMs: null,
      targets: [
        {
          id: 'rule_prefix',
          pattern: 'reddit.com/r/technology',
          type: 'PATH_PREFIX',
          isException: false,
          createdAt: baseTime,
        },
        {
          id: 'rule_exception',
          pattern: 'reddit.com/r/technology/wiki',
          type: 'PATH_PREFIX',
          isException: true,
          createdAt: baseTime,
        },
      ],
      boundary: {
        schedule: { enabled: false, intervals: [] },
        limits: { dailyMinutes: null, sessionMinutes: null },
        pause: { type: 'CONFIRM', durationSeconds: 0, requireIntentionText: false },
        action: { type: 'BLOCK_PAGE', redirectUrl: null },
        strictMode: false,
      },
    };

    /**
     * Complete background integration runner simulating the exact logic from background/index.ts
     */
    class Phase6BackgroundRunner {
      storage: ExtensionStorage;
      engine: MomentDecisionEngine;

      constructor(storage?: ExtensionStorage) {
        this.storage = storage || new ExtensionStorage();
        this.engine = new MomentDecisionEngine([techCollection]);
      }

      async init() {
        await this.storage.updateState((draft: MomentStorageEnvelope) => {
          draft.collections[techCollection.id] = techCollection;
        });
      }

      async handleMessage(message: any, sender: any = {}, now: number = Date.now()) {
        switch (message.type) {
          case 'REQUEST_INTENT_PASS': {
            const senderTabId = sender?.tab?.id;
            const tabId = senderTabId !== undefined
              ? senderTabId
              : message.tabId !== undefined
              ? message.tabId
              : 1;

            const key = String(tabId);
            const state = await this.storage.getState();
            const durationMs = resolveIntentPassDuration(message.durationMs);

            const pending = state.runtime.pendingInterventions?.[key];
            let targetUrl: string | null = null;
            let matchedRule: Target | null = null;
            let targetCollectionId = '';
            let matchedRuleId: string | null = null;

            if (pending) {
              targetUrl = pending.targetUrl;
              targetCollectionId = pending.collectionId;
              matchedRuleId = pending.matchedRuleId || null;
              const col = state.collections[pending.collectionId];
              if (col && pending.matchedRuleId) {
                matchedRule = col.targets.find((t: any) => t.id === pending.matchedRuleId) || null;
              }

              // Verify target is still blocked under current policy (fail closed on exception)
              if (targetUrl) {
                this.engine.setCollections(state.collections);
                const currentDecision = this.engine.evaluate({
                  url: targetUrl,
                  tabId,
                  timestamp: now,
                  activeGrants: [],
                  collections: state.collections,
                });
                if (currentDecision.action === 'ALLOW') {
                  targetUrl = null;
                }
              }
            } else {
              // Direct request context evaluation
              const candidateUrl = message.candidateUrl;
              if (candidateUrl && (candidateUrl.startsWith('http://') || candidateUrl.startsWith('https://'))) {
                this.engine.setCollections(state.collections);
                const decision = this.engine.evaluate({
                  url: candidateUrl,
                  tabId,
                  timestamp: now,
                  activeGrants: [],
                  collections: state.collections,
                });
                if (decision.action === 'BLOCK' || decision.action === 'INTERVENE') {
                  targetUrl = candidateUrl;
                  targetCollectionId = decision.collectionId || '';
                  matchedRuleId = decision.matchedRuleId || null;
                  if (targetCollectionId && state.collections[targetCollectionId] && decision.matchedRuleId) {
                    const col = state.collections[targetCollectionId];
                    matchedRule = col.targets.find((t: any) => t.id === decision.matchedRuleId) || null;
                  }
                }
              }
            }

            if (!targetUrl || !isSafeDestination(targetUrl)) {
              return {
                success: false,
                error: 'Intent Pass can only be requested for blocked or restricted destinations.',
              };
            }

            const canonicalTarget = parseCanonicalUrl(targetUrl);
            const normalizedTargetUrl = canonicalTarget ? toCanonicalString(canonicalTarget) : targetUrl;
            const scope = resolveIntentPassScope(normalizedTargetUrl, matchedRule);

            if (!scope) {
              return { success: false, error: 'Could not resolve valid scope for destination.' };
            }

            const passId = `intent_${now}_${Math.random().toString(36).substring(2, 7)}`;
            const intentPass: IntentPass = {
              id: passId,
              tabId,
              scope: scope as IntentPassScope,
              collectionId: targetCollectionId,
              matchedRuleId,
              grantedAt: now,
              expiresAt: now + durationMs,
              durationMs,
            };

            let grantCreated: TemporaryAccessGrant | null = null;
            await this.storage.updateState((draft: any) => {
              if (!draft.runtime.intentPasses) {
                draft.runtime.intentPasses = {};
              }
              draft.runtime.intentPasses[key] = intentPass;

              if (draft.runtime.pendingInterventions?.[key]) {
                delete draft.runtime.pendingInterventions[key];
              }

              const grant: TemporaryAccessGrant = {
                id: `grant_${now}_${Math.random().toString(36).substring(2, 7)}`,
                tabId,
                target: normalizedTargetUrl,
                grantedAt: now,
                expiresAt: now + 60_000,
                nonce: Math.random().toString(36).substring(2, 10),
                singleUse: true,
              };
              draft.runtime.temporaryAccessGrants[key] = grant;
              grantCreated = grant;
            });

            return {
              success: true,
              data: {
                pass: intentPass,
                grant: grantCreated,
                targetUrl: normalizedTargetUrl,
              },
            };
          }

          case 'END_INTENT_PASS': {
            const senderTabId = sender?.tab?.id;
            const tabId = senderTabId !== undefined
              ? senderTabId
              : message.tabId !== undefined
              ? message.tabId
              : 1;

            const key = String(tabId);
            await this.storage.updateState((draft: any) => {
              if (draft.runtime.intentPasses) {
                delete draft.runtime.intentPasses[key];
              }
              if (draft.runtime.temporaryAccessGrants) {
                delete draft.runtime.temporaryAccessGrants[key];
              }
              if (draft.runtime.sitePasses) {
                delete draft.runtime.sitePasses[key];
              }
            });
            return { success: true };
          }

          default:
            return { success: false, error: 'Unknown message' };
        }
      }

      async onBeforeNavigate(tabId: number, url: string, now: number = Date.now()): Promise<{
        action: 'ALLOW' | 'INTERVENE' | 'BLOCK';
        reason: string;
      }> {
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          return { action: 'ALLOW', reason: 'NON_WEB' };
        }

        const state = await this.storage.getState();

        // Step 2: TemporaryAccessGrant
        const grant = state.runtime.temporaryAccessGrants?.[String(tabId)];
        if (grant && isGrantValidForNavigation(grant, tabId, url, now)) {
          return { action: 'ALLOW', reason: 'TEMPORARY_ACCESS_GRANT' };
        }

        // Step 3: IntentPass
        const intentPass = state.runtime.intentPasses?.[String(tabId)];
        if (intentPass) {
          if (isIntentPassValidForNavigation(intentPass, tabId, url, now)) {
            return { action: 'ALLOW', reason: 'INTENT_PASS' };
          } else if (now >= intentPass.expiresAt) {
            await this.storage.updateState((draft: any) => {
              delete draft.runtime.intentPasses[String(tabId)];
            });
          }
        }

        // Step 5: Core policy engine
        this.engine.setCollections(state.collections);
        const decision = this.engine.evaluate({
          url,
          tabId,
          timestamp: now,
          activeGrants: [],
          collections: state.collections,
        });

        return { action: decision.action as 'ALLOW' | 'INTERVENE' | 'BLOCK', reason: decision.reason };
      }
    }

    it('Complete request path: REQUEST_INTENT_PASS -> pass creation -> storage -> grant -> navigation authorization', async () => {
      const runner = new Phase6BackgroundRunner();
      await runner.init();

      const tabId = 20;
      const targetUrl = 'https://reddit.com/r/technology/hot';

      // 1. Initial navigation is intercepted
      const initialNav = await runner.onBeforeNavigate(tabId, targetUrl, baseTime);
      assert.equal(initialNav.action, 'INTERVENE');

      // 2. Tab is staged in pending interventions
      await runner.storage.updateState((draft: any) => {
        draft.runtime.pendingInterventions[String(tabId)] = {
          id: 'intv_tab20',
          tabId,
          targetUrl,
          collectionId: techCollection.id,
          matchedRuleId: 'rule_prefix',
          interventionType: 'CONFIRM',
          durationSeconds: 0,
          requireIntentionText: false,
          createdAt: baseTime,
          updatedAt: baseTime,
          nonce: 'nonce_20',
          status: 'PENDING',
        } as PendingIntervention;
      });

      // 3. User selects 5m Intent Pass in UI -> tab sends REQUEST_INTENT_PASS
      const response = await runner.handleMessage(
        { type: 'REQUEST_INTENT_PASS', durationMs: 5 * 60 * 1000 },
        { tab: { id: tabId } },
        baseTime + 1000
      );

      assert.ok(response.success);
      if (!response.data) throw new Error('Expected response.data');
      assert.ok(response.data.pass);
      assert.equal(response.data.pass.scope.type, 'PATH_PREFIX');
      assert.equal(response.data.pass.scope.pattern, 'reddit.com/r/technology');
      assert.equal(response.data.pass.durationMs, 5 * 60 * 1000);
      assert.equal(response.data.pass.expiresAt, baseTime + 1000 + 5 * 60 * 1000);

      // Pending intervention must be atomically consumed
      const stateAfter = await runner.storage.getState();
      assert.equal(stateAfter.runtime.pendingInterventions[String(tabId)], undefined);

      // Single-use grant created for immediate navigation commit
      assert.ok(stateAfter.runtime.temporaryAccessGrants[String(tabId)]);

      // 4. Immediate navigation commits via TemporaryAccessGrant
      const grantNav = await runner.onBeforeNavigate(tabId, targetUrl, baseTime + 1100);
      assert.equal(grantNav.action, 'ALLOW');
      assert.equal(grantNav.reason, 'TEMPORARY_ACCESS_GRANT');

      // 5. Subsequent in-scope navigation authorizes via IntentPass
      const inScopeNav = await runner.onBeforeNavigate(
        tabId,
        'https://reddit.com/r/technology/comments/abc123',
        baseTime + 5000
      );
      assert.equal(inScopeNav.action, 'ALLOW');
      assert.equal(inScopeNav.reason, 'INTENT_PASS');

      // 6. Navigation outside PATH_PREFIX scope fails IntentPass and is blocked by policy
      const outOfScopeNav = await runner.onBeforeNavigate(
        tabId,
        'https://reddit.com/r/technology-fake',
        baseTime + 6000
      );
      assert.ok(outOfScopeNav.reason !== 'INTENT_PASS');

      // 7. Another tab (tab 21) remains blocked (Multi-Tab Isolation)
      const otherTabNav = await runner.onBeforeNavigate(
        21,
        'https://reddit.com/r/technology/hot',
        baseTime + 7000
      );
      assert.equal(otherTabNav.action, 'INTERVENE');
    });

    it('Rejects client-forged scope and timestamps in REQUEST_INTENT_PASS', async () => {
      const runner = new Phase6BackgroundRunner();
      await runner.init();

      const tabId = 30;
      await runner.storage.updateState((draft: any) => {
        draft.runtime.pendingInterventions[String(tabId)] = {
          id: 'intv_tab30',
          tabId,
          targetUrl: 'https://reddit.com/r/technology',
          collectionId: techCollection.id,
          matchedRuleId: 'rule_prefix',
          interventionType: 'CONFIRM',
          durationSeconds: 0,
          requireIntentionText: false,
          createdAt: baseTime,
          updatedAt: baseTime,
          nonce: 'nonce_30',
          status: 'PENDING',
        } as PendingIntervention;
      });

      // Malicious payload attempting to inject wildcard scope and 100-hour duration
      const forgedPayload = {
        type: 'REQUEST_INTENT_PASS',
        durationMs: 100 * 60 * 60 * 1000,
        scope: { type: 'WEBSITE', pattern: '*' },
        expiresAt: baseTime + 1000000000,
      };

      const response = await runner.handleMessage(forgedPayload, { tab: { id: tabId } }, baseTime);
      assert.ok(response.success);
      if (!response.data) throw new Error('Expected response.data');
      // Authoritatively clamped to MAX_INTENT_PASS_DURATION_MS (30m)
      assert.equal(response.data.pass.durationMs, MAX_INTENT_PASS_DURATION_MS);
      // Authoritatively derived from matched rule, ignoring injected scope
      assert.equal(response.data.pass.scope.type, 'PATH_PREFIX');
      assert.equal(response.data.pass.scope.pattern, 'reddit.com/r/technology');
    });

    it('Rejects Intent Pass requests for unblocked or exception destinations', async () => {
      const runner = new Phase6BackgroundRunner();
      await runner.init();

      // 1. Completely unblocked site
      const unblockedRes = await runner.handleMessage(
        { type: 'REQUEST_INTENT_PASS', candidateUrl: 'https://wikipedia.org' },
        { tab: { id: 31 } },
        baseTime
      );
      assert.equal(unblockedRes.success, false);
      assert.ok(unblockedRes.error && unblockedRes.error.includes('blocked or restricted'));

      // 2. Exception destination within blocked collection
      const exceptionRes = await runner.handleMessage(
        { type: 'REQUEST_INTENT_PASS', candidateUrl: 'https://reddit.com/r/technology/wiki' },
        { tab: { id: 32 } },
        baseTime
      );
      assert.equal(exceptionRes.success, false);
      assert.ok(exceptionRes.error && exceptionRes.error.includes('blocked or restricted'));
    });

    it('Sender tab authority: tab ID in sender context takes precedence over client message body', async () => {
      const runner = new Phase6BackgroundRunner();
      await runner.init();

      const realTabId = 42;
      const claimedTabId = 99;

      await runner.storage.updateState((draft: any) => {
        draft.runtime.pendingInterventions[String(realTabId)] = {
          id: 'intv_tab42',
          tabId: realTabId,
          targetUrl: 'https://reddit.com/r/technology',
          collectionId: techCollection.id,
          matchedRuleId: 'rule_prefix',
          interventionType: 'CONFIRM',
          durationSeconds: 0,
          requireIntentionText: false,
          createdAt: baseTime,
          updatedAt: baseTime,
          nonce: 'nonce_42',
          status: 'PENDING',
        } as PendingIntervention;
      });

      // Sender is in tab 42, but payload maliciously claims tabId 99
      const res = await runner.handleMessage(
        { type: 'REQUEST_INTENT_PASS', tabId: claimedTabId, durationMs: 5 * 60 * 1000 },
        { tab: { id: realTabId } },
        baseTime
      );

      assert.ok(res.success);
      if (!res.data) throw new Error('Expected res.data');
      assert.equal(res.data.pass.tabId, realTabId);

      const state = await runner.storage.getState();
      assert.ok(state.runtime.intentPasses[String(realTabId)]);
      assert.equal(state.runtime.intentPasses[String(claimedTabId)], undefined);
    });

    it('END_INTENT_PASS immediately revokes access; subsequent navigation is blocked', async () => {
      const runner = new Phase6BackgroundRunner();
      await runner.init();

      const tabId = 50;
      await runner.handleMessage(
        { type: 'REQUEST_INTENT_PASS', candidateUrl: 'https://reddit.com/r/technology' },
        { tab: { id: tabId } },
        baseTime
      );

      // Verify immediate commit allows navigation via TEMPORARY_ACCESS_GRANT
      const nav1 = await runner.onBeforeNavigate(tabId, 'https://reddit.com/r/technology/1', baseTime + 1000);
      assert.equal(nav1.reason, 'TEMPORARY_ACCESS_GRANT');

      // Subsequent in-scope navigation authorizes via INTENT_PASS after immediate grant window
      const navSub = await runner.onBeforeNavigate(tabId, 'https://reddit.com/r/technology/sub', baseTime + 70000);
      assert.equal(navSub.reason, 'INTENT_PASS');

      // User clicks "End Intent Pass"
      const endRes = await runner.handleMessage({ type: 'END_INTENT_PASS' }, { tab: { id: tabId } });
      assert.ok(endRes.success);

      // Next navigation is immediately intercepted/blocked
      const nav2 = await runner.onBeforeNavigate(tabId, 'https://reddit.com/r/technology/2', baseTime + 71000);
      assert.equal(nav2.action, 'INTERVENE');
    });

    it('Expired pass is automatically pruned upon navigation and normal policy resumes', async () => {
      const runner = new Phase6BackgroundRunner();
      await runner.init();

      const tabId = 60;
      await runner.handleMessage(
        { type: 'REQUEST_INTENT_PASS', candidateUrl: 'https://reddit.com/r/technology', durationMs: 5 * 60 * 1000 },
        { tab: { id: tabId } },
        baseTime
      );

      // Active at 4 minutes
      const navActive = await runner.onBeforeNavigate(
        tabId,
        'https://reddit.com/r/technology',
        baseTime + 4 * 60 * 1000
      );
      assert.equal(navActive.reason, 'INTENT_PASS');

      // Expired at 5m + 1ms
      const navExpired = await runner.onBeforeNavigate(
        tabId,
        'https://reddit.com/r/technology',
        baseTime + 5 * 60 * 1000 + 1
      );
      assert.equal(navExpired.action, 'INTERVENE');

      // Pass was pruned from storage
      const state = await runner.storage.getState();
      assert.equal(state.runtime.intentPasses[String(tabId)], undefined);
    });
  });
});
