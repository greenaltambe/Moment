import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHROME_DESKTOP_CAPABILITIES,
  FIREFOX_ANDROID_CAPABILITIES,
  FIREFOX_DESKTOP_CAPABILITIES,
} from '../../dist/chrome/browser/capabilities.js';
import { sanitizeUrlForDisplay, isSafeDestination } from '../../dist/chrome/shared/urls.js';

describe('Browser Capabilities & Security Helpers', () => {
  it('Desktop profiles support window focus tracking', () => {
    assert.equal(CHROME_DESKTOP_CAPABILITIES.supportsWindowFocus, true);
    assert.equal(FIREFOX_DESKTOP_CAPABILITIES.supportsWindowFocus, true);
  });

  it('Android profile disables window focus and popup', () => {
    assert.equal(FIREFOX_ANDROID_CAPABILITIES.supportsWindowFocus, false);
    assert.equal(FIREFOX_ANDROID_CAPABILITIES.supportsPopup, false);
    assert.equal(FIREFOX_ANDROID_CAPABILITIES.supportsAndroid, true);
  });

  it('sanitizeUrlForDisplay extracts clean origin and path without fragments or creds', () => {
    const raw = 'https://user:pass@reddit.com/r/programming?sort=top#hash';
    const clean = sanitizeUrlForDisplay(raw);
    assert.equal(clean, 'https://reddit.com/r/programming');
  });

  it('isSafeDestination permits http and https and blocks dangerous schemes', () => {
    assert.equal(isSafeDestination('https://example.com'), true);
    assert.equal(isSafeDestination('http://example.com/page'), true);
    assert.equal(isSafeDestination('javascript:alert(1)'), false);
    assert.equal(isSafeDestination('file:///etc/passwd'), false);
    assert.equal(isSafeDestination('data:text/html,bad'), false);
  });
});
