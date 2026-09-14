/**
 * Chrome Desktop Browser Adapter (MV3)
 */
import { BaseBrowserAdapter } from '../base-adapter.js';
import { CHROME_DESKTOP_CAPABILITIES } from '../capabilities.js';
export class ChromeBrowserAdapter extends BaseBrowserAdapter {
    constructor() {
        super(CHROME_DESKTOP_CAPABILITIES);
    }
}
