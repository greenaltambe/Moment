/**
 * Moment Browser Capabilities & Platform Profiles
 *
 * Distinguishes the four capability semantics:
 * 1. CONTRACT GUARANTEED: Mandated by WebExtensions / MV3 platform specification.
 * 2. PLATFORM-PROFILE ASSUMPTION: Inferred from platform UI differences (e.g. desktop multi-window vs mobile).
 * 3. RUNTIME DETECTED: Dynamically evaluated at adapter startup (e.g. User Agent / global browser inspection).
 * 4. EXPERIMENTALLY VERIFIED: Empirically proven via automated test execution in this environment.
 */
/**
 * Static baseline capabilities for Chrome Desktop (MV3).
 * Verification Status: UNVERIFIED — REQUIRES MANUAL TESTING (Chrome binary unavailable in Linux container).
 */
export const CHROME_DESKTOP_CAPABILITIES = {
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
export const CHROME_DESKTOP_PROFILE = {
    platformId: 'chrome_desktop',
    verificationStatus: 'UNVERIFIED — REQUIRES MANUAL TESTING',
    capabilities: CHROME_DESKTOP_CAPABILITIES,
};
/**
 * Static baseline capabilities for Firefox Desktop (MV3).
 * Verification Status: VERIFIED (empirically tested via Marionette in Firefox 155.0).
 */
export const FIREFOX_DESKTOP_CAPABILITIES = {
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
export const FIREFOX_DESKTOP_PROFILE = {
    platformId: 'firefox_desktop',
    verificationStatus: 'VERIFIED',
    capabilities: FIREFOX_DESKTOP_CAPABILITIES,
};
/**
 * Static baseline capabilities for Firefox Android (MV3 / GeckoView).
 * Verification Status: UNVERIFIED — REQUIRES MANUAL TESTING (GeckoView environment unavailable).
 */
export const FIREFOX_ANDROID_CAPABILITIES = {
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
export const FIREFOX_ANDROID_PROFILE = {
    platformId: 'firefox_android',
    verificationStatus: 'UNVERIFIED — REQUIRES MANUAL TESTING',
    capabilities: FIREFOX_ANDROID_CAPABILITIES,
};
