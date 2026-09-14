/**
 * Moment Background: Active Time Tracker
 * Tracks active browsing time across tab activations, window focus, navigations, and closures.
 *
 * Invariants:
 * - Single active tab accounting (no double counting across windows or tabs).
 * - Interval-based timestamp accounting (now - lastCheckpointTimestamp), NOT a 1-second continuous tick.
 * - Sleep / OS suspension clamping: discrete active delta capped at MAX_DISCRETE_ACTIVE_DELTA_MS (60s).
 * - Clock rollback defense: negative delta ignored, resets checkpoint.
 * - Local midnight boundary splitting: intervals spanning 00:00:00 split across calendar date keys.
 * - Privacy: Zero URL logging; only accumulates time in daily aggregate counters keyed by collection ID and date.
 */

import { BrowserAdapter } from '../browser/adapter.js';
import { ExtensionStorage } from '../storage/storage.js';
import { MomentDecisionEngine } from '../core/decisions/engine.js';
import { ActiveTrackingState } from '../core/usage/types.js';
import {
  calculateActiveDelta,
  splitIntervalAtMidnight,
  getUsageRecordKey,
  getLocalDateKey,
  resolveCollectionLimitMs,
  calculateRemainingBudget,
  formatDuration,
} from '../core/usage/accounting.js';
import { MAX_DISCRETE_ACTIVE_DELTA_MS } from '../shared/constants.js';
import { Logger } from '../diagnostics/logger.js';
import { TabUsageSummary, CollectionUsageSummary } from '../shared/messages.js';

export class ActiveTimeTracker {
  private storage: ExtensionStorage;
  private adapter: BrowserAdapter;
  private engine: MomentDecisionEngine;
  private logger = new Logger('ActiveTimeTracker');

  private state: ActiveTrackingState = {
    activeTabId: null,
    activeWindowId: null,
    isWindowFocused: true,
    activeCollectionId: null,
    lastCheckpointTimestamp: null,
  };

  private unsubs: Array<() => void> = [];
  private periodicInterval: any = null;
  private clock: () => number;

  constructor(
    storage: ExtensionStorage,
    adapter: BrowserAdapter,
    engine?: MomentDecisionEngine,
    clock: () => number = () => Date.now()
  ) {
    this.storage = storage;
    this.adapter = adapter;
    this.engine = engine || new MomentDecisionEngine();
    this.clock = clock;
  }

  async initialize(): Promise<void> {
    const now = this.clock();
    const storedState = await this.storage.getState();

    // Reconcile current active tab and window focus
    const currentTab = await this.adapter.getCurrentTab();
    if (currentTab) {
      this.state.activeTabId = currentTab.id;
      this.state.activeWindowId = currentTab.windowId;
      if (currentTab.url && (currentTab.url.startsWith('http:') || currentTab.url.startsWith('https:'))) {
        const matchingCol = this.engine.resolveMatchingCollection(
          currentTab.url,
          now,
          storedState.collections,
          storedState.runtime?.focusSession
        );
        this.state.activeCollectionId = matchingCol ? matchingCol.id : null;
      } else {
        this.state.activeCollectionId = null;
      }
    }

    this.state.lastCheckpointTimestamp = now;

    // Attach browser adapter listeners
    this.unsubs.push(
      this.adapter.onTabActivated((activeInfo) => {
        this.handleTabActivated(activeInfo).catch((err) =>
          this.logger.error('Error handling tab activated', { error: err.message })
        );
      })
    );

    this.unsubs.push(
      this.adapter.onWindowFocusChanged((windowId) => {
        this.handleWindowFocusChanged(windowId).catch((err) =>
          this.logger.error('Error handling window focus changed', { error: err.message })
        );
      })
    );

    this.unsubs.push(
      this.adapter.onNavigation((nav) => {
        this.handleNavigation(nav).catch((err) =>
          this.logger.error('Error handling navigation', { error: err.message })
        );
      })
    );

    this.unsubs.push(
      this.adapter.onTabRemoved((tabId) => {
        this.handleTabRemoved(tabId).catch((err) =>
          this.logger.error('Error handling tab removed', { error: err.message })
        );
      })
    );

    // Periodic checkpoint flush to persist accumulation while worker is active
    this.periodicInterval = setInterval(() => {
      this.flush().catch((err) =>
        this.logger.error('Periodic flush failed', { error: err.message })
      );
    }, 25_000);

    if (typeof this.periodicInterval?.unref === 'function') {
      this.periodicInterval.unref();
    }

    this.logger.info('ActiveTimeTracker initialized', {
      activeTabId: this.state.activeTabId,
      activeCollectionId: this.state.activeCollectionId,
    });
  }

