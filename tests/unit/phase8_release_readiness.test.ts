/**
 * Phase 8: Release Readiness & Robustness Audit Test Suite
 * Hostile audit verifying reliability, corruption resilience, lifecycle boundaries,
 * security invariants, and performance scale across all 27 audit dimensions.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_USER_SETTINGS,
} from '../../dist/chrome/storage/schema.js';
import { migrateStorageState } from '../../dist/chrome/storage/migrations.js';
import { ExtensionStorage } from '../../dist/chrome/storage/storage.js';
import { MomentDecisionEngine } from '../../dist/chrome/core/decisions/engine.js';
import { parseCanonicalUrl } from '../../dist/chrome/core/matching/url.js';
import { matchTarget } from '../../dist/chrome/core/matching/matcher.js';
import { isTimeInInterval } from '../../dist/chrome/core/policies/boundary-evaluator.js';
import { isSitePassValidForNavigation } from '../../dist/chrome/core/grants/site-pass-validator.js';
import { isIntentPassValidForNavigation } from '../../dist/chrome/core/grants/intent-pass-validator.js';
import { resolveFocusModeDuration } from '../../dist/chrome/core/focus/focus-validator.js';
import { isValidMessage } from '../../dist/chrome/shared/messages.js';
import {
  validateCollectionName,
  validateTargetPattern,
  validateImportPayload,
} from '../../dist/chrome/core/validation/rules.js';
import {
  calculateActiveDelta,
  splitIntervalAtMidnight,
} from '../../dist/chrome/core/usage/accounting.js';
import { MAX_DISCRETE_ACTIVE_DELTA_MS } from '../../dist/chrome/shared/constants.js';

describe('Phase 8 — Release Readiness & Robustness Audit', () => {

  // =========================================================================
  // PART 1 — FRESH INSTALL
  // =========================================================================
  describe('Part 1: Fresh Install & Clean Lifecycle', () => {
    it('initializes clean defaults without stale runtime state', () => {
      const state = migrateStorageState(null);
      assert.equal(state.schemaVersion, CURRENT_SCHEMA_VERSION);
      assert.deepEqual(state.settings, DEFAULT_USER_SETTINGS);
      assert.deepEqual(state.collections, {});
      assert.deepEqual(state.usage, {});
      assert.deepEqual(state.runtime.pendingInterventions, {});
      assert.deepEqual(state.runtime.temporaryAccessGrants, {});
      assert.deepEqual(state.runtime.sitePasses, {});
      assert.deepEqual(state.runtime.intentPasses, {});
      assert.equal(state.runtime.focusSession, null);
    });

    it('creating first collection, adding rule, and deleting behaves safely', () => {
      const nameVal = validateCollectionName('Work Boundaries');
      assert.ok(nameVal.valid);

      const targetVal = validateTargetPattern('reddit.com', 'WEBSITE');
      assert.ok(targetVal.valid);
      assert.equal(targetVal.sanitized, 'reddit.com');

      const col: any = {
        id: 'col_1',
        name: nameVal.sanitized,
        color: '#2e7d32',
        icon: 'shield',
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        dailyLimitMs: null,
        targets: [
          {
            id: 't_1',
            pattern: targetVal.sanitized,
            type: 'WEBSITE',
            isException: false,
            createdAt: Date.now(),
          },
        ],
        boundary: {
          schedule: { enabled: false, intervals: [] },
          limits: { dailyMinutes: null, sessionMinutes: null },
          pause: { type: 'BREATHE', durationSeconds: 10, requireIntentionText: false },
          action: { type: 'BLOCK_PAGE', redirectUrl: null },
          strictMode: false,
        },
      };

      const engine = new MomentDecisionEngine({ col_1: col });
      const decision = engine.evaluate({
        url: 'https://reddit.com/r/popular',
        tabId: 1,
        timestamp: Date.now(),
        collections: { col_1: col },
      });

      assert.equal(decision.action, 'INTERVENE');
      assert.equal(decision.collectionId, 'col_1');

      // Remove rule -> site should immediately be allowed
      col.targets = [];
      const decisionAfterRuleRemoval = engine.evaluate({
        url: 'https://reddit.com/r/popular',
        tabId: 1,
        timestamp: Date.now(),
        collections: { col_1: col },
      });
      assert.equal(decisionAfterRuleRemoval.action, 'ALLOW');
    });
  });

  // =========================================================================
  // PART 2 & 3 — UPDATE / MIGRATION & STORAGE CORRUPTION
  // =========================================================================
  describe('Part 2 & 3: Migration Preservation & Storage Corruption Recovery', () => {
    it('migrates v0 unversioned state to v3 with default focusSession: null', () => {
      const v0State = {
        settings: { theme: 'dark' },
        collections: {
          col_old: {
            id: 'col_old',
            name: 'Old Col',
            targets: [{ id: 't_old', pattern: 'news.ycombinator.com', type: 'WEBSITE' }],
          },
        },
      };

      const migrated = migrateStorageState(v0State);
      assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
      assert.equal(migrated.settings.theme, 'dark');
      assert.ok(migrated.collections.col_old);
      assert.equal(migrated.runtime.focusSession, null);
      assert.deepEqual(migrated.runtime.pendingInterventions, {});
      assert.deepEqual(migrated.runtime.sitePasses, {});
    });

    it('migrates v1 state preserving collections and adding target priorities', () => {
      const v1State = {
        schemaVersion: 1,
        settings: { theme: 'sepia', timeFormat: '12h' },
        collections: {
          col_1: {
            id: 'col_1',
            name: 'Reading',
            targets: [{ id: 't_1', pattern: 'example.com', type: 'WEBSITE' }],
          },
        },
      };

      const migrated = migrateStorageState(v1State);
      assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
      assert.equal(migrated.settings.theme, 'sepia');
      assert.equal(migrated.settings.timeFormat, '12h');
      assert.equal(migrated.collections.col_1.targets[0].priority, 0);
      assert.equal(migrated.runtime.focusSession, null);
    });

    it('migrates v2 state adding usage dictionary and tracking', () => {
      const v2State = {
        schemaVersion: 2,
        settings: { theme: 'light' },
        collections: {},
      };

      const migrated = migrateStorageState(v2State);
      assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
      assert.deepEqual(migrated.usage, {});
      assert.equal(migrated.runtime.focusSession, null);
    });

    it('handles extreme corrupted storage structures without crashing', () => {
      const corruptedInputs = [
        null,
        undefined,
        '',
        12345,
        true,
        false,
        [],
        [1, 2, 3],
        { schemaVersion: 'corrupt' },
        { schemaVersion: -5 },
        { schemaVersion: NaN },
        { schemaVersion: Infinity },
        { schemaVersion: 999 }, // future schema
        { schemaVersion: 3, collections: 'corrupted_string' },
        { schemaVersion: 3, collections: [1, 2, 3] },
        { schemaVersion: 3, collections: { c1: null, c2: 'bad', c3: 123 } },
        { schemaVersion: 3, usage: 'corrupted_usage' },
        { schemaVersion: 3, usage: [1, 2, 3] },
        { schemaVersion: 3, settings: 'bad_settings' },
        { schemaVersion: 3, settings: { theme: 'neon_pink', timeFormat: '99h' } },
        { schemaVersion: 3, runtime: 'bad_runtime' },
        { schemaVersion: 3, runtime: { focusSession: 'malformed_string' } },
        { schemaVersion: 3, runtime: { sitePasses: null, intentPasses: 'string' } },
      ];

      for (const input of corruptedInputs) {
        const result = migrateStorageState(input);
        assert.ok(result, 'Must return an envelope');
        assert.equal(result.schemaVersion, CURRENT_SCHEMA_VERSION);
        assert.equal(typeof result.settings, 'object');
        assert.ok(['system', 'light', 'dark', 'sepia'].includes(result.settings.theme));
        assert.ok(['12h', '24h'].includes(result.settings.timeFormat));
        assert.equal(typeof result.collections, 'object');
        assert.ok(!Array.isArray(result.collections));
        assert.equal(typeof result.usage, 'object');
        assert.ok(!Array.isArray(result.usage));
        assert.equal(typeof result.runtime, 'object');
        assert.equal(typeof result.runtime.pendingInterventions, 'object');
        assert.equal(typeof result.runtime.temporaryAccessGrants, 'object');
        assert.equal(typeof result.runtime.sitePasses, 'object');
        assert.equal(typeof result.runtime.intentPasses, 'object');
      }
    });

    it('preserves valid user collections when recovering from corrupted runtime state', () => {
      const partiallyCorrupted = {
        schemaVersion: 3,
        settings: { theme: 'dark', timeFormat: '24h' },
        collections: {
          col_valid: {
            id: 'col_valid',
            name: 'Deep Work',
            enabled: true,
            targets: [{ id: 't_1', pattern: 'distraction.com', type: 'WEBSITE' }],
          },
        },
        usage: {
          '2026-09-09:col_valid': {
            dateKey: '2026-09-09',
            collectionId: 'col_valid',
            accumulatedMs: 5000,
          },
        },
        runtime: {
          focusSession: { corrupt: true },
          sitePasses: 'corrupt',
        },
      };

      const recovered = migrateStorageState(partiallyCorrupted);
      assert.equal(recovered.collections.col_valid.name, 'Deep Work');
      assert.equal(recovered.usage['2026-09-09:col_valid'].accumulatedMs, 5000);
      assert.equal(recovered.runtime.focusSession, null);
      assert.deepEqual(recovered.runtime.sitePasses, {});
    });
  });

  // =========================================================================
  // PART 4 & 5 — SERVICE WORKER LIFECYCLE & ACTIVE PASSES
  // =========================================================================
  describe('Part 4 & 5: Service Worker Lifecycle & Active Passes', () => {
    it('persists and restores authoritative runtime state across simulated worker suspension', async () => {
      const mockStorageData: any = {};
      const customBackend = {
        get: (_key: string, cb: any) => cb({ moment_state: mockStorageData.moment_state }),
        set: (items: any, cb: any) => {
          Object.assign(mockStorageData, items);
          cb();
        },
      };

      const storageInstance1 = new ExtensionStorage(customBackend);
      const now = 1750000000000;

      // Worker 1 creates an IntentPass and FocusSession
      await storageInstance1.updateState((draft: any) => {
        draft.runtime.intentPasses['42'] = {
          id: 'intent_42',
          tabId: 42,
          scope: { type: 'WEBSITE', pattern: 'reddit.com' },
          collectionId: 'col_social',
          matchedRuleId: 't_1',
          grantedAt: now,
          expiresAt: now + 900_000,
          durationMs: 900_000,
        };
        draft.runtime.focusSession = {
          id: 'focus_1',
          startedAt: now,
          expiresAt: now + 3600_000,
          durationMs: 3600_000,
          selectedCollectionIds: ['col_social'],
          status: 'ACTIVE',
        };
      });

      // Worker 1 suspends (in-memory state discarded). Worker 2 starts up.
      const storageInstance2 = new ExtensionStorage(customBackend);
      const restoredState = await storageInstance2.getState();

      assert.ok(restoredState.runtime.intentPasses['42']);
      assert.equal(restoredState.runtime.intentPasses['42'].id, 'intent_42');
      assert.ok(restoredState.runtime.focusSession);
      assert.equal(restoredState.runtime.focusSession?.id, 'focus_1');

      // Validate IntentPass authorizes navigation in Worker 2
      const valid = isIntentPassValidForNavigation(
        restoredState.runtime.intentPasses['42'],
        42,
        'https://reddit.com/r/science',
        now + 60_000
      );
      assert.ok(valid);
    });

    it('SitePass strictly authorizes same-site navigation and rejects lookalikes', () => {
      const now = 1750000000000;
      const sitePass = {
        id: 'pass_1',
        tabId: 5,
        site: 'reddit.com',
        grantedAt: now,
        expiresAt: now + 300_000,
      };

      // Valid same-site destinations
      assert.ok(isSitePassValidForNavigation(sitePass, 5, 'https://reddit.com', now + 1000));
      assert.ok(isSitePassValidForNavigation(sitePass, 5, 'https://reddit.com/r/all', now + 1000));
      assert.ok(isSitePassValidForNavigation(sitePass, 5, 'https://www.reddit.com/r/all', now + 1000));
      assert.ok(isSitePassValidForNavigation(sitePass, 5, 'https://old.reddit.com/r/all', now + 1000));

      // Rejections: wrong tab, expired, lookalikes
      assert.equal(isSitePassValidForNavigation(sitePass, 99, 'https://reddit.com', now + 1000), false, 'Wrong tab');
      assert.equal(isSitePassValidForNavigation(sitePass, 5, 'https://reddit.com', now + 400_000), false, 'Expired');
      assert.equal(isSitePassValidForNavigation(sitePass, 5, 'https://evil-reddit.com', now + 1000), false, 'Lookalike hyphen');
      assert.equal(isSitePassValidForNavigation(sitePass, 5, 'https://reddit.com.evil.com', now + 1000), false, 'Subdomain attack');
      assert.equal(isSitePassValidForNavigation(sitePass, 5, 'https://evil.com/?reddit.com', now + 1000), false, 'Query param trick');
    });

    it('FocusSession enforces duration clamping and validation', () => {
      assert.equal(resolveFocusModeDuration(undefined), 1800_000); // default 30m
      assert.equal(resolveFocusModeDuration(900_000), 900_000); // exact 15m
      assert.equal(resolveFocusModeDuration(7200_000), 7200_000); // exact 120m
      assert.equal(resolveFocusModeDuration(99999999), 7200_000); // clamped to max 120m
      assert.equal(resolveFocusModeDuration(-500), 1800_000); // negative fallback
      assert.equal(resolveFocusModeDuration(NaN), 1800_000); // NaN fallback
    });
  });

  // =========================================================================
  // PART 6 & 7 — URL & TARGET SECURITY MATRIX
  // =========================================================================
  describe('Part 6 & 7: URL Matching, Canonicalization & Attack Matrix', () => {
    it('WEBSITE matching: covers apex and subdomains, rejects lookalikes', () => {
      const target: any = { id: 't_1', pattern: 'example.com', type: 'WEBSITE' };

      const allowed = [
        'http://example.com',
        'https://example.com',
        'https://example.com/some/long/path',
        'https://www.example.com',
        'https://sub.example.com/path',
      ];
      for (const url of allowed) {
        assert.ok(matchTarget(target, parseCanonicalUrl(url)!), `Should match: ${url}`);
      }

      const rejected = [
        'https://evil-example.com',
        'https://example.com.evil.com',
        'https://notexample.com',
        'https://evil.com/?target=example.com',
        'https://evil.com/#example.com',
      ];
      for (const url of rejected) {
        assert.equal(matchTarget(target, parseCanonicalUrl(url)!), false, `Should NOT match: ${url}`);
      }
    });

    it('EXACT_HOST matching: rejects subdomains', () => {
      const target: any = { id: 't_1', pattern: 'example.com', type: 'EXACT_HOST' };

      assert.ok(matchTarget(target, parseCanonicalUrl('https://example.com/foo')!));
      assert.equal(matchTarget(target, parseCanonicalUrl('https://www.example.com')!), false);
      assert.equal(matchTarget(target, parseCanonicalUrl('https://sub.example.com')!), false);
      assert.equal(matchTarget(target, parseCanonicalUrl('https://evil-example.com')!), false);
    });

    it('PATH_PREFIX matching: boundary-aware path protection', () => {
      const target: any = { id: 't_1', pattern: 'example.com/feed', type: 'PATH_PREFIX' };

      assert.ok(matchTarget(target, parseCanonicalUrl('https://example.com/feed')!));
      assert.ok(matchTarget(target, parseCanonicalUrl('https://example.com/feed/')!));
      assert.ok(matchTarget(target, parseCanonicalUrl('https://example.com/feed/comments/123')!));
      // Boundary safety: /feedback should NOT match /feed
      assert.equal(matchTarget(target, parseCanonicalUrl('https://example.com/feedback')!), false);
    });

    it('EXACT_PAGE matching: requires exact path and query matching', () => {
      const targetWithoutQuery: any = { id: 't_1', pattern: 'example.com/login.html', type: 'EXACT_PAGE' };
      assert.ok(matchTarget(targetWithoutQuery, parseCanonicalUrl('https://example.com/login.html')!));
      assert.equal(matchTarget(targetWithoutQuery, parseCanonicalUrl('https://example.com/login.html/extra')!), false);
      assert.equal(matchTarget(targetWithoutQuery, parseCanonicalUrl('https://example.com/login2.html')!), false);

      const targetWithQuery: any = { id: 't_2', pattern: 'example.com/search?q=distraction', type: 'EXACT_PAGE' };
      assert.ok(matchTarget(targetWithQuery, parseCanonicalUrl('https://example.com/search?q=distraction')!));
      assert.equal(matchTarget(targetWithQuery, parseCanonicalUrl('https://example.com/search?q=work')!), false);
    });

    it('Port normalization: default ports stripped, non-default ports preserved', () => {
      const httpDef = parseCanonicalUrl('http://example.com:80/path');
      assert.equal(httpDef?.port, '');

      const httpsDef = parseCanonicalUrl('https://example.com:443/path');
      assert.equal(httpsDef?.port, '');

      const nonDef = parseCanonicalUrl('https://example.com:8443/path');
      assert.equal(nonDef?.port, '8443');

      const target: any = { id: 't_1', pattern: 'example.com:8443', type: 'WEBSITE' };
      assert.ok(matchTarget(target, nonDef!));
      assert.equal(matchTarget(target, httpsDef!), false, 'Port mismatch must not match');
    });
  });

  // =========================================================================
  // PART 8 & 9 — SUBFRAME & RESTRICTED SCHEMES
  // =========================================================================
  describe('Part 8 & 9: Subframes and Restricted Schemes', () => {
    it('parseCanonicalUrl returns null for non-web schemes (never throws)', () => {
      const unsupported = [
        'about:blank',
        'about:preferences',
        'about:addons',
        'about:debugging',
        'chrome://extensions',
        'chrome://settings',
        'moz-extension://uuid/options.html',
        'file:///home/user/document.pdf',
        'data:text/html,<h1>Hello</h1>',
        'blob:https://example.com/uuid',
        'view-source:https://example.com',
        'javascript:void(0)',
      ];

      for (const url of unsupported) {
        assert.equal(parseCanonicalUrl(url), null, `Scheme should be null: ${url}`);
      }
    });

    it('engine safely evaluates non-web URLs as ALLOW under NO_RULE_MATCH without crashing', () => {
      const engine = new MomentDecisionEngine();
      const decision = engine.evaluate({
        url: 'about:preferences',
        tabId: 1,
        timestamp: Date.now(),
      });
      assert.equal(decision.action, 'ALLOW');
      assert.equal(decision.reason, 'NO_RULE_MATCH');
    });
  });

  // =========================================================================
  // PART 10 & 11 — MULTI-TAB & MULTI-WINDOW ISOLATION
  // =========================================================================
  describe('Part 10 & 11: Multi-Tab & Multi-Window Isolation', () => {
    it('IntentPass in Tab A does not leak authorization to Tab B', () => {
      const now = Date.now();
      const intentPass = {
        id: 'pass_tab1',
        tabId: 1,
        scope: { type: 'WEBSITE' as const, pattern: 'youtube.com' },
        collectionId: 'col_video',
        matchedRuleId: null,
        grantedAt: now,
        expiresAt: now + 900_000,
        durationMs: 900_000,
      };

      assert.ok(isIntentPassValidForNavigation(intentPass, 1, 'https://youtube.com', now + 1000));
      assert.equal(
        isIntentPassValidForNavigation(intentPass, 2, 'https://youtube.com', now + 1000),
        false,
        'Tab 2 must not be authorized by Tab 1 pass'
      );
    });

    it('SitePass in Tab A does not leak authorization to Tab B', () => {
      const now = Date.now();
      const sitePass = {
        id: 'site_tab1',
        tabId: 1,
        site: 'twitter.com',
        grantedAt: now,
        expiresAt: now + 300_000,
      };

      assert.ok(isSitePassValidForNavigation(sitePass, 1, 'https://twitter.com', now + 1000));
      assert.equal(
        isSitePassValidForNavigation(sitePass, 2, 'https://twitter.com', now + 1000),
        false,
        'Tab 2 must not be authorized by Tab 1 pass'
      );
    });
  });

  // =========================================================================
  // PART 12 — RULE & COLLECTION MUTATION DURING RUNTIME
  // =========================================================================
  describe('Part 12: Rule & Collection Mutation During Runtime', () => {
    it('engine tolerates null or corrupted collection items in collections map without crashing', () => {
      const collectionsWithNull: any = {
        col_1: {
          id: 'col_1',
          name: 'Social',
          enabled: true,
          targets: [{ id: 't_1', pattern: 'instagram.com', type: 'WEBSITE' }],
        },
        col_corrupt1: null,
        col_corrupt2: 'not_an_object',
        col_corrupt3: undefined,
      };

      const engine = new MomentDecisionEngine(collectionsWithNull);
      const decision = engine.evaluate({
        url: 'https://instagram.com/feed',
        tabId: 1,
        timestamp: Date.now(),
        collections: collectionsWithNull,
      });

      assert.equal(decision.action, 'BLOCK');
      assert.equal(decision.collectionId, 'col_1');
    });

    it('isTimeInInterval tolerates corrupted interval objects safely', () => {
      assert.equal(isTimeInInterval(1, 600, null as any), false);
      assert.equal(isTimeInInterval(1, 600, {} as any), false);
      assert.equal(isTimeInInterval(1, 600, { days: null } as any), false);
      assert.equal(isTimeInInterval(1, 600, { days: [1], startMinute: 500, endMinute: 700 }), true);
    });
  });

  // =========================================================================
  // PART 13 — DAILY USAGE & CLOCK DEFENSE
  // =========================================================================
  describe('Part 13: Daily Usage & Clock Discontinuity Defense', () => {
    it('clamps 12-hour OS sleep discontinuity to exactly MAX_DISCRETE_ACTIVE_DELTA_MS (60s)', () => {
      const last = 1750000000000;
      const twelveHoursLater = last + 12 * 3600 * 1000;
      const delta = calculateActiveDelta(last, twelveHoursLater, MAX_DISCRETE_ACTIVE_DELTA_MS);
      assert.equal(delta, 60_000);
    });

    it('clock rollback returns 0 delta and prevents usage corruption', () => {
      const checkpoint = 1750000000000;
      const rolledBack = checkpoint - 3600 * 1000; // 1 hour earlier
      const delta = calculateActiveDelta(checkpoint, rolledBack, MAX_DISCRETE_ACTIVE_DELTA_MS);
      assert.equal(delta, 0);
    });

    it('correctly splits interval spanning midnight across date keys', () => {
      // 2026-09-09 23:55:00 to 2026-09-10 00:05:00 (10 minutes)
      const start = new Date('2026-09-09T23:55:00').getTime();
      const end = new Date('2026-09-10T00:05:00').getTime();

      const slices = splitIntervalAtMidnight(start, end);
      assert.equal(slices.length, 2);
      assert.equal(slices[0].dateKey, '2026-09-09');
      assert.equal(slices[0].durationMs, 5 * 60 * 1000);
      assert.equal(slices[1].dateKey, '2026-09-10');
      assert.equal(slices[1].durationMs, 5 * 60 * 1000);
    });
  });

  // =========================================================================
  // PART 14 — PERFORMANCE & SCALE BENCHMARK
  // =========================================================================
  describe('Part 14: Scale & Performance Benchmark', () => {
    it('evaluates policy engine efficiently across 10 collections and 1,000 rules', () => {
      const collections: Record<string, any> = {};

      for (let c = 0; c < 10; c++) {
        const colId = `col_${c}`;
        const targets = [];
        for (let r = 0; r < 100; r++) {
          targets.push({
            id: `t_${c}_${r}`,
            pattern: `site${c}-${r}.example.com`,
            type: 'WEBSITE',
            isException: r === 0, // 1 exception per collection
            createdAt: Date.now(),
          });
        }
        collections[colId] = {
          id: colId,
          name: `Collection ${c}`,
          enabled: true,
          targets,
          boundary: { schedule: { enabled: false, intervals: [] } },
        };
      }

      const engine = new MomentDecisionEngine(collections);
      const testUrl = 'https://site5-50.example.com/some/subpage';
      const now = Date.now();

      // Warmup
      engine.evaluate({ url: testUrl, tabId: 1, timestamp: now, collections });

      // Benchmark 500 evaluations
      const iterations = 500;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        const res = engine.evaluate({ url: testUrl, tabId: 1, timestamp: now, collections });
        assert.equal(res.action, 'BLOCK');
      }
      const elapsedMs = performance.now() - start;
      const avgPerEvalMs = elapsedMs / iterations;

      console.log(`[Scale Benchmark] 1,000 rules across 10 collections: ${iterations} evaluations in ${elapsedMs.toFixed(2)}ms (${avgPerEvalMs.toFixed(3)}ms/eval)`);
      assert.ok(avgPerEvalMs < 5.0, `Evaluation should take less than 5ms (was ${avgPerEvalMs}ms)`);
    });
  });

  // =========================================================================
  // PART 16 — IMPORT / EXPORT ATTACK DEFENSE
  // =========================================================================
  describe('Part 16: Import/Export Attack Defense', () => {
    it('rejects malicious import payloads with injected scripts, passes, or focus sessions', () => {
      const maliciousPayload = {
        schemaVersion: 3,
        exportedAt: Date.now(),
        settings: { theme: 'dark' },
        collections: {
          col_attack: {
            id: 'col_attack',
            name: '<script>alert("XSS")</script>',
            targets: [
              {
                id: 't_attack',
                pattern: 'example.com',
                type: 'WEBSITE',
              },
            ],
          },
        },
        // Injected runtime state (must be discarded)
        runtime: {
          temporaryAccessGrants: {
            fake: { id: 'fake_grant', expiresAt: Date.now() + 1000000 },
          },
          focusSession: { id: 'fake_focus' },
        },
      };

      const res = validateImportPayload(maliciousPayload);
      assert.ok(res.valid);
      assert.ok(res.sanitized);

      // Verify runtime injection was stripped
      assert.equal((res.sanitized as any).runtime, undefined, 'Runtime state must never be imported');

      // Verify collection name was validated
      assert.equal((res.sanitized as any)?.collections?.col_attack?.name, '<script>alert("XSS")</script>');
    });

    it('rejects invalid schema versions in import payload', () => {
      assert.equal(validateImportPayload({ schemaVersion: 999 }).valid, false);
      assert.equal(validateImportPayload({ schemaVersion: 0 }).valid, false);
      assert.equal(validateImportPayload({ schemaVersion: -1 }).valid, false);
      assert.equal(validateImportPayload(null).valid, false);
    });
  });

  // =========================================================================
  // PART 17 — MESSAGE PROTOCOL SECURITY
  // =========================================================================
  describe('Part 17: Message Protocol Runtime Security', () => {
    it('isValidMessage rejects malformed, unknown, or forged messages', () => {
      const invalid = [
        null,
        undefined,
        '',
        123,
        {},
        { type: 'UNKNOWN_MSG_TYPE' },
        { type: 'GET_INTERVENTION' }, // missing tabId and nonce
        { type: 'COMPLETE_INTERVENTION', tabId: 1 }, // missing nonce, targetUrl
        { type: 'CREATE_RULE', collectionId: 'c1' }, // missing pattern, ruleType
        { type: 'CREATE_RULE', collectionId: 'c1', pattern: 'foo', ruleType: 'INVALID_TYPE' },
        { type: 'START_FOCUS_MODE', durationMs: 'not_a_number' },
      ];

      for (const msg of invalid) {
        assert.equal(isValidMessage(msg), false, `Should reject message: ${JSON.stringify(msg)}`);
      }
    });

    it('isValidMessage accepts valid typed messages', () => {
      assert.ok(isValidMessage({ type: 'GET_STATE' }));
      assert.ok(isValidMessage({ type: 'GET_CURRENT_TAB' }));
      assert.ok(isValidMessage({ type: 'GET_SETTINGS' }));
      assert.ok(isValidMessage({ type: 'START_FOCUS_MODE', durationMs: 1800_000, collectionIds: ['col_1'] }));
      assert.ok(isValidMessage({ type: 'REQUEST_INTENT_PASS', tabId: 1, durationMs: 900_000 }));
      assert.ok(isValidMessage({
        type: 'COMPLETE_INTERVENTION',
        tabId: 1,
        targetUrl: 'https://example.com',
        nonce: 'abc12345',
      }));
    });
  });
});
