export * from './capabilities.js';
export * from './adapter.js';
export * from './base-adapter.js';
export * from './chrome/adapter.js';
export * from './firefox/adapter.js';

import { BrowserAdapter } from './adapter.js';
import { ChromeBrowserAdapter } from './chrome/adapter.js';
import { FirefoxBrowserAdapter } from './firefox/adapter.js';

/**
 * Factory creating the appropriate browser adapter for the current runtime.
 */
export function createBrowserAdapter(): BrowserAdapter {
  // Safe runtime check
  const isFirefox = typeof (globalThis as any).browser !== 'undefined' ||
    (typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent));
  const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);

  if (isFirefox) {
    return new FirefoxBrowserAdapter(isAndroid);
  }
  return new ChromeBrowserAdapter();
}