  getState(): ActiveTrackingState {
    return { ...this.state };
  }

  /**
   * Flushes any accumulated active browsing time to persistent storage.
   */
  async flush(now: number = this.clock()): Promise<void> {
    const { isWindowFocused, activeTabId, activeCollectionId, lastCheckpointTimestamp } = this.state;

    if (
      isWindowFocused &&
      activeTabId !== null &&
      activeCollectionId !== null &&
      lastCheckpointTimestamp !== null
    ) {
      const delta = calculateActiveDelta(lastCheckpointTimestamp, now, MAX_DISCRETE_ACTIVE_DELTA_MS);

      if (delta > 0) {
        const slices = splitIntervalAtMidnight(lastCheckpointTimestamp, lastCheckpointTimestamp + delta);

        await this.storage.updateState((draft) => {
          for (const slice of slices) {
            const key = getUsageRecordKey(slice.dateKey, activeCollectionId);
            const existing = draft.usage[key];
            if (existing) {
              existing.accumulatedMs += slice.durationMs;
              existing.updatedAt = now;
            } else {
              draft.usage[key] = {
                dateKey: slice.dateKey,
                collectionId: activeCollectionId,
                accumulatedMs: slice.durationMs,
                updatedAt: now,
              };
            }
          }
          draft.runtime.tracking = {
            activeTabId: this.state.activeTabId,
            activeWindowId: this.state.activeWindowId,
            isWindowFocused: this.state.isWindowFocused,
            activeCollectionId: this.state.activeCollectionId,
            lastCheckpointTimestamp: now,
          };
        });
      }
    }

    this.state.lastCheckpointTimestamp = now;
  }

  async handleTabActivated(activeInfo: { tabId: number; windowId: number }): Promise<void> {
    const now = this.clock();
    await this.flush(now);

    this.state.activeTabId = activeInfo.tabId;
    this.state.activeWindowId = activeInfo.windowId;

    const tab = await this.adapter.getTab(activeInfo.tabId);
    if (tab?.url && (tab.url.startsWith('http:') || tab.url.startsWith('https:'))) {
      const storedState = await this.storage.getState();
      const matchingCol = this.engine.resolveMatchingCollection(
        tab.url,
        now,
        storedState.collections,
        storedState.runtime?.focusSession
      );
      this.state.activeCollectionId = matchingCol ? matchingCol.id : null;
    } else {
      this.state.activeCollectionId = null;
    }

    this.state.lastCheckpointTimestamp = now;
  }

  async handleWindowFocusChanged(windowId: number): Promise<void> {
    const now = this.clock();
    await this.flush(now);

    // In WebExtensions, windowId === -1 represents all browser windows losing focus
    if (windowId === -1) {
      this.state.isWindowFocused = false;
    } else {
      this.state.isWindowFocused = true;
      this.state.activeWindowId = windowId;

      const currentTab = await this.adapter.getCurrentTab();
      if (currentTab && currentTab.windowId === windowId) {
        this.state.activeTabId = currentTab.id;
        if (currentTab.url && (currentTab.url.startsWith('http:') || currentTab.url.startsWith('https:'))) {
          const storedState = await this.storage.getState();
          const matchingCol = this.engine.resolveMatchingCollection(
            currentTab.url,
            now,
            storedState.collections,
            storedState.runtime?.focusSession
          );
          this.state.activeCollectionId = matchingCol ? matchingCol.id : null;
        } else {
          this.state.activeCollectionId = null;
        }
      } else {
        this.state.activeTabId = null;
        this.state.activeCollectionId = null;
      }
    }

    this.state.lastCheckpointTimestamp = now;
  }

  async handleNavigation(nav: { tabId: number; url: string; frameId: number; timestamp: number }): Promise<void> {
    if (nav.frameId !== 0 || nav.tabId !== this.state.activeTabId) {
      return;
    }

    const now = nav.timestamp || this.clock();
    await this.flush(now);

    if (nav.url.startsWith('http:') || nav.url.startsWith('https:')) {
      const storedState = await this.storage.getState();
      const matchingCol = this.engine.resolveMatchingCollection(
        nav.url,
        now,
        storedState.collections,
        storedState.runtime?.focusSession
      );
      this.state.activeCollectionId = matchingCol ? matchingCol.id : null;
    } else {
      this.state.activeCollectionId = null;
    }

    this.state.lastCheckpointTimestamp = now;
  }

