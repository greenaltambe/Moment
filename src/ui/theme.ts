/**
 * Moment Design System — Theme Engine & Runtime Synchronizer
 * Handles pure theme resolution, DOM application, OS preference tracking,
 * and cross-surface storage synchronization.
 */

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
      const newTheme = changes.moment_state.newValue.settings.theme;
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
