/**
 * Moment accent colors.
 * Pure helpers (no DOM): the preset list (Moment, GNOME, Firefox), validation,
 * and a contrast-safe token calculator so any hue stays readable in both the
 * light and dark appearance.
 */

export type AccentGroup = 'moment' | 'gnome' | 'firefox';

export interface AccentDef {
  readonly id: string;
  readonly label: string;
  readonly group: AccentGroup;
  readonly hex: string;
}

/**
 * GNOME values are the libadwaita accent palette. Firefox values are the
 * Firefox / Proton brand accents (blue, violet, magenta, orange).
 */
export const ACCENTS = [
  { id: 'moment', label: 'Moment Green', group: 'moment', hex: '#15803d' },

  { id: 'gnome-blue', label: 'Blue', group: 'gnome', hex: '#3584e4' },
  { id: 'gnome-teal', label: 'Teal', group: 'gnome', hex: '#2190a4' },
  { id: 'gnome-green', label: 'Green', group: 'gnome', hex: '#3a944a' },
  { id: 'gnome-yellow', label: 'Yellow', group: 'gnome', hex: '#c88800' },
  { id: 'gnome-orange', label: 'Orange', group: 'gnome', hex: '#ed5b00' },
  { id: 'gnome-red', label: 'Red', group: 'gnome', hex: '#e62d42' },
  { id: 'gnome-pink', label: 'Pink', group: 'gnome', hex: '#d56199' },
  { id: 'gnome-purple', label: 'Purple', group: 'gnome', hex: '#9141ac' },
  { id: 'gnome-slate', label: 'Slate', group: 'gnome', hex: '#6f8396' },

  { id: 'firefox-blue', label: 'Firefox Blue', group: 'firefox', hex: '#0061e0' },
  { id: 'firefox-violet', label: 'Firefox Violet', group: 'firefox', hex: '#592acb' },
  { id: 'firefox-magenta', label: 'Firefox Magenta', group: 'firefox', hex: '#e31587' },
  { id: 'firefox-orange', label: 'Firefox Orange', group: 'firefox', hex: '#e25f00' },
] as const satisfies readonly AccentDef[];

export type AccentId = (typeof ACCENTS)[number]['id'];

export const DEFAULT_ACCENT_ID: AccentId = 'moment';

export const VALID_ACCENT_IDS: readonly string[] = ACCENTS.map((a) => a.id);

export function isValidAccentId(value: unknown): value is AccentId {
  return typeof value === 'string' && VALID_ACCENT_IDS.includes(value);
}

export function sanitizeAccentId(value: unknown): AccentId {
  return isValidAccentId(value) ? value : DEFAULT_ACCENT_ID;
}

export function getAccentHex(id: unknown): string {
  const found = ACCENTS.find((a) => a.id === id);
  return (found ?? ACCENTS[0]).hex;
}

export type AccentScheme = 'light' | 'dark';

export interface AccentTokens {
  readonly accent: string;
  readonly accentHover: string;
  readonly accentLight: string;
  readonly onAccent: string;
}

type RGB = readonly [number, number, number];

// Surfaces the accent is drawn on (kept in sync with theme.css card colors).
const LIGHT_SURFACE: RGB = [0xfb, 0xfd, 0xf9];
const DARK_SURFACE: RGB = [0x1a, 0x21, 0x1b];
const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];
const DARK_INK: RGB = [0x06, 0x10, 0x0a];

function parseHex(hex: string): RGB {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHex(c: RGB): string {
  return '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function luminance(c: RGB): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}

export function contrastRatio(a: string | RGB, b: string | RGB): number {
  const la = luminance(typeof a === 'string' ? parseHex(a) : a);
  const lb = luminance(typeof b === 'string' ? parseHex(b) : b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const MIN_CONTRAST = 4.5;

/**
 * Computes readable accent tokens for a preset in the given appearance.
 * Light: darkens until white text on the accent AND the accent as text on its
 * own tint and on cards reach 4.5:1. Dark: lightens until the accent reads on
 * the dark card, and picks the best of dark/white for text placed on it.
 */
export function computeAccentTokens(hex: string, scheme: AccentScheme): AccentTokens {
  const base = parseHex(hex);

  if (scheme === 'light') {
    const tint = mix(base, WHITE, 0.86);
    let accent = base;
    for (let i = 0; i < 40; i++) {
      const ok =
        contrastRatio(accent, WHITE) >= MIN_CONTRAST &&
        contrastRatio(accent, tint) >= MIN_CONTRAST &&
        contrastRatio(accent, LIGHT_SURFACE) >= MIN_CONTRAST;
      if (ok) break;
      accent = mix(accent, BLACK, 0.04);
    }
    return {
      accent: toHex(accent),
      accentHover: toHex(mix(accent, BLACK, 0.15)),
      accentLight: toHex(tint),
      onAccent: '#ffffff',
    };
  }

  let accent = base;
  for (let i = 0; i < 40; i++) {
    const tintOnCard = mix(DARK_SURFACE, accent, 0.2);
    const ok =
      contrastRatio(accent, DARK_SURFACE) >= MIN_CONTRAST &&
      contrastRatio(accent, tintOnCard) >= MIN_CONTRAST;
    if (ok) break;
    accent = mix(accent, WHITE, 0.04);
  }
  const onAccent = contrastRatio(accent, DARK_INK) >= contrastRatio(accent, WHITE) ? DARK_INK : WHITE;
  return {
    accent: toHex(accent),
    accentHover: toHex(mix(accent, BLACK, 0.12)),
    accentLight: `rgba(${Math.round(accent[0])}, ${Math.round(accent[1])}, ${Math.round(accent[2])}, 0.2)`,
    onAccent: toHex(onAccent),
  };
}
