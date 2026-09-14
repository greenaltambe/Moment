/**
 * Moment Browser Capabilities & Platform Profiles
 *
 * Distinguishes the four capability semantics:
 * 1. CONTRACT GUARANTEED: Mandated by WebExtensions / MV3 platform specification.
 * 2. PLATFORM-PROFILE ASSUMPTION: Inferred from platform UI differences (e.g. desktop multi-window vs mobile).
 * 3. RUNTIME DETECTED: Dynamically evaluated at adapter startup (e.g. User Agent / global browser inspection).
 * 4. EXPERIMENTALLY VERIFIED: Empirically proven via automated test execution in this environment.
 */

export interface BrowserCapabilities {
  /**
   * CONTRACT GUARANTEED: Mandated by WebExtensions API contract for top-level navigation interception.
   * Chrome MV3: webNavigation API.
   * Firefox Desktop / Android MV3: webNavigation API.
   */
  readonly supportsWebNavigation: boolean;

  /**
   * CONTRACT GUARANTEED: Declarative Net Request API for network-level rule matching.
   * Chrome MV3: Yes. Firefox 115+: Yes.
   */
  readonly supportsDeclarativeNetRequest: boolean;

  /**
   * CONTRACT GUARANTEED: DNR in-memory session rules.
   * Chrome MV3: Supported. Firefox 115+: Supported.
   */
  readonly supportsSessionRules: boolean;

  /**
   * PLATFORM-PROFILE ASSUMPTION: Multi-window focus change events (chrome.windows.onFocusChanged).
   * Desktop (Chrome / Firefox): Supported.
   * Mobile (Firefox Android / GeckoView): NOT supported (single-window mobile UI model).
   */
  readonly supportsWindowFocus: boolean;

  /**
   * CONTRACT GUARANTEED: chrome.alarms for scheduling periodic or deferred tasks without persistent timers.
   * Chrome MV3: Supported. Firefox Desktop / Android: Supported.
   */
  readonly supportsAlarms: boolean;

  /**
   * CONTRACT GUARANTEED: chrome.storage.session for worker in-memory session persistence across suspensions.
   * Chrome MV3: Supported. Firefox 115+: Supported.
   */
  readonly supportsStorageSession: boolean;

  /**
   * RUNTIME DETECTED: True when running on Android (GeckoView) platform.
   */
  readonly supportsAndroid: boolean;

  /**
   * PLATFORM-PROFILE ASSUMPTION: Dedicated popup window attached to toolbar action icon.
   * Desktop (Chrome / Firefox): Supported.
   * Mobile (Firefox Android): NOT supported (Android renders action as full-screen panel or tab).
   */
  readonly supportsPopup: boolean;

  /**
   * CONTRACT GUARANTEED: Ability to query extension incognito/private browsing authorization.
   * chrome.extension.isAllowedIncognitoAccess().
   */
  readonly supportsPrivateBrowsingDetection: boolean;
}

export type PlatformVerificationStatus =
  | 'VERIFIED'
  | 'UNVERIFIED — REQUIRES MANUAL TESTING'
  | 'NOT APPLICABLE';

export interface PlatformProfile {
  readonly platformId: 'chrome_desktop' | 'firefox_desktop' | 'firefox_android';
  readonly verificationStatus: PlatformVerificationStatus;
  readonly capabilities: BrowserCapabilities;
}

/**
 * Static baseline capabilities for Chrome Desktop (MV3).
 * Verification Status: UNVERIFIED — REQUIRES MANUAL TESTING (Chrome binary unavailable in Linux container).
 */
export const CHROME_DESKTOP_CAPABILITIES: BrowserCapabilities = {
  supportsWebNavigation: true,
  supportsDeclarativeNetRequest: true,
  supportsSessionRules: true,
  supportsWindowFocus: true,
  supportsAlarms: true,
  supportsStorageSession: true,
  supportsAndroid: false,
  supportsPopup: true,
  supportsPrivateBrowsingDetection: true,
};

export const CHROME_DESKTOP_PROFILE: PlatformProfile = {
  platformId: 'chrome_desktop',
  verificationStatus: 'UNVERIFIED — REQUIRES MANUAL TESTING',
  capabilities: CHROME_DESKTOP_CAPABILITIES,
};

/**
 * Static baseline capabilities for Firefox Desktop (MV3).
 * Verification Status: VERIFIED (empirically tested via Marionette in Firefox 155.0).
 */
export const FIREFOX_DESKTOP_CAPABILITIES: BrowserCapabilities = {
  supportsWebNavigation: true,
  supportsDeclarativeNetRequest: true,
  supportsSessionRules: true,
  supportsWindowFocus: true,
  supportsAlarms: true,
  supportsStorageSession: true,
  supportsAndroid: false,
  supportsPopup: true,
  supportsPrivateBrowsingDetection: true,
};

export const FIREFOX_DESKTOP_PROFILE: PlatformProfile = {
  platformId: 'firefox_desktop',
  verificationStatus: 'VERIFIED',
  capabilities: FIREFOX_DESKTOP_CAPABILITIES,
};

/**
 * Static baseline capabilities for Firefox Android (MV3 / GeckoView).
 * Verification Status: UNVERIFIED — REQUIRES MANUAL TESTING (GeckoView environment unavailable).
 */
export const FIREFOX_ANDROID_CAPABILITIES: BrowserCapabilities = {
  supportsWebNavigation: true,
  supportsDeclarativeNetRequest: true,
  supportsSessionRules: true,
  supportsWindowFocus: false, // Windows API unavailable on Android
  supportsAlarms: true,
  supportsStorageSession: true,
  supportsAndroid: true,
  supportsPopup: false, // Android renders popup as full-screen panel/tab
  supportsPrivateBrowsingDetection: true,
};

export const FIREFOX_ANDROID_PROFILE: PlatformProfile = {
  platformId: 'firefox_android',
  verificationStatus: 'UNVERIFIED — REQUIRES MANUAL TESTING',
  capabilities: FIREFOX_ANDROID_CAPABILITIES,
};
