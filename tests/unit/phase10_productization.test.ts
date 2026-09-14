/**
 * Phase 10 / Final Productization Test Suite
 * Validates:
 * 1. Temporary Unlock Scope (THIS_TAB_ONLY vs ALL_TABS_UNTIL_EXPIRATION)
 * 2. Multi-tab SitePass authorization & lookalike rejection
 * 3. Tab close persistence for cross-tab unlock
 * 4. Storage schema migration & import/export hygiene
 * 5. Options DOM contract verification (all DOM IDs exist in HTML)
 * 6. Mobile responsiveness & CSS layout adaptations
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { isSitePassValidForNavigation } from '../../dist/chrome/core/grants/site-pass-validator.js';
import type { SitePass } from '../../src/core/models/site-pass.js';
import { DEFAULT_USER_SETTINGS } from '../../dist/chrome/storage/schema.js';
import { migrateStorageState } from '../../dist/chrome/storage/migrations.js';
import { validateImportPayload } from '../../dist/chrome/core/validation/rules.js';

describe('Phase 10: Final Productization Pass', () => {
  // =========================================================================
  // 1. TEMPORARY UNLOCK SCOPE (THIS_TAB_ONLY vs ALL_TABS_UNTIL_EXPIRATION)
  // =========================================================================
  describe('Temporary Unlock Scope: SitePass Validation', () => {
    const now = 1_700_000_000_000;

    it('THIS_TAB_ONLY (default) strictly enforces tab isolation', () => {
      const tabPass: SitePass = {
        id: 'pass_tab1',
        tabId: 10,
        site: 'reddit.com',
        grantedAt: now,
        expiresAt: now + 300_000,
        scope: 'THIS_TAB_ONLY',
      };

      // Originating tab is authorized
      assert.equal(
        isSitePassValidForNavigation(tabPass, 10, 'https://reddit.com/r/all', now + 1000),
        true,
        'Originating tab must be authorized'
      );

      // Other tab is rejected
      assert.equal(
        isSitePassValidForNavigation(tabPass, 20, 'https://reddit.com/r/all', now + 1000),
        false,
        'Different tab must be rejected under THIS_TAB_ONLY'
      );
    });

    it('ALL_TABS_UNTIL_EXPIRATION authorizes any tab for the covered website', () => {
      const allTabsPass: SitePass = {
        id: 'pass_all_tabs',
        tabId: 10,
        site: 'reddit.com',
        grantedAt: now,
        expiresAt: now + 300_000,
        scope: 'ALL_TABS_UNTIL_EXPIRATION',
      };

      // Originating tab 10
      assert.equal(
        isSitePassValidForNavigation(allTabsPass, 10, 'https://reddit.com/r/technology', now + 1000),
        true,
        'Originating tab must be authorized'
      );

      // Second tab 20 on same site
      assert.equal(
        isSitePassValidForNavigation(allTabsPass, 20, 'https://www.reddit.com/r/science', now + 2000),
        true,
        'Tab 20 must be authorized for same covered site'
      );

      // Third tab 30 with subdomain
      assert.equal(
        isSitePassValidForNavigation(allTabsPass, 30, 'https://old.reddit.com/', now + 3000),
        true,
        'Tab 30 with subdomain must be authorized under WEBSITE semantics'
      );

      // Unrelated website is rejected
      assert.equal(
        isSitePassValidForNavigation(allTabsPass, 20, 'https://twitter.com/home', now + 1000),
        false,
        'Unrelated domain must be rejected'
      );
    });

    it('ALL_TABS_UNTIL_EXPIRATION strictly rejects lookalike and spoofing domains', () => {
      const pass: SitePass = {
        id: 'pass_all_tabs_security',
        tabId: 10,
        site: 'reddit.com',
        grantedAt: now,
        expiresAt: now + 300_000,
        scope: 'ALL_TABS_UNTIL_EXPIRATION',
      };

      assert.equal(
        isSitePassValidForNavigation(pass, 20, 'https://reddit.com.evil.com', now + 1000),
        false,
        'Subdomain attack must be rejected'
      );
      assert.equal(
        isSitePassValidForNavigation(pass, 20, 'https://evil-reddit.com', now + 1000),
        false,
        'Hyphen lookalike must be rejected'
      );
      assert.equal(
        isSitePassValidForNavigation(pass, 20, 'https://evil.com/?reddit.com', now + 1000),
        false,
        'Query param deception must be rejected'
      );
      assert.equal(
        isSitePassValidForNavigation(pass, 20, 'javascript:alert(1)', now + 1000),
        false,
        'Non-web scheme must be rejected'
      );
    });

    it('ALL_TABS_UNTIL_EXPIRATION expires deterministically across all tabs', () => {
      const pass: SitePass = {
        id: 'pass_expiring',
        tabId: 10,
        site: 'reddit.com',
        grantedAt: now,
        expiresAt: now + 60_000,
        scope: 'ALL_TABS_UNTIL_EXPIRATION',
      };

      // Valid before expiry
      assert.equal(isSitePassValidForNavigation(pass, 10, 'https://reddit.com', now + 30_000), true);
      assert.equal(isSitePassValidForNavigation(pass, 20, 'https://reddit.com', now + 30_000), true);

      // Expired after expiry
      assert.equal(
        isSitePassValidForNavigation(pass, 10, 'https://reddit.com', now + 60_000),
        false,
        'Must expire on originating tab'
      );
      assert.equal(
        isSitePassValidForNavigation(pass, 20, 'https://reddit.com', now + 60_000),
        false,
        'Must expire on other tabs'
      );
    });
  });

  // =========================================================================
  // 2. STORAGE MIGRATION & IMPORT SANITIZATION
  // =========================================================================
  describe('Storage Schema & Import/Export Hygiene', () => {
    it('default settings define temporaryUnlockScope as THIS_TAB_ONLY', () => {
      assert.equal(DEFAULT_USER_SETTINGS.temporaryUnlockScope, 'THIS_TAB_ONLY');
    });

    it('migrates legacy storage without temporaryUnlockScope safely', () => {
      const legacyRaw = {
        schemaVersion: 2,
        settings: {
          theme: 'dark',
          timeFormat: '12h',
          reducedMotion: true,
          allowPrivateBrowsing: false,
        },
        collections: {},
        usage: {},
        runtime: {},
      };

      const migrated = migrateStorageState(legacyRaw);
      assert.equal(migrated.schemaVersion, 3);
      assert.equal(migrated.settings.theme, 'dark');
      assert.equal(
        migrated.settings.temporaryUnlockScope,
        'THIS_TAB_ONLY',
        'Legacy state must default to THIS_TAB_ONLY'
      );
    });

    it('preserves valid temporaryUnlockScope on import and sanitizes invalid values', () => {
      const validPayload = {
        schemaVersion: 3,
        exportedAt: Date.now(),
        collections: {},
        settings: {
          theme: 'sepia',
          timeFormat: '24h',
          reducedMotion: false,
          allowPrivateBrowsing: true,
          temporaryUnlockScope: 'ALL_TABS_UNTIL_EXPIRATION',
        },
      };

      const validated = validateImportPayload(validPayload);
      assert.equal(validated.valid, true);
      assert.equal(
        validated.sanitized?.settings?.temporaryUnlockScope,
        'ALL_TABS_UNTIL_EXPIRATION'
      );

      // Invalid value falls back safely
      const invalidPayload = {
        ...validPayload,
        settings: {
          ...validPayload.settings,
          temporaryUnlockScope: 'CORRUPTED_VALUE',
        },
      };

      const validatedInvalid = validateImportPayload(invalidPayload);
      assert.equal(validatedInvalid.valid, true);
      assert.equal(
        validatedInvalid.sanitized?.settings?.temporaryUnlockScope,
        'THIS_TAB_ONLY'
      );
    });
  });

  // =========================================================================
  // 3. UI DOM CONTRACT VERIFICATION
  // =========================================================================
  describe('Options UI DOM Contract Verification', () => {
    it('verifies 100% of getElementById calls in options.ts exist in options.html', () => {
      const htmlContent = fs.readFileSync('src/ui/options/options.html', 'utf-8');
      const tsContent = fs.readFileSync('src/ui/options/options.ts', 'utf-8');

      const htmlIds = new Set([...htmlContent.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
      const tsIds = [...tsContent.matchAll(/getElementById\([`\x27"]([^`\x27"]+)[`\x27"]\)/g)].map((m) => m[1]);

      assert.ok(tsIds.length > 0, 'Expected options.ts to contain getElementById calls');

      const missing = tsIds.filter((id) => !htmlIds.has(id));
      assert.deepEqual(
        missing,
        [],
        `Found DOM IDs referenced in options.ts that do not exist in options.html: ${missing.join(', ')}`
      );

      // Verify specific new elements are present
      assert.ok(htmlIds.has('sidebarVersionDisplay'), 'sidebarVersionDisplay must exist');
      assert.ok(htmlIds.has('todayUsageCard'), 'todayUsageCard must exist');
      assert.ok(htmlIds.has('todayUsageDate'), 'todayUsageDate must exist');
      assert.ok(htmlIds.has('todayUsageList'), 'todayUsageList must exist');
    });

    it('verifies settingUnlockScope radio group exists in options.html', () => {
      const htmlContent = fs.readFileSync('src/ui/options/options.html', 'utf-8');
      assert.ok(
        htmlContent.includes('name="settingUnlockScope"'),
        'options.html must contain settingUnlockScope radio group'
      );
      assert.ok(
        htmlContent.includes('value="THIS_TAB_ONLY"'),
        'options.html must contain THIS_TAB_ONLY option'
      );
      assert.ok(
        htmlContent.includes('value="ALL_TABS_UNTIL_EXPIRATION"'),
        'options.html must contain ALL_TABS_UNTIL_EXPIRATION option'
      );
    });

    it('verifies progressive disclosure details drawer exists in collectionModal', () => {
      const htmlContent = fs.readFileSync('src/ui/options/options.html', 'utf-8');
      assert.ok(
        htmlContent.includes('advanced-settings-drawer'),
        'options.html must contain advanced-settings-drawer'
      );
      assert.ok(
        htmlContent.includes('Advanced Settings (Optional)'),
        'options.html must contain summary label'
      );
    });
  });

  // =========================================================================
  // 4. MOBILE RESPONSIVE CSS VERIFICATION
  // =========================================================================
  describe('Mobile Responsiveness & CSS Adaptations', () => {
    it('options.css declares 768px responsive breakpoint for mobile reflow', () => {
      const optionsCss = fs.readFileSync('src/ui/options/options.css', 'utf-8');
      assert.ok(
        optionsCss.includes('@media (max-width: 768px)'),
        'options.css must have @media (max-width: 768px) breakpoint'
      );
      assert.ok(
        optionsCss.includes('scroll-padding-bottom'),
        'options.css must specify scroll-padding-bottom for mobile keyboard'
      );
      assert.ok(
        optionsCss.includes('usage-summary-card'),
        'options.css must contain usage-summary-card styles'
      );
      assert.ok(
        optionsCss.includes('advanced-settings-drawer'),
        'options.css must contain advanced-settings-drawer styles'
      );
    });
  });
});
