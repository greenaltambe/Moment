/**
 * Firefox Browser Adapter (Desktop & Android MV3)
 */
import { BaseBrowserAdapter } from '../base-adapter.js';
import { FIREFOX_ANDROID_CAPABILITIES, FIREFOX_DESKTOP_CAPABILITIES } from '../capabilities.js';
export class FirefoxBrowserAdapter extends BaseBrowserAdapter {
    constructor(isAndroid = false) {
        super(isAndroid ? FIREFOX_ANDROID_CAPABILITIES : FIREFOX_DESKTOP_CAPABILITIES);
    }
}
