/**
 * Moment Background Lifecycle Manager
 * Handles startup verification, schema loading, and listener binding.
 */
import { Logger } from '../diagnostics/logger.js';
const logger = new Logger('Lifecycle');
export class BackgroundLifecycle {
    storage;
    adapter;
    initialized = false;
    constructor(storage, adapter) {
        this.storage = storage;
        this.adapter = adapter;
    }
    async initialize() {
        if (this.initialized)
            return;
        logger.info('Initializing Moment background lifecycle...');
        const state = await this.storage.getState();
        logger.info(`Storage state loaded. Schema version: ${state.schemaVersion}`);
        const capabilities = this.adapter.getCapabilities();
        logger.info('Browser capabilities detected', {
            supportsWebNavigation: capabilities.supportsWebNavigation,
            supportsDeclarativeNetRequest: capabilities.supportsDeclarativeNetRequest,
            supportsSessionRules: capabilities.supportsSessionRules,
            supportsWindowFocus: capabilities.supportsWindowFocus,
        });
        this.initialized = true;
        logger.info('Moment background service initialized successfully.');
    }
    isInitialized() {
        return this.initialized;
    }
}
