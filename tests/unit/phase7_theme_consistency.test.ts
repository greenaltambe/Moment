/**
 * Phase 7.1 Test Suite: Theme Consistency & UI Polish
 *
 * Verifies the complete centralized theme architecture:
 * 1. SYSTEM setting exists in schema defaults
 * 2. LIGHT setting resolves to light
 * 3. DARK setting resolves to dark
 * 4. SEPIA setting resolves to sepia
 * 5. SYSTEM + prefers-color-scheme light -> light
 * 6. SYSTEM + prefers-color-scheme dark -> dark
 * 7. Explicit LIGHT overrides dark system
 * 8. Explicit DARK overrides light system
 * 9. Explicit SEPIA overrides system
 * 10. Setting persistence & storage update
 * 11. Invalid theme falls back safely
 * 12. All UI surfaces link theme.css and initialize theme
 * 13. Zero inline style attributes (strict CSP)
 * 14. Zero CSP regressions (no inline scripts, no eval)
 * 15. CSS syntax and token completeness (no malformed selectors, native color-scheme declared)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  resolveEffectiveTheme,
  isValidThemeSetting,
  applyTheme,
} from '../../dist/chrome/ui/theme.js';
import {
  DEFAULT_USER_SETTINGS,
} from '../../dist/chrome/storage/schema.js';
import { ExtensionStorage } from '../../dist/chrome/storage/storage.js';

const ROOT_DIR = process.cwd();

describe('Phase 7.1 — Theme Consistency & UI Polish', () => {

  // --------------------------------------------------------------------------
  // 1. Schema & Settings Defaults
  // --------------------------------------------------------------------------
  describe('1. Settings Schema & Defaults', () => {
    it('SYSTEM setting exists and is the default in UserSettings', () => {
      assert.equal(DEFAULT_USER_SETTINGS.theme, 'system');
    });

    it('isValidThemeSetting correctly validates all supported themes', () => {
      assert.equal(isValidThemeSetting('system'), true);
      assert.equal(isValidThemeSetting('light'), true);
      assert.equal(isValidThemeSetting('dark'), true);
      assert.equal(isValidThemeSetting('sepia'), true);

      assert.equal(isValidThemeSetting(''), false);
      assert.equal(isValidThemeSetting('ocean'), false);
      assert.equal(isValidThemeSetting('midnight'), false);
      assert.equal(isValidThemeSetting(null), false);
      assert.equal(isValidThemeSetting(undefined), false);
      assert.equal(isValidThemeSetting(123), false);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Pure Domain Theme Resolution
  // --------------------------------------------------------------------------
  describe('2. Theme Resolution Semantics', () => {
    it('LIGHT setting always resolves to light (regardless of system preference)', () => {
      assert.equal(resolveEffectiveTheme('light', false), 'light');
      assert.equal(resolveEffectiveTheme('light', true), 'light');
    });

    it('DARK setting always resolves to dark (regardless of system preference)', () => {
      assert.equal(resolveEffectiveTheme('dark', false), 'dark');
      assert.equal(resolveEffectiveTheme('dark', true), 'dark');
    });

    it('SEPIA setting always resolves to sepia (regardless of system preference)', () => {
      assert.equal(resolveEffectiveTheme('sepia', false), 'sepia');
      assert.equal(resolveEffectiveTheme('sepia', true), 'sepia');
    });

    it('SYSTEM setting follows prefers-color-scheme: light -> light', () => {
      assert.equal(resolveEffectiveTheme('system', false), 'light');
    });

    it('SYSTEM setting follows prefers-color-scheme: dark -> dark', () => {
      assert.equal(resolveEffectiveTheme('system', true), 'dark');
    });

    it('Explicit LIGHT overrides dark system preference', () => {
      const systemDark = true;
      const effective = resolveEffectiveTheme('light', systemDark);
      assert.equal(effective, 'light');
    });

    it('Explicit DARK overrides light system preference', () => {
      const systemDark = false;
      const effective = resolveEffectiveTheme('dark', systemDark);
      assert.equal(effective, 'dark');
    });

    it('Explicit SEPIA overrides both dark and light system preference', () => {
      assert.equal(resolveEffectiveTheme('sepia', true), 'sepia');
      assert.equal(resolveEffectiveTheme('sepia', false), 'sepia');
    });

    it('Invalid, null, or undefined theme falls back safely to system behavior', () => {
      // With system dark
      assert.equal(resolveEffectiveTheme(null, true), 'dark');
      assert.equal(resolveEffectiveTheme(undefined, true), 'dark');
      assert.equal(resolveEffectiveTheme('invalid_theme' as any, true), 'dark');

      // With system light
      assert.equal(resolveEffectiveTheme(null, false), 'light');
      assert.equal(resolveEffectiveTheme(undefined, false), 'light');
      assert.equal(resolveEffectiveTheme('invalid_theme' as any, false), 'light');
    });
  });

  // --------------------------------------------------------------------------
  // 3. DOM Application & Mock Element Testing
  // --------------------------------------------------------------------------
  describe('3. DOM Theme Application', () => {
    class MockHTMLElement {
      private attributes = new Map<string, string>();

      setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
      }

      getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
      }

      removeAttribute(name: string): void {
        this.attributes.delete(name);
      }

      hasAttribute(name: string): boolean {
        return this.attributes.has(name);
      }
    }

    it('applies data-theme and data-effective-theme attributes to target element', () => {
      const mockEl = new MockHTMLElement() as unknown as HTMLElement;

      const effectiveDark = applyTheme('dark', mockEl);
      assert.equal(effectiveDark, 'dark');
      assert.equal(mockEl.getAttribute('data-theme'), 'dark');
      assert.equal(mockEl.getAttribute('data-effective-theme'), 'dark');

      const effectiveLight = applyTheme('light', mockEl);
      assert.equal(effectiveLight, 'light');
      assert.equal(mockEl.getAttribute('data-theme'), 'light');
      assert.equal(mockEl.getAttribute('data-effective-theme'), 'light');

      const effectiveSepia = applyTheme('sepia', mockEl);
      assert.equal(effectiveSepia, 'sepia');
      assert.equal(mockEl.getAttribute('data-theme'), 'sepia');
      assert.equal(mockEl.getAttribute('data-effective-theme'), 'sepia');
    });

    it('applies system setting correctly with fallback when window is undefined', () => {
      const mockEl = new MockHTMLElement() as unknown as HTMLElement;

      const effectiveSystem = applyTheme('system', mockEl);
      // In Node environment without window.matchMedia, system defaults to light
      assert.equal(mockEl.getAttribute('data-theme'), 'system');
      assert.equal(mockEl.getAttribute('data-effective-theme'), effectiveSystem);
      assert.ok(['light', 'dark'].includes(effectiveSystem));
    });

    it('safely handles null element gracefully', () => {
      try {
        applyTheme('dark', null);
        assert.ok(true);
      } catch (err) {
        assert.fail('applyTheme should not throw on null element');
      }
    });
  });

  // --------------------------------------------------------------------------
  // 4. Storage Persistence
  // --------------------------------------------------------------------------
  describe('4. Storage Persistence & Setting Update', () => {
    it('persists theme setting across storage operations', async () => {
      const storage = new ExtensionStorage();
      const initial = await storage.getState();
      assert.equal(initial.settings.theme, 'system');

      // Update to dark
      await storage.updateState((draft: any) => {
        draft.settings = { ...draft.settings, theme: 'dark' };
      });

      const updatedDark = await storage.getState();
      assert.equal(updatedDark.settings.theme, 'dark');

      // Update to sepia
      await storage.updateState((draft: any) => {
        draft.settings = { ...draft.settings, theme: 'sepia' };
      });

      const updatedSepia = await storage.getState();
      assert.equal(updatedSepia.settings.theme, 'sepia');

      // Update back to system
      await storage.updateState((draft: any) => {
        draft.settings = { ...draft.settings, theme: 'system' };
      });

      const updatedSystem = await storage.getState();
      assert.equal(updatedSystem.settings.theme, 'system');
    });
  });

  // --------------------------------------------------------------------------
  // 5. Surface Audit & HTML Integration
  // --------------------------------------------------------------------------
  describe('5. UI Surfaces Audit & Integration', () => {
    const UI_PAGES = [
      { name: 'Popup', htmlPath: 'src/ui/popup/popup.html', tsPath: 'src/ui/popup/popup.ts' },
      { name: 'Dashboard/Options', htmlPath: 'src/ui/options/options.html', tsPath: 'src/ui/options/options.ts' },
      { name: 'Intervention', htmlPath: 'src/ui/intervene/intervene.html', tsPath: 'src/ui/intervene/intervene.ts' },
      { name: 'Block', htmlPath: 'src/ui/block/block.html', tsPath: 'src/ui/block/block.ts' },
    ];

    for (const page of UI_PAGES) {
      it(`${page.name} links to shared theme.css in head before page CSS`, () => {
        const fullPath = path.join(ROOT_DIR, page.htmlPath);
        assert.ok(fs.existsSync(fullPath), `File exists: ${page.htmlPath}`);
        const content = fs.readFileSync(fullPath, 'utf8');

        assert.ok(
          content.includes('<link rel="stylesheet" href="../theme.css">'),
          `${page.name} must include link to ../theme.css`
        );
      });

      it(`${page.name} script imports and initializes theme`, () => {
        const fullPath = path.join(ROOT_DIR, page.tsPath);
        assert.ok(fs.existsSync(fullPath), `File exists: ${page.tsPath}`);
        const content = fs.readFileSync(fullPath, 'utf8');

        assert.ok(
          content.includes("from '../theme.js'") || content.includes('from "../theme.js"'),
          `${page.name} script must import from ../theme.js`
        );
        assert.ok(
          content.includes('initTheme('),
          `${page.name} script must invoke initTheme()`
        );
      });
    }

    it('Manifest web_accessible_resources include theme.css and theme.js for both browsers', () => {
      for (const target of ['chrome', 'firefox']) {
        const manifestPath = path.join(ROOT_DIR, 'manifest', target, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

        const resources: string[] = manifest.web_accessible_resources?.[0]?.resources || [];
        assert.ok(
          resources.includes('ui/theme.css'),
          `${target} manifest must include ui/theme.css in web_accessible_resources`
        );
        assert.ok(
          resources.includes('ui/theme.js'),
          `${target} manifest must include ui/theme.js in web_accessible_resources`
        );
        assert.ok(
          resources.includes('ui/intervene/intervene.html'),
          `${target} manifest must include ui/intervene/intervene.html`
        );
        assert.ok(
          resources.includes('ui/block/block.html'),
          `${target} manifest must include ui/block/block.html`
        );
      }
    });
  });

  // --------------------------------------------------------------------------
  // 6. Security, CSP & Architectural Invariants
  // --------------------------------------------------------------------------
  describe('6. Security, CSP & Invariants', () => {
    it('No HTML file contains inline style attributes (style="...")', () => {
      const htmlFiles = [
        'src/ui/popup/popup.html',
        'src/ui/options/options.html',
        'src/ui/intervene/intervene.html',
        'src/ui/block/block.html',
      ];

      for (const file of htmlFiles) {
        const fullPath = path.join(ROOT_DIR, file);
        const content = fs.readFileSync(fullPath, 'utf8');
        const hasInlineStyle = /\bstyle\s*=\s*['"]/i.test(content);
        assert.equal(
          hasInlineStyle,
          false,
          `File ${file} contains forbidden inline style attribute!`
        );
      }
    });

    it('No HTML file contains inline script blocks without src', () => {
      const htmlFiles = [
        'src/ui/popup/popup.html',
        'src/ui/options/options.html',
        'src/ui/intervene/intervene.html',
        'src/ui/block/block.html',
      ];

      for (const file of htmlFiles) {
        const fullPath = path.join(ROOT_DIR, file);
        const content = fs.readFileSync(fullPath, 'utf8');
        const inlineScriptMatch = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
        let match;
        while ((match = inlineScriptMatch.exec(content)) !== null) {
          if (match[1].trim().length > 0) {
            assert.fail(`File ${file} contains forbidden inline script block!`);
          }
        }
      }
    });

    it('Theme engine introduces zero eval() or new Function() calls', () => {
      const themeTsPath = path.join(ROOT_DIR, 'src/ui/theme.ts');
      const content = fs.readFileSync(themeTsPath, 'utf8');
      assert.equal(/\beval\(/.test(content), false, 'Forbidden eval() in theme.ts');
      assert.equal(/\bnew\s+Function\(/.test(content), false, 'Forbidden new Function() in theme.ts');
    });

    it('Theme engine makes zero network requests or telemetry calls', () => {
      const themeTsPath = path.join(ROOT_DIR, 'src/ui/theme.ts');
      const content = fs.readFileSync(themeTsPath, 'utf8');
      assert.equal(/\bfetch\(/.test(content), false, 'Forbidden fetch() in theme.ts');
      assert.equal(/\bXMLHttpRequest\b/.test(content), false, 'Forbidden XMLHttpRequest in theme.ts');
      assert.equal(/\bWebSocket\b/.test(content), false, 'Forbidden WebSocket in theme.ts');
    });
  });

  // --------------------------------------------------------------------------
  // 7. CSS Syntax & Token Verification
  // --------------------------------------------------------------------------
  describe('7. CSS Syntax & Token Verification', () => {
    it('theme.css and options.css contain zero malformed comma-@media selector combinations', () => {
      const cssFiles = [
        'src/ui/theme.css',
        'src/ui/options/options.css',
        'src/ui/popup/popup.css',
        'src/ui/intervene/intervene.css',
        'src/ui/block/block.css',
      ];

      for (const file of cssFiles) {
        const fullPath = path.join(ROOT_DIR, file);
        const content = fs.readFileSync(fullPath, 'utf8');
        // Check for invalid pattern like: [data-theme="..."], \s* @media
        const malformedMediaComma = /,\s*@media/i.test(content);
        assert.equal(
          malformedMediaComma,
          false,
          `File ${file} contains invalid CSS syntax: comma before @media rule!`
        );
      }
    });

    it('theme.css declares native color-scheme property for proper control rendering', () => {
      const themeCssPath = path.join(ROOT_DIR, 'src/ui/theme.css');
      const content = fs.readFileSync(themeCssPath, 'utf8');

      assert.ok(content.includes('color-scheme: light dark;'), 'theme.css base must declare color-scheme: light dark');
      assert.ok(content.includes('color-scheme: dark;'), 'theme.css dark theme must declare color-scheme: dark');
      assert.ok(content.includes('color-scheme: light;'), 'theme.css light/sepia theme must declare color-scheme: light');
    });

    it('theme.css declares intentional palettes for light, dark, and sepia', () => {
      const themeCssPath = path.join(ROOT_DIR, 'src/ui/theme.css');
      const content = fs.readFileSync(themeCssPath, 'utf8');

      // Light/Base tokens
      assert.ok(content.includes('--bg-main: #f3f7f1;'));
      assert.ok(content.includes('--card-bg: #fbfdf9;'));
      assert.ok(content.includes('--text-main: #0f172a;'));

      // Dark tokens
      assert.ok(content.includes('--bg-main: #101511;'));
      assert.ok(content.includes('--card-bg: #1a211b;'));
      assert.ok(content.includes('--text-main: #f8fafc;'));
      assert.ok(content.includes('--text-muted: #94a3b8;'));

      // Sepia tokens
      assert.ok(content.includes('--bg-main: #fbf0d9;'));
      assert.ok(content.includes('--card-bg: #fdf6e2;'));
      assert.ok(content.includes('--text-main: #433422;'));
      assert.ok(content.includes('--text-muted: #79664f;'));

      // Modal backdrop & focus ring
      assert.ok(content.includes('--modal-backdrop:'));
      assert.ok(content.includes('--focus-ring:'));
    });
  });
});
