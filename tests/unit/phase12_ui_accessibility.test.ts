/**
 * Phase 12 / Final UI & Accessibility Polish Pass Test Suite
 *
 * Verifies:
 * 1. Design Tokens in theme.css (spacing scale, radius scale, touch targets, transitions, themes)
 * 2. Touch Target Ergonomics across all stylesheets (min 44px interactive controls)
 * 3. Accessible Focus States (:focus-visible styling in all sheets)
 * 4. Motion Accessibility (prefers-reduced-motion: reduce in all sheets)
 * 5. Strict CSP & Zero Inline Style / Script Invariants across all HTML files
 * 6. Responsive Viewports & Mobile Keyboard Adaptability (100dvh, viewport-fit=cover)
 * 7. Multi-Platform Icon Suite Completeness
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Phase 12: UI & Accessibility Polish Pass', () => {

  const themeCss = fs.readFileSync(path.resolve('src/ui/theme.css'), 'utf8');
  const optionsCss = fs.readFileSync(path.resolve('src/ui/options/options.css'), 'utf8');
  const popupCss = fs.readFileSync(path.resolve('src/ui/popup/popup.css'), 'utf8');
  const interveneCss = fs.readFileSync(path.resolve('src/ui/intervene/intervene.css'), 'utf8');
  const blockCss = fs.readFileSync(path.resolve('src/ui/block/block.css'), 'utf8');

  const optionsHtml = fs.readFileSync(path.resolve('src/ui/options/options.html'), 'utf8');
  const popupHtml = fs.readFileSync(path.resolve('src/ui/popup/popup.html'), 'utf8');
  const interveneHtml = fs.readFileSync(path.resolve('src/ui/intervene/intervene.html'), 'utf8');
  const blockHtml = fs.readFileSync(path.resolve('src/ui/block/block.html'), 'utf8');

  // =========================================================================
  // 1. DESIGN TOKENS
  // =========================================================================
  describe('Design Tokens (theme.css)', () => {
    it('defines comprehensive spacing scale tokens', () => {
      const requiredSpacing = [
        '--space-2xs',
        '--space-xs',
        '--space-sm',
        '--space-md',
        '--space-lg',
        '--space-xl',
        '--space-2xl',
        '--space-3xl',
      ];
      for (const token of requiredSpacing) {
        assert.ok(themeCss.includes(token), `theme.css missing spacing token: ${token}`);
      }
    });

    it('defines comprehensive border-radius scale tokens', () => {
      const requiredRadii = [
        '--radius-xs',
        '--radius-sm',
        '--radius-md',
        '--radius-lg',
        '--radius-xl',
        '--radius-2xl',
        '--radius-full',
      ];
      for (const token of requiredRadii) {
        assert.ok(themeCss.includes(token), `theme.css missing radius token: ${token}`);
      }
    });

    it('defines touch target minimum token of 44px', () => {
      assert.ok(themeCss.includes('--touch-target-min: 44px;'), 'theme.css must declare 44px touch target minimum');
    });

    it('defines tactile transition tokens', () => {
      assert.ok(themeCss.includes('--transition-fast:'), 'theme.css must declare --transition-fast');
      assert.ok(themeCss.includes('--transition-normal:'), 'theme.css must declare --transition-normal');
    });

    it('maintains support for all 4 color schemes (Light, Dark, Sepia, System)', () => {
      assert.ok(themeCss.includes(':root'), 'theme.css must support base light theme');
      assert.ok(themeCss.includes('[data-theme="dark"]'), 'theme.css must support dark theme attribute');
      assert.ok(themeCss.includes('[data-theme="sepia"]'), 'theme.css must support sepia theme attribute');
      assert.ok(themeCss.includes('@media (prefers-color-scheme: dark)'), 'theme.css must support system dark theme');
    });
  });

  // =========================================================================
  // 2. TOUCH ERGONOMICS (44px TOUCH TARGETS)
  // =========================================================================
  describe('Touch Target Ergonomics', () => {
    it('ensures options dashboard interactive elements satisfy >= 44px touch targets', () => {
      // Buttons
      assert.ok(optionsCss.includes('--touch-target-min') || optionsCss.includes('min-height: 44px') || optionsCss.includes('min-height: var(--touch-target-min'), 'Options CSS must enforce touch target min');
      // Day chips
      assert.ok(optionsCss.includes('.day-chip'), 'Options CSS has day-chip');
      // Color choices
      assert.ok(optionsCss.includes('.color-option'), 'Options CSS has color-option');
    });

    it('ensures intervene action buttons have generous touch targets (>= 48px)', () => {
      assert.ok(interveneCss.includes('min-height: 48px') || interveneCss.includes('min-height: var(--touch-target-min)'), 'Intervene action buttons must be at least 44-48px');
    });

    it('ensures block action buttons have generous touch targets (>= 48px)', () => {
      assert.ok(blockCss.includes('min-height: 48px') || blockCss.includes('min-height: var(--touch-target-min)'), 'Block action buttons must be at least 44-48px');
    });
  });

  // =========================================================================
  // 3. ACCESSIBLE FOCUS VISIBILITY
  // =========================================================================
  describe('Accessible Focus States', () => {
    it('provides :focus-visible indicators in all stylesheet surfaces', () => {
      const sheets = [
        { name: 'theme.css', content: themeCss },
        { name: 'options.css', content: optionsCss },
        { name: 'popup.css', content: popupCss },
        { name: 'intervene.css', content: interveneCss },
        { name: 'block.css', content: blockCss },
      ];

      for (const sheet of sheets) {
        assert.ok(
          sheet.content.includes(':focus-visible') || sheet.content.includes(':focus'),
          `${sheet.name} must declare accessible keyboard focus styles`
        );
      }
    });
  });

  // =========================================================================
  // 4. MOTION ACCESSIBILITY (PREFERS-REDUCED-MOTION)
  // =========================================================================
  describe('Motion Accessibility', () => {
    it('implements prefers-reduced-motion in all UI styles', () => {
      const sheets = [
        { name: 'theme.css', content: themeCss },
        { name: 'options.css', content: optionsCss },
        { name: 'popup.css', content: popupCss },
        { name: 'intervene.css', content: interveneCss },
        { name: 'block.css', content: blockCss },
      ];

      for (const sheet of sheets) {
        assert.ok(
          sheet.content.includes('prefers-reduced-motion'),
          `${sheet.name} must include prefers-reduced-motion media query`
        );
      }
    });
  });

  // =========================================================================
  // 5. STRICT CSP & ZERO INLINE STYLE / SCRIPT INVARIANTS
  // =========================================================================
  describe('Strict CSP & Invariants', () => {
    const pages = [
      { name: 'options.html', content: optionsHtml },
      { name: 'popup.html', content: popupHtml },
      { name: 'intervene.html', content: interveneHtml },
      { name: 'block.html', content: blockHtml },
    ];

    it('contains ZERO inline style="..." attributes in HTML templates', () => {
      for (const page of pages) {
        const inlineStyleMatch = page.content.match(/style\s*=\s*["'][^"']*["']/i);
        assert.equal(
          inlineStyleMatch,
          null,
          `${page.name} violates CSP with inline style attribute: ${inlineStyleMatch ? inlineStyleMatch[0] : ''}`
        );
      }
    });

    it('contains ZERO inline script execution blocks without src in HTML templates', () => {
      for (const page of pages) {
        // Look for <script> tags that don't have src=
        const inlineScriptRegex = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
        const matches = Array.from(page.content.matchAll(inlineScriptRegex));
        // If there are scripts without src, ensure they are only empty or type=application/json
        for (const match of matches) {
          assert.equal(match[1].trim(), '', `${page.name} contains inline executable script`);
        }
      }
    });

    it('includes viewport-fit=cover for edge-to-edge mobile rendering', () => {
      for (const page of pages) {
        assert.ok(
          page.content.includes('viewport-fit=cover'),
          `${page.name} must include viewport-fit=cover in meta viewport tag`
        );
      }
    });
  });

  // =========================================================================
  // 6. RESPONSIVE VIEWPORT & ERGONOMICS
  // =========================================================================
  describe('Responsive Mobile Ergonomics', () => {
    it('uses 100dvh for mobile dynamic viewport in intervene and block pages', () => {
      assert.ok(interveneCss.includes('100dvh'), 'intervene.css must use 100dvh for dynamic mobile height');
      assert.ok(blockCss.includes('100dvh'), 'block.css must use 100dvh for dynamic mobile height');
    });

    it('provides responsive table adaptations for mobile displays in options dashboard', () => {
      assert.ok(
        optionsCss.includes('@media (max-width: 600px)') || optionsCss.includes('@media (max-width: 768px)'),
        'options.css must have mobile media queries'
      );
    });
  });

  // =========================================================================
  // 7. ICON SUITE VERIFICATION
  // =========================================================================
  describe('Icon Suite Completeness', () => {
    it('provides all standard resolutions of app icon assets in src/icons/', () => {
      const requiredSizes = [16, 32, 48, 96, 128, 256, 512];
      for (const size of requiredSizes) {
        const iconPath = path.resolve(`src/icons/icon-${size}.png`);
        assert.ok(fs.existsSync(iconPath), `Missing icon asset: ${iconPath}`);
        const buf = fs.readFileSync(iconPath, 'binary');
        assert.ok(buf.length > 0, `Icon asset ${iconPath} cannot be empty`);
      }
    });
  });

});
