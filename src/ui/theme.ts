/**
 * Moment Design System — Theme Engine & Runtime Synchronizer
 * Handles pure theme resolution, DOM application, OS preference tracking,
 * and cross-surface storage synchronization.
 */

import { AccentId, computeAccentTokens, getAccentHex, sanitizeAccentId, DEFAULT_ACCENT_ID } from '../shared/accent.js';

declare const chrome: any;

export type ThemeSetting = 'system' | 'light' | 'dark' | 'sepia';
export type EffectiveTheme = 'light' | 'dark' | 'sepia';

export const VALID_THEMES: readonly ThemeSetting[] = ['system', 'light', 'dark', 'sepia'];

/**
 * Type-guard validating whether a value is a recognized ThemeSetting.
 */
export function isValidThemeSetting(value: unknown): value is ThemeSetting {
  return typeof value === 'string' && VALID_THEMES.includes(value as ThemeSetting);
}

/**
 * Pure domain function resolving the effective visual theme from the user's
 * configured appearance setting and the operating system's prefers-color-scheme.
 *
 * Invariants:
 * - 'light' always resolves to 'light'
 * - 'dark' always resolves to 'dark'
 * - 'sepia' always resolves to 'sepia'
 * - 'system' follows systemPrefersDark ('dark' if true, 'light' if false)
 * - null/undefined/invalid safely falls back to 'system'
 */
export function resolveEffectiveTheme(
  setting: ThemeSetting | string | null | undefined,
  systemPrefersDark: boolean
): EffectiveTheme {
  switch (setting) {
    case 'light':
      return 'light';
    case 'dark':
      return 'dark';
    case 'sepia':
      return 'sepia';
    case 'system':
    default:
      return systemPrefersDark ? 'dark' : 'light';
  }
}

/**
 * Detects whether the current browser / OS environment prefers dark mode.
 */
export function getSystemPrefersDark(): boolean {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return false;
}

let activeSetting: ThemeSetting = 'system';
let activeAccents: { light: AccentId; dark: AccentId } = { light: DEFAULT_ACCENT_ID, dark: DEFAULT_ACCENT_ID };

const ACCENT_PROPS = ['--accent', '--accent-hover', '--accent-light', '--border-focus', '--on-accent'] as const;

/**
 * Remembers the per-appearance accent choices (applied on the next applyTheme).
 */
export function setAccentPreferences(light: unknown, dark: unknown): void {
  activeAccents = { light: sanitizeAccentId(light), dark: sanitizeAccentId(dark) };
}

/**
 * Applies the accent for the effective appearance as CSS custom properties.
 * The default accent and the sepia palette use the stylesheet tokens as-is.
 */
export function applyAccent(el: HTMLElement | null | undefined, effective: EffectiveTheme): void {
  const style = (el as any)?.style;
  if (!style || typeof style.setProperty !== 'function') return;

  const id = effective === 'dark' ? activeAccents.dark : effective === 'light' ? activeAccents.light : DEFAULT_ACCENT_ID;
  if (id === DEFAULT_ACCENT_ID || effective === 'sepia') {
    for (const p of ACCENT_PROPS) style.removeProperty(p);
    return;
  }

  const t = computeAccentTokens(getAccentHex(id), effective);
  style.setProperty('--accent', t.accent);
  style.setProperty('--border-focus', t.accent);
  style.setProperty('--accent-hover', t.accentHover);
  style.setProperty('--accent-light', t.accentLight);
  style.setProperty('--on-accent', t.onAccent);
}


/**
 * Applies the given theme setting to the DOM element (defaults to document.documentElement).
 * Sets:
 * - `data-theme`: the configured setting ('system', 'light', 'dark', 'sepia')
 * - `data-effective-theme`: the resolved palette ('light', 'dark', 'sepia')
 */
export function applyTheme(
  setting: ThemeSetting | string | null | undefined,
  rootEl?: HTMLElement | null
): EffectiveTheme {
  const targetEl = rootEl || (typeof document !== 'undefined' ? document.documentElement : null);
  const normalizedSetting: ThemeSetting = isValidThemeSetting(setting) ? setting : 'system';
  activeSetting = normalizedSetting;

  const systemDark = getSystemPrefersDark();
  const effective = resolveEffectiveTheme(normalizedSetting, systemDark);

  if (targetEl) {
    if (normalizedSetting === 'system') {
      targetEl.setAttribute('data-theme', 'system');
    } else {
      targetEl.setAttribute('data-theme', normalizedSetting);
    }
    targetEl.setAttribute('data-effective-theme', effective);
    applyAccent(targetEl, effective);
  }

  return effective;
}

/**
 * Initializes theme management on the current page:
 * 1. Immediately applies system preference as a baseline.
 * 2. Fetches saved user settings asynchronously and applies them.
 * 3. Registers listeners for OS preference shifts (prefers-color-scheme).
 * 4. Registers listeners for runtime storage changes (cross-tab theme synchronization).
 *
 * @returns Teardown function to deregister listeners.
 */
export function initTheme(
  onThemeChange?: (effective: EffectiveTheme, setting: ThemeSetting) => void
): () => void {
  // 1. Baseline application
  const initialEffective = applyTheme(activeSetting);
  if (onThemeChange) onThemeChange(initialEffective, activeSetting);

  // 2. Fetch authoritative setting from background
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (res: any) => {
      if (res?.success && res.data?.theme) {
        setAccentPreferences(res.data.accentLight, res.data.accentDark);
        const effective = applyTheme(res.data.theme);
        if (onThemeChange) onThemeChange(effective, res.data.theme);
      }
    });
  }

  // 3. Listen to OS prefers-color-scheme changes
  let mediaListener: ((e: MediaQueryListEvent) => void) | null = null;
  let mql: MediaQueryList | null = null;

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    mql = window.matchMedia('(prefers-color-scheme: dark)');
    mediaListener = () => {
      if (activeSetting === 'system') {
        const effective = applyTheme('system');
        if (onThemeChange) onThemeChange(effective, 'system');
      }
    };
    mql.addEventListener('change', mediaListener);
  }

  // 4. Listen to storage changes (e.g., user saves a new theme in the Options tab)
  const storageListener = (changes: any, areaName: string) => {
    if (areaName === 'local' && changes.moment_state?.newValue?.settings?.theme) {
      const newSettings = changes.moment_state.newValue.settings;
      setAccentPreferences(newSettings.accentLight, newSettings.accentDark);
      const newTheme = newSettings.theme;
      const effective = applyTheme(newTheme);
      if (onThemeChange) onThemeChange(effective, newTheme);
    }
  };

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener(storageListener);
  }

  // Return cleanup function
  return () => {
    if (mql && mediaListener) {
      mql.removeEventListener('change', mediaListener);
    }
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.removeListener(storageListener);
    }
  };
}
