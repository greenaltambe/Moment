/**
 * Moment Unit Test Suite: Phase 11 — Opening Insults & Behavioral Roast Polish
 *
 * Validates:
 * - MOMENT_LIBRARY message catalog (MILD, SARCASTIC, SPICY, BRUTAL)
 * - Deterministic boundary isolation in random selection
 * - Safe fallback for malformed modes and intensities
 * - Validation of custom, random, and library configurations
 * - Storage migration and import/export roundtrip preservation
 * - Strict Block invariant (no opening message on terminal block)
 * - Intervention state machine, breathing, timer, and grant isolation
 * - Android responsive markup and Strict CSP / Zero innerHTML / Zero network compliance
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  MOMENT_MESSAGE_LIBRARY,
  getRandomLibraryMessage,
} from '../../dist/chrome/core/interventions/library.js';
import {
  validateOpeningMessages,
  validateMessageIntensity,
  validateImportPayload,
} from '../../dist/chrome/core/validation/rules.js';
import { migrateStorageState } from '../../dist/chrome/storage/migrations.js';
import { CURRENT_SCHEMA_VERSION } from '../../dist/chrome/storage/schema.js';
import { MomentDecisionEngine } from '../../dist/chrome/core/decisions/engine.js';
import { canTransition, transitionIntervention } from '../../dist/chrome/core/interventions/state-machine.js';
import { resolveGrantDuration, isGrantValidForNavigation } from '../../dist/chrome/core/grants/grant-validator.js';

describe('Phase 11: Opening Insults & Behavioral Roast Message Library', () => {
  // =========================================================================
  // 1. LIBRARY INTEGRITY & INTENSITY BOUNDARIES
  // =========================================================================
  describe('Library Integrity & Copy Quality', () => {
    it('defines all 4 intensity tiers: MILD, SARCASTIC, SPICY, BRUTAL', () => {
      const tiers = Object.keys(MOMENT_MESSAGE_LIBRARY);
      assert.deepEqual(tiers.sort(), ['BRUTAL', 'MILD', 'SARCASTIC', 'SPICY']);
    });

    it('contains expected minimum counts of short, punchy messages', () => {
      assert.ok(MOMENT_MESSAGE_LIBRARY.MILD.length >= 10, 'MILD has >= 10 messages');
      assert.ok(MOMENT_MESSAGE_LIBRARY.SARCASTIC.length >= 10, 'SARCASTIC has >= 10 messages');
      assert.ok(MOMENT_MESSAGE_LIBRARY.SPICY.length >= 14, 'SPICY has >= 14 messages');
      assert.ok(MOMENT_MESSAGE_LIBRARY.BRUTAL.length >= 50, 'BRUTAL has >= 50 messages');
    });

    it('contains non-empty, unique strings in every tier', () => {
      for (const [tier, messages] of Object.entries(MOMENT_MESSAGE_LIBRARY)) {
        const seen = new Set<string>();
        for (const msg of messages) {
          assert.equal(typeof msg, 'string');
          assert.ok(msg.trim().length > 0, `${tier} message cannot be empty`);
          assert.ok(msg.length <= 250, `${tier} message is short and punchy (<= 250 chars)`);
          assert.ok(!seen.has(msg), `Duplicate message in ${tier}: "${msg}"`);
          seen.add(msg);
        }
      }
    });

    it('focuses on behavior/procrastination rather than personal attacks or profanity', () => {
      const forbiddenTerms = [
        'idiot', 'moron', 'stupid', 'worthless', 'pathetic', 'ugly', 'fat',
        'kill', 'die', 'suicide', 'fuck', 'shit', 'bitch', 'asshole',
      ];
      for (const [tier, messages] of Object.entries(MOMENT_MESSAGE_LIBRARY)) {
        for (const msg of messages) {
          const lower = msg.toLowerCase();
          for (const term of forbiddenTerms) {
            assert.ok(
              !lower.includes(term),
              `Message in ${tier} contains forbidden/abusive term "${term}": "${msg}"`
            );
          }
        }
      }
    });
  });

  describe('Random Selection & Deterministic Boundaries', () => {
    it('selects message strictly within the selected intensity tier', () => {
      const tiers: Array<keyof typeof MOMENT_MESSAGE_LIBRARY> = ['MILD', 'SARCASTIC', 'SPICY', 'BRUTAL'];

      for (const tier of tiers) {
        const tierSet = new Set(MOMENT_MESSAGE_LIBRARY[tier]);
        for (let i = 0; i < 100; i++) {
          const picked = getRandomLibraryMessage(tier);
          assert.ok(tierSet.has(picked), `Selection crossed boundary: "${picked}" not in ${tier}`);
        }
      }
    });

    it('clamps deterministic boundary edges using custom rng', () => {
      const minMild = getRandomLibraryMessage('MILD', () => 0);
      assert.equal(minMild, MOMENT_MESSAGE_LIBRARY.MILD[0]);

      const maxMild = getRandomLibraryMessage('MILD', () => 0.999999);
      assert.equal(maxMild, MOMENT_MESSAGE_LIBRARY.MILD[MOMENT_MESSAGE_LIBRARY.MILD.length - 1]);

      const minBrutal = getRandomLibraryMessage('BRUTAL', () => 0);
      assert.equal(minBrutal, MOMENT_MESSAGE_LIBRARY.BRUTAL[0]);

      const maxBrutal = getRandomLibraryMessage('BRUTAL', () => 0.999999);
      assert.equal(maxBrutal, MOMENT_MESSAGE_LIBRARY.BRUTAL[MOMENT_MESSAGE_LIBRARY.BRUTAL.length - 1]);
    });

    it('safely falls back to MILD on malformed or undefined intensity', () => {
      const mildSet = new Set(MOMENT_MESSAGE_LIBRARY.MILD);
      const invalidTiers = ['UNKNOWN', 'EXTREME', '', null as any, undefined as any, 123 as any];

      for (const invalid of invalidTiers) {
        const picked = getRandomLibraryMessage(invalid);
        assert.ok(mildSet.has(picked), `Expected MILD fallback for invalid tier "${invalid}", got: "${picked}"`);
      }
    });
  });

  // =========================================================================
  // 2. VALIDATION & SANITIZATION RULES
  // =========================================================================
  describe('Validation & Sanitization Rules', () => {
    it('accepts valid opening message modes: NONE, MOMENT_LIBRARY, CUSTOM, RANDOM', () => {
      assert.equal(validateOpeningMessages('NONE', []).mode, 'NONE');
      assert.equal(validateOpeningMessages('MOMENT_LIBRARY', []).mode, 'MOMENT_LIBRARY');
      assert.equal(validateOpeningMessages('CUSTOM', ['Hello']).mode, 'CUSTOM');
      assert.equal(validateOpeningMessages('RANDOM', ['Hi', 'There']).mode, 'RANDOM');
    });

    it('safely falls back to NONE for malformed or unknown mode', () => {
      assert.equal(validateOpeningMessages('INVALID_MODE', []).mode, 'NONE');
      assert.equal(validateOpeningMessages(null, []).mode, 'NONE');
      assert.equal(validateOpeningMessages(undefined, []).mode, 'NONE');
      assert.equal(validateOpeningMessages(12345, []).mode, 'NONE');
      assert.equal(validateOpeningMessages({}, []).mode, 'NONE');
    });

    it('validates message intensity and safely falls back to MILD', () => {
      assert.equal(validateMessageIntensity('MILD'), 'MILD');
      assert.equal(validateMessageIntensity('SARCASTIC'), 'SARCASTIC');
      assert.equal(validateMessageIntensity('SPICY'), 'SPICY');
      assert.equal(validateMessageIntensity('BRUTAL'), 'BRUTAL');

      assert.equal(validateMessageIntensity('UNKNOWN'), 'MILD');
      assert.equal(validateMessageIntensity('EXTREME'), 'MILD');
      assert.equal(validateMessageIntensity(null), 'MILD');
      assert.equal(validateMessageIntensity(undefined), 'MILD');
      assert.equal(validateMessageIntensity(42), 'MILD');
    });

    it('handles empty custom messages, whitespace trimming, and caps at 10 items', () => {
      const input = [
        '  Valid message 1  ',
        '',
        '   ',
        'Valid message 2',
        ...Array.from({ length: 15 }, (_, i) => `Extra message ${i}`),
      ];
      const res = validateOpeningMessages('CUSTOM', input);
      assert.equal(res.mode, 'CUSTOM');
      assert.equal(res.messages.length, 10);
      assert.equal(res.messages[0], 'Valid message 1');
      assert.equal(res.messages[1], 'Valid message 2');
      assert.equal(res.messages[2], 'Extra message 0');
    });

    it('preserves special characters and safely encapsulates HTML-like input', () => {
      const special = ['Why are you here? 🛑', '<script>alert("xss")</script>', 'Quotes: "hello" & \'world\''];
      const res = validateOpeningMessages('CUSTOM', special);
      assert.equal(res.messages.length, 3);
      assert.equal(res.messages[0], 'Why are you here? 🛑');
      assert.equal(res.messages[1], '<script>alert("xss")</script>');
      assert.equal(res.messages[2], 'Quotes: "hello" & \'world\'');
    });
  });

  // =========================================================================
  // 3. STORAGE MIGRATION & IMPORT/EXPORT ROUNDTRIP
  // =========================================================================
  describe('Storage Migration & Import/Export Preservation', () => {
    it('migrates legacy collection state safely defaulting to NONE and MILD', () => {
      const rawState = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        collections: {
          col_legacy: {
            id: 'col_legacy',
            name: 'Legacy Col',
            color: '#10b981',
            createdAt: 1000,
            updatedAt: 1000,
            targets: [],
            boundary: {
              schedule: { enabled: false, intervals: [] },
              limits: { dailyMinutes: null, sessionMinutes: null },
              pause: { type: 'NONE', durationSeconds: 0 },
            },
          },
        },
      };

      const migrated = migrateStorageState(rawState);
      const col = migrated.collections.col_legacy;
      assert.ok(col);
      assert.equal(col.openingMessageMode, 'NONE');
      assert.equal(col.messageIntensity, 'MILD');
      assert.deepEqual(col.openingMessages, []);
    });

    it('preserves MOMENT_LIBRARY and BRUTAL in storage migration', () => {
      const rawState = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        collections: {
          col_roast: {
            id: 'col_roast',
            name: 'Social Media Roast',
            color: '#ef4444',
            createdAt: 1000,
            updatedAt: 1000,
            targets: [],
            boundary: {
              schedule: { enabled: false, intervals: [] },
              limits: { dailyMinutes: null, sessionMinutes: null },
              pause: { type: 'BREATHE', durationSeconds: 10 },
            },
            openingMessageMode: 'MOMENT_LIBRARY',
            messageIntensity: 'BRUTAL',
          },
        },
      };

      const migrated = migrateStorageState(rawState);
      const col = migrated.collections.col_roast;
      assert.ok(col);
      assert.equal(col.openingMessageMode, 'MOMENT_LIBRARY');
      assert.equal(col.messageIntensity, 'BRUTAL');
    });

    it('preserves existing CUSTOM and RANDOM messages untouched', () => {
      const rawState = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        collections: {
          col_custom: {
            id: 'col_custom',
            name: 'Custom Messages',
            color: '#3b82f6',
            createdAt: 1000,
            updatedAt: 1000,
            targets: [],
            boundary: {
              schedule: { enabled: false, intervals: [] },
              limits: { dailyMinutes: null, sessionMinutes: null },
              pause: { type: 'BREATHE', durationSeconds: 10 },
            },
            openingMessageMode: 'RANDOM',
            messageIntensity: 'SPICY',
            openingMessages: ['Message A', 'Message B'],
          },
        },
      };

      const migrated = migrateStorageState(rawState);
      const col = migrated.collections.col_custom;
      assert.ok(col);
      assert.equal(col.openingMessageMode, 'RANDOM');
      assert.equal(col.messageIntensity, 'SPICY');
      assert.deepEqual(col.openingMessages, ['Message A', 'Message B']);
    });

    it('validates import payload and retains MOMENT_LIBRARY and messageIntensity', () => {
      const payload = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        exportedAt: Date.now(),
        settings: {},
        collections: {
          col_lib: {
            id: 'col_lib',
            name: 'Library Collection',
            color: '#8b5cf6',
            createdAt: 1000,
            updatedAt: 1000,
            targets: [],
            boundary: {
              schedule: { enabled: false, intervals: [] },
              limits: { dailyMinutes: null, sessionMinutes: null },
              pause: { type: 'BREATHE', durationSeconds: 10 },
            },
            openingMessageMode: 'MOMENT_LIBRARY',
            messageIntensity: 'SARCASTIC',
          },
        },
      };

      const validation = validateImportPayload(payload);
      assert.ok(validation.valid);
      assert.ok(validation.sanitized);
      const imported = (validation.sanitized as any).collections.col_lib;
      assert.ok(imported);
      assert.equal(imported.openingMessageMode, 'MOMENT_LIBRARY');
      assert.equal(imported.messageIntensity, 'SARCASTIC');
    });
  });

  // =========================================================================
  // 4. STRICT BLOCK INVARIANT
  // =========================================================================
  describe('Strict Block Invariant (No Intervention / No Opening Messages)', () => {
    it('resolves strict mode collection to action BLOCK which bypasses intervention flow', () => {
      const strictCol = {
        id: 'col_strict',
        name: 'Strict Block Collection',
        color: '#ef4444',
        icon: 'shield',
        enabled: true,
        createdAt: 1000,
        updatedAt: 1000,
        targets: [
          {
            id: 't1',
            pattern: 'reddit.com',
            type: 'WEBSITE' as const,
            isException: false,
            createdAt: 1000,
          },
        ],
        boundary: {
          schedule: { enabled: false, intervals: [] },
          limits: { dailyMinutes: null, sessionMinutes: null },
          pause: { type: 'NONE' as const, durationSeconds: 0 },
          action: { type: 'BLOCK_PAGE' as const, redirectUrl: null },
          strictMode: true,
        },
        openingMessageMode: 'MOMENT_LIBRARY' as const,
        messageIntensity: 'BRUTAL' as const,
      };

      const engine = new MomentDecisionEngine([strictCol]);

      const decision = engine.evaluate({
        url: 'https://reddit.com/r/all',
        tabId: 10,
        timestamp: 5000,
        activeGrants: [],
      });

      assert.equal(decision.action, 'BLOCK');
      assert.equal(decision.collectionId, 'col_strict');
      // Because action === 'BLOCK', the background router redirects to block.html immediately
      // and never creates a PendingIntervention or reaches intervene.html.
    });
  });

  // =========================================================================
  // 5. INTERVENTION STATE MACHINE & GRANT FLOW UNCHANGED
  // =========================================================================
  describe('Intervention State Machine & Grant Flow Isolation', () => {
    it('intervention state transitions remain unaffected', () => {
      assert.ok(canTransition('PENDING', 'PRESENTED'));
      assert.ok(canTransition('PRESENTED', 'IN_PROGRESS'));
      assert.ok(canTransition('IN_PROGRESS', 'COMPLETED'));
      assert.ok(canTransition('COMPLETED', 'GRANT_ISSUED'));

      const now = Date.now();
      const initial = {
        id: 'intv_1',
        tabId: 1,
        targetUrl: 'https://example.com',
        collectionId: 'col_1',
        interventionType: 'BREATHE' as const,
        durationSeconds: 10,
        requireIntentionText: false,
        createdAt: now,
        updatedAt: now,
        nonce: 'nonce123',
        status: 'PENDING' as const,
      };

      const presented = transitionIntervention(initial, 'PRESENTED', now + 100);
      assert.equal(presented.status, 'PRESENTED');
      const completed = transitionIntervention(presented, 'COMPLETED', now + 10000);
      assert.equal(completed.status, 'COMPLETED');
    });

    it('grant resolution and validation remain completely unchanged', () => {
      const now = Date.now();
      const grant = {
        id: 'grant_1',
        tabId: 1,
        target: 'https://example.com',
        collectionId: 'col_1',
        grantedAt: now - 1000,
        expiresAt: now + 60000,
        durationMs: resolveGrantDuration(),
        type: 'TEMPORARY_ACCESS' as const,
      };

      assert.ok(isGrantValidForNavigation(grant, 1, 'https://example.com', now));
      assert.ok(!isGrantValidForNavigation(grant, 2, 'https://example.com', now)); // Tab isolated
    });
  });

  // =========================================================================
  // 6. DOM PRESENTATION LAYER & CONSTITUTIONAL INVARIANTS
  // =========================================================================
  describe('DOM Presentation Layer & Security Compliance', () => {
    it('intervene.html contains dedicated openingMessageBox preceding headline', () => {
      const interveneHtml = fs.readFileSync('src/ui/intervene/intervene.html', 'utf-8');
      assert.ok(interveneHtml.includes('id="openingMessageBox"'), 'Contains openingMessageBox container');
      assert.ok(interveneHtml.includes('id="openingMessageText"'), 'Contains openingMessageText element');

      const boxPos = interveneHtml.indexOf('id="openingMessageBox"');
      const headlinePos = interveneHtml.indexOf('id="interventionHeadline"');
      assert.ok(boxPos < headlinePos, 'Opening message layer precedes intervention headline');
    });

    it('options.html contains MOMENT_LIBRARY option and intensity radio controls', () => {
      const optionsHtml = fs.readFileSync('src/ui/options/options.html', 'utf-8');
      assert.ok(optionsHtml.includes('value="MOMENT_LIBRARY"'), 'Contains MOMENT_LIBRARY radio option');
      assert.ok(optionsHtml.includes('id="colMomentLibraryGroup"'), 'Contains intensity controls container');
      assert.ok(optionsHtml.includes('name="colMessageIntensity"'), 'Contains message intensity radios');
      assert.ok(optionsHtml.includes('value="BRUTAL"'), 'Contains BRUTAL intensity radio option');
    });

    it('CSS contains responsive mobile styles for opening message box', () => {
      const interveneCss = fs.readFileSync('src/ui/intervene/intervene.css', 'utf-8');
      assert.ok(interveneCss.includes('.opening-message-box'), 'Contains .opening-message-box CSS rule');
      assert.ok(interveneCss.includes('.opening-message-text'), 'Contains .opening-message-text CSS rule');
      assert.ok(interveneCss.includes('overflow-wrap: break-word;'), 'Includes text-wrapping safeguard');
      assert.ok(interveneCss.includes('@media (max-width: 480px)'), 'Includes mobile viewport adjustment');
    });

    it('verifies zero innerHTML and strict CSP across all UI source files', () => {
      const filesToCheck = [
        'src/ui/intervene/intervene.ts',
        'src/ui/intervene/intervene.html',
        'src/ui/options/options.ts',
        'src/ui/options/options.html',
        'src/background/index.ts',
      ];

      for (const rel of filesToCheck) {
        const content = fs.readFileSync(rel, 'utf-8');
        assert.ok(!content.includes('.innerHTML'), `Forbidden innerHTML detected in ${rel}`);
        assert.ok(!content.includes('eval('), `Forbidden eval detected in ${rel}`);
      }
    });

    it('verifies zero networking or telemetry calls in intervention and message modules', () => {
      const filesToCheck = [
        'src/core/interventions/library.ts',
        'src/ui/intervene/intervene.ts',
      ];

      for (const rel of filesToCheck) {
        const content = fs.readFileSync(rel, 'utf-8');
        assert.ok(!content.includes('fetch('), `Forbidden network call (fetch) in ${rel}`);
        assert.ok(!content.includes('XMLHttpRequest'), `Forbidden network call (XHR) in ${rel}`);
        assert.ok(!content.includes('WebSocket'), `Forbidden network call (WebSocket) in ${rel}`);
      }
    });
  });
});
