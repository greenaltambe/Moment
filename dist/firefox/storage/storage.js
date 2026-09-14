/**
 * Moment Storage Abstraction
 * Wraps extension storage behind a Promise-based queue with atomic mutation locks.
 */
import { DEFAULT_STORAGE_STATE, } from './schema.js';
import { migrateStorageState } from './migrations.js';
function getStorageBackend() {
    if (typeof chrome !== 'undefined' && chrome.storage?.local)
        return chrome.storage.local;
    if (typeof browser !== 'undefined' && browser.storage?.local)
        return browser.storage.local;
    return null;
}
export class ExtensionStorage {
    backend;
    memoryCache = null;
    mutationQueue = Promise.resolve();
    constructor(customBackend) {
        this.backend = customBackend || getStorageBackend();
    }
    async getState() {
        if (this.memoryCache) {
            return this.memoryCache;
        }
        if (!this.backend) {
            // Memory fallback for tests
            this.memoryCache = { ...DEFAULT_STORAGE_STATE };
            return this.memoryCache;
        }
        return new Promise((resolve) => {
            this.backend.get('moment_state', (result) => {
                const raw = result?.moment_state;
                const validState = migrateStorageState(raw);
                this.memoryCache = validState;
                resolve(validState);
            });
        });
    }
    async updateState(mutator) {
        // Chain mutations to prevent race conditions (serialized mutation queue)
        const nextMutation = this.mutationQueue.catch(() => { }).then(async () => {
            const current = await this.getState();
            // Deep clone current state to prevent accidental mutation of cache before save
            const draft = JSON.parse(JSON.stringify(current));
            mutator(draft);
            if (this.backend) {
                await new Promise((resolve, reject) => {
                    this.backend.set({ moment_state: draft }, () => {
                        const err = globalThis.chrome?.runtime?.lastError;
                        if (err)
                            reject(new Error(err.message));
                        else
                            resolve();
                    });
                });
            }
            this.memoryCache = draft;
            return draft;
        });
        this.mutationQueue = nextMutation;
        return nextMutation;
    }
    async resetState() {
        await this.updateState((draft) => {
            Object.assign(draft, DEFAULT_STORAGE_STATE);
        });
    }
}