  async handleTabRemoved(tabId: number): Promise<void> {
    if (tabId === this.state.activeTabId) {
      const now = this.clock();
      await this.flush(now);
      this.state.activeTabId = null;
      this.state.activeCollectionId = null;
      this.state.lastCheckpointTimestamp = now;
    }
  }

  async getUsageForTab(tabId?: number): Promise<TabUsageSummary> {
    const now = this.clock();
    await this.flush(now);

    const storedState = await this.storage.getState();
    const targetTab = tabId !== undefined
      ? await this.adapter.getTab(tabId)
      : await this.adapter.getCurrentTab();

    if (!targetTab) {
      return {
        tabId: -1,
        collectionId: null,
        collectionName: null,
        dailyLimitMs: null,
        usedMs: 0,
        remainingMs: null,
        isExhausted: false,
        formattedUsed: '0m',
        formattedLimit: null,
        formattedRemaining: null,
      };
    }

    let hostname: string | undefined;
    if (targetTab.url) {
      try {
        hostname = new URL(targetTab.url).hostname;
      } catch {
        hostname = undefined;
      }
    }

    const matchingCol = targetTab.url && (targetTab.url.startsWith('http:') || targetTab.url.startsWith('https:'))
      ? this.engine.resolveMatchingCollection(
          targetTab.url,
          now,
          storedState.collections,
          storedState.runtime?.focusSession
        )
      : null;

    if (!matchingCol) {
      return {
        tabId: targetTab.id,
        url: targetTab.url,
        hostname,
        collectionId: null,
        collectionName: null,
        dailyLimitMs: null,
        usedMs: 0,
        remainingMs: null,
        isExhausted: false,
        formattedUsed: '0m',
        formattedLimit: null,
        formattedRemaining: null,
      };
    }

    const dateKey = getLocalDateKey(new Date(now));
    const usageKey = getUsageRecordKey(dateKey, matchingCol.id);
    const usedMs = storedState.usage[usageKey]?.accumulatedMs || 0;
    const limitMs = resolveCollectionLimitMs(matchingCol);
    const { remainingMs, isExhausted } = calculateRemainingBudget(usedMs, limitMs);

    return {
      tabId: targetTab.id,
      url: targetTab.url,
      hostname,
      collectionId: matchingCol.id,
      collectionName: matchingCol.name,
      dailyLimitMs: limitMs,
      usedMs,
      remainingMs,
      isExhausted,
      formattedUsed: formatDuration(usedMs),
      formattedLimit: limitMs !== null ? formatDuration(limitMs) : null,
      formattedRemaining: remainingMs !== null ? formatDuration(remainingMs) : null,
    };
  }

  async getUsageForCollection(collectionId: string): Promise<CollectionUsageSummary> {
    const now = this.clock();
    await this.flush(now);

    const storedState = await this.storage.getState();
    const collection = storedState.collections[collectionId];
    if (!collection) {
      throw new Error(`Collection with ID '${collectionId}' not found`);
    }

    const dateKey = getLocalDateKey(new Date(now));
    const usageKey = getUsageRecordKey(dateKey, collection.id);
    const usedMs = storedState.usage[usageKey]?.accumulatedMs || 0;
    const limitMs = resolveCollectionLimitMs(collection);
    const { remainingMs, isExhausted } = calculateRemainingBudget(usedMs, limitMs);

    return {
      collectionId: collection.id,
      collectionName: collection.name,
      dailyLimitMs: limitMs,
      usedMs,
      remainingMs,
      isExhausted,
      formattedUsed: formatDuration(usedMs),
      formattedLimit: limitMs !== null ? formatDuration(limitMs) : null,
      formattedRemaining: remainingMs !== null ? formatDuration(remainingMs) : null,
    };
  }

  dispose(): void {
    if (this.periodicInterval) {
      clearInterval(this.periodicInterval);
      this.periodicInterval = null;
    }
    for (const unsub of this.unsubs) {
      try {
        unsub();
      } catch {}
    }
    this.unsubs = [];
  }
}
