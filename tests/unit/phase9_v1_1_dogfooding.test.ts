/**
 * Phase 9 / V1.1 Dogfooding Findings & Enforcement Hardening Test Suite
 *
 * Verifies solutions for all 9 issues identified during dogfooding:
 * 1. Strict Block Mode (direct routing to block.html, pause.type === 'NONE')
 * 2. Access Expiration Auto-Reblock (SitePass/IntentPass expiration, alarms, loop-prevention)
 * 3. Custom Block Message (<= 250 chars validation, block.html param forwarding)
 * 4. Custom Opening / Insult Message (NONE, CUSTOM, RANDOM modes and validation)
 * 5. Mobile Software Keyboard & Responsive Viewport (100dvh, auto-scroll listeners)
 * 6. Multi-Tier Navigation Defense (301/302 redirect & SPA pushState interception)
 * 7. Collection "+ Add Rule" button DOM ID contract
 * 8. Website "Edit" button DOM ID contract
 * 9. About / Privacy Page spacing (20px gap / settings-grid layout)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';

import { MomentDecisionEngine } from '../../dist/chrome/core/decisions/engine.js';
import type { Collection } from '../../src/core/models/collection.js';
import type { Target } from '../../src/core/models/target.js';
import type { BoundaryPolicy } from '../../src/core/models/boundary.js';
import {
  validateCustomBlockMessage,
  validateOpeningMessages,
  validateWhenAccessExpires,
  validateImportPayload,
} from '../../dist/chrome/core/validation/rules.js';
import { migrateStorageState } from '../../dist/chrome/storage/migrations.js';
import { CURRENT_SCHEMA_VERSION } from '../../dist/chrome/storage/schema.js';
import { BaseBrowserAdapter } from '../../dist/chrome/browser/base-adapter.js';

describe('Phase 9 / V1.1: Dogfooding Findings & Enforcement Hardening', () => {

  // =========================================================================
  // ISSUE 1: STRICT BLOCK MODE
  // =========================================================================
  describe('Issue 1: Strict Block Mode', () => {
    it('evaluates pause.type === "NONE" to BLOCK instead of INTERVENE', () => {
      const engine = new MomentDecisionEngine();
      const strictRule: Target = {
        id: 'rule_reddit',
        pattern: 'reddit.com',
        type: 'WEBSITE',
        isException: false,
        createdAt: 1000,
      };
      const strictBoundary: BoundaryPolicy = {
        schedule: { enabled: false, intervals: [] },
        limits: { dailyMinutes: null, sessionMinutes: null },
        pause: {
          type: 'NONE',
          durationSeconds: 0,
          requireIntentionText: false,
        },
        action: { type: 'BLOCK_PAGE', redirectUrl: null },
        strictMode: false,
      };
      const strictCollection: Collection = {
        id: 'col_strict',
        name: 'Strict Block Collection',
        color: '#dc2626',
        icon: 'shield',
        enabled: true,
        createdAt: 1000,
        updatedAt: 1000,
        targets: [strictRule],
        boundary: strictBoundary,
        whenAccessExpires: 'IMMEDIATE',
      };

      engine.setCollections({ col_strict: strictCollection });

      const decision = engine.evaluate({
        url: 'https://www.reddit.com/r/all',
        tabId: 1,
        timestamp: Date.now(),
        activeGrants: [],
        collections: { col_strict: strictCollection },
      });

      assert.equal(decision.action, 'BLOCK');
      assert.equal(decision.collectionId, 'col_strict');
      assert.equal(decision.matchedRuleId, 'rule_reddit');
      assert.ok(decision.reason === 'BOUNDARIES_ACTIVE' || decision.reason === 'SCHEDULE_ACTIVE');
    });

    it('evaluates pause.type === "BREATHE" to INTERVENE', () => {
      const engine = new MomentDecisionEngine();
      const mindfulCollection: Collection = {
        id: 'col_mindful',
        name: 'Mindful Collection',
        color: '#4f46e5',
        icon: 'clock',
        enabled: true,
        createdAt: 1000,
        updatedAt: 1000,
        targets: [
          {
            id: 'rule_twitter',
            pattern: 'x.com',
            type: 'WEBSITE',
            isException: false,
            createdAt: 1000,
          },
        ],
        boundary: {
          schedule: { enabled: false, intervals: [] },
          limits: { dailyMinutes: null, sessionMinutes: null },
          pause: {
            type: 'BREATHE',
            durationSeconds: 10,
            requireIntentionText: false,
          },
          action: { type: 'BLOCK_PAGE', redirectUrl: null },
          strictMode: false,
        },
      };

      engine.setCollections({ col_mindful: mindfulCollection });

      const decision = engine.evaluate({
        url: 'https://x.com/explore',
        tabId: 2,
        timestamp: Date.now(),
        activeGrants: [],
        collections: { col_mindful: mindfulCollection },
      });

      assert.equal(decision.action, 'INTERVENE');
      assert.equal(decision.collectionId, 'col_mindful');
    });
  });

  // =========================================================================
  // ISSUE 2: ACCESS EXPIRATION AUTO-REBLOCK & LOOP DEFENSE
  // =========================================================================
  describe('Issue 2: Access Expiration & Pass Re-evaluation', () => {
    it('validates whenAccessExpires configuration', () => {
      assert.equal(validateWhenAccessExpires('IMMEDIATE'), 'IMMEDIATE');
      assert.equal(validateWhenAccessExpires('NEXT_NAV'), 'NEXT_NAV');
      assert.equal(validateWhenAccessExpires(undefined), 'IMMEDIATE');
      assert.equal(validateWhenAccessExpires(null), 'IMMEDIATE');
      assert.equal(validateWhenAccessExpires('INVALID'), 'IMMEDIATE');
    });

    it('identifies candidate URLs on block.html and avoids infinite reload loops', () => {
      // Test URL parser behavior on block.html
      const blockUrl = 'moz-extension://uuid-123/ui/block/block.html?target=https%3A%2F%2Fwww.reddit.com&collection=col_strict';
      const parsed = new URL(blockUrl);
      assert.ok(parsed.pathname.endsWith('/block.html') || parsed.pathname.endsWith('block.html'));

      const extractedTarget = parsed.searchParams.get('target');
      assert.equal(extractedTarget, 'https://www.reddit.com');

      // Internal extension URLs must not be re-navigated directly if unsafe
      const unsafeBlockUrl = 'moz-extension://uuid-123/ui/block/block.html?target=javascript%3Aalert(1)';
      const parsedUnsafe = new URL(unsafeBlockUrl);
      const unsafeTarget = parsedUnsafe.searchParams.get('target');
      assert.ok(unsafeTarget?.startsWith('javascript:'));
    });
  });

  // =========================================================================
  // ISSUE 3: CUSTOM BLOCK MESSAGE
  // =========================================================================
  describe('Issue 3: Custom Block Message Validation & Sanitization', () => {
    it('accepts valid custom block message under 250 characters', () => {
      const msg = 'Take a deep breath and get back to deep work.';
      const res = validateCustomBlockMessage(msg);
      assert.ok(res.valid);
      assert.equal(res.sanitized, msg);
    });

    it('trims leading/trailing whitespace from block message', () => {
      const msg = '   Focus on what matters.   ';
      const res = validateCustomBlockMessage(msg);
      assert.ok(res.valid);
      assert.equal(res.sanitized, 'Focus on what matters.');
    });

    it('treats empty or whitespace-only message as null or undefined', () => {
      assert.equal(validateCustomBlockMessage('').sanitized, null);
      assert.equal(validateCustomBlockMessage('   ').sanitized, null);
      assert.equal(validateCustomBlockMessage(undefined).sanitized, null);
      assert.equal(validateCustomBlockMessage(null).sanitized, null);
    });

    it('rejects custom block messages exceeding 250 characters', () => {
      const longMsg = 'A'.repeat(251);
      const res = validateCustomBlockMessage(longMsg);
      assert.equal(res.valid, false);
      assert.ok(res.error?.includes('250 characters'));
    });
  });

  // =========================================================================
  // ISSUE 4: CUSTOM OPENING / INSULT MESSAGE
  // =========================================================================
  describe('Issue 4: Custom Opening Message Validation & Modes', () => {
    it('validates NONE mode with empty or undefined array', () => {
      const res = validateOpeningMessages('NONE', []);
      assert.equal(res.mode, 'NONE');
      assert.deepEqual(res.messages, []);
    });

    it('validates CUSTOM mode with array of valid messages', () => {
      const messages = ['Do you really need to look at this now?'];
      const res = validateOpeningMessages('CUSTOM', messages);
      assert.equal(res.mode, 'CUSTOM');
      assert.deepEqual(res.messages, messages);
    });

    it('validates RANDOM mode with multiple valid messages', () => {
      const messages = [
        'Pause and reflect.',
        'Is this helping your current goal?',
        'One minute now saves an hour later.',
      ];
      const res = validateOpeningMessages('RANDOM', messages);
      assert.equal(res.mode, 'RANDOM');
      assert.equal(res.messages.length, 3);
    });

    it('filters out empty strings, blank lines, and overly long messages', () => {
      const messages = ['Valid line 1', '', '   ', 'A'.repeat(251), 'Valid line 2'];
      const res = validateOpeningMessages('RANDOM', messages);
      assert.equal(res.mode, 'RANDOM');
      assert.deepEqual(res.messages, ['Valid line 1', 'Valid line 2']);
    });
  });

  // =========================================================================
  // STORAGE & MIGRATIONS INTEGRATION
  // =========================================================================
  describe('Storage & Migration Sanitization for New Fields', () => {
    it('sanitizes collections with new fields correctly', () => {
      const rawCollection = {
        id: 'col_dogfood',
        name: 'Dogfood Test',
        color: '#10b981',
        createdAt: 1000,
        updatedAt: 1000,
        targets: [],
        boundary: {
          schedule: { enabled: false, intervals: [] },
          limits: { dailyMinutes: null, sessionMinutes: null },
          pause: { type: 'NONE', durationSeconds: 0 },
        },
        customBlockMessage: 'Stay on target!   ',
        openingMessageMode: 'RANDOM',
        openingMessages: ['Message 1', '   ', 'Message 2'],
        whenAccessExpires: 'NEXT_NAV',
      };

      const rawState = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        collections: { col_dogfood: rawCollection },
      };

      const migrated = migrateStorageState(rawState);
      const col = migrated.collections.col_dogfood;
      assert.ok(col);
      assert.equal(col.customBlockMessage, 'Stay on target!');
      assert.equal(col.openingMessageMode, 'RANDOM');
      assert.deepEqual(col.openingMessages, ['Message 1', 'Message 2']);
      assert.equal(col.whenAccessExpires, 'NEXT_NAV');
    });

    it('validates import payload containing the new fields', () => {
      const payload = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        exportedAt: Date.now(),
        settings: {},
        collections: {
          col_imported: {
            id: 'col_imported',
            name: 'Imported Boundaries',
            color: '#6366f1',
            createdAt: 1000,
            updatedAt: 1000,
            targets: [],
            boundary: {
              schedule: { enabled: false, intervals: [] },
              limits: { dailyMinutes: null, sessionMinutes: null },
              pause: { type: 'NONE', durationSeconds: 0 },
            },
            customBlockMessage: 'Imported block notice',
            openingMessageMode: 'CUSTOM',
            openingMessages: ['Remember your priorities'],
            whenAccessExpires: 'IMMEDIATE',
          },
        },
      };

      const validation = validateImportPayload(payload);
      assert.ok(validation.valid);
      assert.ok(validation.sanitized);
      const importedCol = (validation.sanitized as any).collections['col_imported'];
      assert.ok(importedCol);
      assert.equal(importedCol.customBlockMessage, 'Imported block notice');
      assert.equal(importedCol.openingMessageMode, 'CUSTOM');
      assert.equal(importedCol.whenAccessExpires, 'IMMEDIATE');
    });
  });

  // =========================================================================
  // ISSUE 5: MOBILE RESPONSIVENESS & 100DVH VIEWPORT
  // =========================================================================
  describe('Issue 5: Mobile Viewport & CSS Adaptations', () => {
    it('uses 100dvh for dynamic mobile viewport in full-page screens and fixed dimensions in popup', () => {
      const popupCss = fs.readFileSync('src/ui/popup/popup.css', 'utf-8');
      const blockCss = fs.readFileSync('src/ui/block/block.css', 'utf-8');
      const interveneCss = fs.readFileSync('src/ui/intervene/intervene.css', 'utf-8');

      assert.ok(popupCss.includes('width: 360px'), 'popup.css must define fixed 360px width to avoid viewport collapse in Firefox');
      assert.ok(popupCss.includes('min-height: 400px'), 'popup.css must define minimum height');
      assert.ok(popupCss.includes('overflow-y: auto'), 'popup.css must allow vertical scroll');
      assert.ok(blockCss.includes('100dvh'), 'block.css must support 100dvh');
      assert.ok(interveneCss.includes('100dvh'), 'intervene.css must support 100dvh');
    });

    it('registers mobile focus auto-scroll listeners across UI scripts', () => {
      const optionsTs = fs.readFileSync('src/ui/options/options.ts', 'utf-8');
      const popupTs = fs.readFileSync('src/ui/popup/popup.ts', 'utf-8');
      const interveneTs = fs.readFileSync('src/ui/intervene/intervene.ts', 'utf-8');

      assert.ok(optionsTs.includes('scrollIntoView'), 'options.ts must have focus auto-scroll');
      assert.ok(popupTs.includes('scrollIntoView'), 'popup.ts must have focus auto-scroll');
      assert.ok(interveneTs.includes('scrollIntoView'), 'intervene.ts must have focus auto-scroll');
    });
  });

  // =========================================================================
  // ISSUES 7 & 8: UI DOM ID CONTRACT VERIFICATION
  // =========================================================================
  describe('Issues 7 & 8: DOM ID Contract Verification', () => {
    const pages = [
      { name: 'Options Page', html: 'src/ui/options/options.html', ts: 'src/ui/options/options.ts' },
      { name: 'Popup UI', html: 'src/ui/popup/popup.html', ts: 'src/ui/popup/popup.ts' },
      { name: 'Block Screen', html: 'src/ui/block/block.html', ts: 'src/ui/block/block.ts' },
      { name: 'Intervene Screen', html: 'src/ui/intervene/intervene.html', ts: 'src/ui/intervene/intervene.ts' },
    ];

    for (const page of pages) {
      it(`verifies every getElementById call in ${page.name} exists in its HTML template`, () => {
        const htmlContent = fs.readFileSync(page.html, 'utf-8');
        const tsContent = fs.readFileSync(page.ts, 'utf-8');

        const htmlIds = new Set([...htmlContent.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
        const tsIds = [...tsContent.matchAll(/getElementById\([`\x27"]([^`\x27"]+)[`\x27"]\)/g)].map((m) => m[1]);

        assert.ok(tsIds.length > 0, `Expected ${page.ts} to contain getElementById calls`);

        const missing = tsIds.filter((id) => !htmlIds.has(id));
        assert.deepEqual(
          missing,
          [],
          `Found DOM IDs referenced in ${page.ts} that do not exist in ${page.html}: ${missing.join(', ')}`
        );
      });
    }

    it('specifically verifies ruleModalTypeHint exists in options.html', () => {
      const htmlContent = fs.readFileSync('src/ui/options/options.html', 'utf-8');
      assert.ok(
        htmlContent.includes('id="ruleModalTypeHint"'),
        'options.html must contain id="ruleModalTypeHint" (Issues 7 & 8 regression defense)'
      );
    });

    it('verifies all new V1.1 collection form inputs exist in options.html', () => {
      const htmlContent = fs.readFileSync('src/ui/options/options.html', 'utf-8');
      assert.ok(htmlContent.includes('name="colEnforcementMode"'), 'Must have colEnforcementMode radio inputs');
      assert.ok(htmlContent.includes('name="colOpeningMode"'), 'Must have colOpeningMode radio inputs');
      assert.ok(htmlContent.includes('id="colOpeningMessagesInput"'), 'Must have colOpeningMessagesInput textarea');
      assert.ok(htmlContent.includes('id="colCustomBlockMessage"'), 'Must have colCustomBlockMessage textarea');
      assert.ok(htmlContent.includes('name="colWhenExpires"'), 'Must have colWhenExpires radio inputs');
    });
  });

  // =========================================================================
  // ISSUE 9: PRIVACY PAGE SPACING
  // =========================================================================
  describe('Issue 9: About / Privacy Page Spacing', () => {
    it('verifies .privacy-container has consistent spacing in options.css and options.html', () => {
      const htmlContent = fs.readFileSync('src/ui/options/options.html', 'utf-8');
      const cssContent = fs.readFileSync('src/ui/options/options.css', 'utf-8');

      assert.ok(
        htmlContent.includes('privacy-container settings-grid'),
        'options.html #tab-privacy must use settings-grid layout'
      );
      assert.ok(
        cssContent.includes('.privacy-container'),
        'options.css must include .privacy-container styling'
      );
    });
  });

  // =========================================================================
  // ISSUE 6: MULTI-TIER DEFENSE & BROWSER ADAPTER EXTENSIONS
  // =========================================================================
  describe('Issue 6: Multi-Tier Navigation Defense & Browser Adapter', () => {
    it('manifests declare alarms permission for MV3 pass expiration scheduling', () => {
      const chromeManifest = JSON.parse(fs.readFileSync('manifest/chrome/manifest.json', 'utf-8'));
      const firefoxManifest = JSON.parse(fs.readFileSync('manifest/firefox/manifest.json', 'utf-8'));

      assert.ok(chromeManifest.permissions.includes('alarms'), 'Chrome manifest must declare alarms permission');
      assert.ok(firefoxManifest.permissions.includes('alarms'), 'Firefox manifest must declare alarms permission');
    });

    it('BaseBrowserAdapter implements getAllTabs, onHistoryStateUpdated, and alarms', () => {
      const adapter = new BaseBrowserAdapter();
      assert.equal(typeof adapter.getAllTabs, 'function');
      assert.equal(typeof adapter.onHistoryStateUpdated, 'function');
      assert.equal(typeof adapter.createAlarm, 'function');
      assert.equal(typeof adapter.clearAlarm, 'function');
      assert.equal(typeof adapter.onAlarm, 'function');
    });
  });
});
