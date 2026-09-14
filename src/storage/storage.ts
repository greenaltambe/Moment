/**
 * Moment Storage Abstraction
 * Wraps extension storage behind a Promise-based queue with atomic mutation locks.
 */

import {
  DEFAULT_STORAGE_STATE,
  MomentStorageEnvelope,
} from './schema.js';
import { migrateStorageState } from './migrations.js';

declare const chrome: any;
declare const browser: any;

function getStorageBackend(): any {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) return chrome.storage.local;
  if (typeof browser !== 'undefined' && browser.storage?.local) return browser.storage.local;
  return null;
}

export interface IStorage {
  getState(): Promise<MomentStorageEnvelope>;
  updateState(mutator: (draft: MomentStorageEnvelope) => void): Promise<MomentStorageEnvelope>;
  resetState(): Promise<void>;
}

export class ExtensionStorage implements IStorage {
  private backend: any;
  private memoryCache: MomentStorageEnvelope | null = null;
  private mutationQueue: Promise<any> = Promise.resolve();

  constructor(customBackend?: any) {
    this.backend = customBackend || getStorageBackend();
  }

  async getState(): Promise<MomentStorageEnvelope> {
    if (this.memoryCache) {
      return this.memoryCache;
    }

    if (!this.backend) {
      // Memory fallback for tests
      this.memoryCache = { ...DEFAULT_STORAGE_STATE };
      return this.memoryCache;
    }

    return new Promise((resolve) => {
      this.backend.get('moment_state', (result: any) => {
        const raw = result?.moment_state;
        const validState = migrateStorageState(raw);
        this.memoryCache = validState;
        resolve(validState);
      });
    });
  }

  async updateState(mutator: (draft: MomentStorageEnvelope) => void): Promise<MomentStorageEnvelope> {
    // Chain mutations to prevent race conditions (serialized mutation queue)
    const nextMutation = this.mutationQueue.catch(() => {}).then(async () => {
      const current = await this.getState();
      // Deep clone current state to prevent accidental mutation of cache before save
      const draft: MomentStorageEnvelope = JSON.parse(JSON.stringify(current));
      mutator(draft);

      if (this.backend) {
        await new Promise<void>((resolve, reject) => {
          this.backend.set({ moment_state: draft }, () => {
            const err = (globalThis as any).chrome?.runtime?.lastError;
            if (err) reject(new Error(err.message));
            else resolve();
          });
        });
      }

      this.memoryCache = draft;
      return draft;
    });

    this.mutationQueue = nextMutation;
    return nextMutation;
  }

  async resetState(): Promise<void> {
    await this.updateState((draft) => {
      Object.assign(draft, DEFAULT_STORAGE_STATE);
    });
  }
}
