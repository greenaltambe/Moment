import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCENTS,
  computeAccentTokens,
  contrastRatio,
  isValidAccentId,
  sanitizeAccentId,
} from '../../dist/chrome/shared/accent.js';
import { applyTheme, setAccentPreferences } from '../../dist/chrome/ui/theme.js';
import { migrateStorageState } from '../../dist/chrome/storage/migrations.js';

function mockEl() {
  const props = new Map<string, string>();
  return {
    props,
    setAttribute() {},
    style: {
      setProperty: (k: string, v: string) => props.set(k, v),
      removeProperty: (k: string) => props.delete(k),
    },
  } as any;
}

describe('Accent colors', () => {
  it('offers Moment, 9 GNOME and Firefox presets', () => {
    assert.equal(ACCENTS.filter((a) => a.group === 'gnome').length, 9);
    assert.ok(ACCENTS.filter((a) => a.group === 'firefox').length >= 4);
    assert.ok(isValidAccentId('gnome-teal'));
    assert.equal(sanitizeAccentId('nope'), 'moment');
  });

  it('every preset is readable in light and dark (>= 4.5:1)', () => {
    for (const a of ACCENTS) {
      const l = computeAccentTokens(a.hex, 'light');
      assert.ok(contrastRatio(l.onAccent, l.accent) >= 4.5, `${a.id} light on-accent`);
      assert.ok(contrastRatio(l.accent, '#fbfdf9') >= 4.5, `${a.id} light on card`);
      const d = computeAccentTokens(a.hex, 'dark');
      assert.ok(contrastRatio(d.onAccent, d.accent) >= 4.5, `${a.id} dark on-accent`);
      assert.ok(contrastRatio(d.accent, '#1a211b') >= 4.5, `${a.id} dark on card`);
    }
  });

  it('applies the accent for the effective appearance only', () => {
    const el = mockEl();
    setAccentPreferences('gnome-blue', 'gnome-pink');
    applyTheme('light', el);
    const lightAccent = el.props.get('--accent');
    assert.ok(lightAccent);
    applyTheme('dark', el);
    assert.ok(el.props.get('--accent') !== lightAccent);
    applyTheme('sepia', el);
    assert.equal(el.props.size, 0);
    setAccentPreferences('moment', 'moment');
    applyTheme('light', el);
    assert.equal(el.props.size, 0);
  });

  it('migration keeps valid accents and defaults invalid ones', () => {
    const s: any = migrateStorageState({ settings: { accentLight: 'firefox-blue', accentDark: 'bogus' } } as any);
    assert.equal(s.settings.accentLight, 'firefox-blue');
    assert.equal(s.settings.accentDark, 'moment');
  });
});
