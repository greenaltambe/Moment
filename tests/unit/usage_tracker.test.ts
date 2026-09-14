import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ActiveTimeTracker } from '../../dist/chrome/background/tracker.js';
import { ExtensionStorage } from '../../dist/chrome/storage/storage.js';
import { MomentDecisionEngine } from '../../dist/chrome/core/decisions/engine.js';
import { CHROME_DESKTOP_CAPABILITIES } from '../../dist/chrome/browser/capabilities.js';
import type { BrowserAdapter, TabInfo, NavigationEvent } from '../../src/browser/adapter.js';
import type { Collection } from '../../src/core/models/collection.js';
import { getLocalDateKey, getUsageRecordKey } from '../../dist/chrome/core/usage/accounting.js';

class MockBrowserAdapter implements BrowserAdapter {
  currentTab: TabInfo | null = null;
  tabsMap: Map<number, TabInfo> = new Map();
  focusedWindowId: number = 1;

  tabActivatedListeners: Array<(info: { tabId: number; windowId: number }) => void> = [];
  windowFocusListeners: Array<(windowId: number) => void> = [];
  navigationListeners: Array<(nav: NavigationEvent) => void> = [];
  tabRemovedListeners: Array<(tabId: number) => void> = [];

  getCapabilities() {
    return CHROME_DESKTOP_CAPABILITIES;
  }

  async getCurrentTab(): Promise<TabInfo | null> {
    if (this.focusedWindowId === -1) {
      return null;
    }
    for (const tab of this.tabsMap.values()) {
      if (tab.windowId === this.focusedWindowId && tab.active) {
        return tab;
      }
    }
    return this.currentTab;
  }

  setFocusedWindow(windowId: number) {
    this.focusedWindowId = windowId;
    if (windowId === -1) {
      this.currentTab = null;
    } else {
      for (const tab of this.tabsMap.values()) {
        if (tab.windowId === windowId && tab.active) {
          this.currentTab = tab;
          break;
        }
      }
    }
  }

  async getTab(tabId: number): Promise<TabInfo | null> {
    return this.tabsMap.get(tabId) || null;
  }

  async updateTab(_tabId: number, _props: any): Promise<void> {}
  async createTab(props: any): Promise<TabInfo> {
    const tab: TabInfo = { id: 999, url: props.url, active: true, incognito: false, windowId: 1 };
    return tab;
  }
  async removeTab(_tabId: number): Promise<void> {}
  async getAllTabs(): Promise<TabInfo[]> {
    return Array.from(this.tabsMap.values());
  }

  onNavigation(listener: (nav: NavigationEvent) => void) {
    this.navigationListeners.push(listener);
    return () => {
      this.navigationListeners = this.navigationListeners.filter((l) => l !== listener);
    };
  }

  onNavigationCommitted(_listener: (nav: NavigationEvent) => void) {
    return () => {};
  }

  onHistoryStateUpdated(_listener: (nav: NavigationEvent) => void) {
    return () => {};
  }

  onTabActivated(listener: (info: { tabId: number; windowId: number }) => void) {
    this.tabActivatedListeners.push(listener);
    return () => {
      this.tabActivatedListeners = this.tabActivatedListeners.filter((l) => l !== listener);
    };
  }

  onTabRemoved(listener: (tabId: number) => void) {
    this.tabRemovedListeners.push(listener);
    return () => {
      this.tabRemovedListeners = this.tabRemovedListeners.filter((l) => l !== listener);
    };
  }

  onWindowFocusChanged(listener: (windowId: number) => void) {
    this.windowFocusListeners.push(listener);
    return () => {
      this.windowFocusListeners = this.windowFocusListeners.filter((l) => l !== listener);
    };
  }

  createAlarm(_name: string, _alarmInfo: { when?: number; periodInMinutes?: number }): void {}
  async clearAlarm(_name: string): Promise<void> {}
  onAlarm(_listener: (name: string) => void) {
    return () => {};
  }

  getExtensionUrl(path: string) {
    return `chrome-extension://test/${path}`;
  }

  async isIncognitoAccessAllowed() {
    return false;
  }

  setTab(tab: TabInfo) {
    this.tabsMap.set(tab.id, tab);
    if (tab.active) {
      this.currentTab = tab;
    }
  }
}

describe('Moment Background Active Time Tracker (Phase 4)', () => {
  let adapter: MockBrowserAdapter;
  let storage: ExtensionStorage;
  let engine: MomentDecisionEngine;
  let tracker: ActiveTimeTracker;
  let currentMockTime: number;
  const clock = () => currentMockTime;

  const colSocial: Collection = {
    id: 'col_social',
    name: 'Social Media',
    color: '#2e7d32',
    icon: 'shield',
    enabled: true,
    createdAt: 1000,
    updatedAt: 1000,
    dailyLimitMs: 30 * 60 * 1000, // 30 minutes
    targets: [
      {
        id: 't_reddit',
        pattern: 'reddit.com',
        type: 'WEBSITE',
        isException: false,
        priority: 0,
        createdAt: 1000,
      },
      {
        id: 't_twitter',
        pattern: 'x.com',
        type: 'WEBSITE',
        isException: false,
        priority: 0,
        createdAt: 1000,
      },
    ],
    boundary: {
      schedule: { enabled: false, intervals: [] },
      limits: { dailyMinutes: null, sessionMinutes: null },
      pause: { type: 'BREATHE', durationSeconds: 10, requireIntentionText: false },
      action: { type: 'BLOCK_PAGE', redirectUrl: null },
      strictMode: false,
    },
  };

  const colVideo: Collection = {
    id: 'col_video',
    name: 'Streaming Video',
    color: '#1565c0',
    icon: 'video',
    enabled: true,
    createdAt: 1000,
    updatedAt: 1000,
    dailyLimitMs: 60 * 60 * 1000, // 60 minutes
    targets: [
      {
        id: 't_youtube',
        pattern: 'youtube.com',
        type: 'WEBSITE',
        isException: false,
        priority: 0,
        createdAt: 1000,
      },
    ],
    boundary: {
      schedule: { enabled: false, intervals: [] },
      limits: { dailyMinutes: null, sessionMinutes: null },
      pause: { type: 'BREATHE', durationSeconds: 10, requireIntentionText: false },
      action: { type: 'BLOCK_PAGE', redirectUrl: null },
      strictMode: false,
    },
  };

  async function setup(): Promise<void> {
    currentMockTime = new Date(2026, 8, 8, 10, 0, 0).getTime();
    adapter = new MockBrowserAdapter();
    storage = new ExtensionStorage();
    engine = new MomentDecisionEngine([colSocial, colVideo]);

    await storage.updateState((draft: any) => {
      draft.collections[colSocial.id] = colSocial;
      draft.collections[colVideo.id] = colVideo;
    });

    tracker = new ActiveTimeTracker(storage, adapter, engine, clock);
  }

  it('Initializes and reconciles active tab on boot', async () => {
    await setup();
    adapter.setTab({
      id: 10,
      url: 'https://reddit.com/r/programming',
      active: true,
      incognito: false,
      windowId: 1,
    });

    await tracker.initialize();
    const state = tracker.getState();

    assert.equal(state.activeTabId, 10);
    assert.equal(state.activeWindowId, 1);
    assert.equal(state.isWindowFocused, true);
    assert.equal(state.activeCollectionId, 'col_social');
    assert.equal(state.lastCheckpointTimestamp, currentMockTime);

    tracker.dispose();
  });

  it('Single active tab accounting: Switching tabs flushes old tab and tracks new collection', async () => {
    await setup();
    adapter.setTab({
      id: 1,
      url: 'https://reddit.com',
      active: true,
      incognito: false,
      windowId: 1,
    });
    adapter.setTab({
      id: 2,
      url: 'https://youtube.com',
      active: false,
      incognito: false,
      windowId: 1,
    });

    await tracker.initialize();

    // 10 seconds pass on Reddit
    currentMockTime += 10_000;

    // Switch to YouTube tab
    adapter.setTab({
      id: 2,
      url: 'https://youtube.com',
      active: true,
      incognito: false,
      windowId: 1,
    });
    await tracker.handleTabActivated({ tabId: 2, windowId: 1 });

    // 15 seconds pass on YouTube
    currentMockTime += 15_000;
    await tracker.flush(currentMockTime);

    const storedState = await storage.getState();
    const dateKey = getLocalDateKey(new Date(currentMockTime));

    const socialUsage = storedState.usage[getUsageRecordKey(dateKey, 'col_social')];
    const videoUsage = storedState.usage[getUsageRecordKey(dateKey, 'col_video')];

    assert.ok(socialUsage);
    assert.equal(socialUsage.accumulatedMs, 10_000); // 10s on Reddit

    assert.ok(videoUsage);
    assert.equal(videoUsage.accumulatedMs, 15_000); // 15s on YouTube

    tracker.dispose();
  });

  it('Window focus and blur: Stops accumulation when window is blurred', async () => {
    await setup();
    adapter.setTab({
      id: 1,
      url: 'https://reddit.com',
      active: true,
      incognito: false,
      windowId: 1,
    });

    await tracker.initialize();

    // 5 seconds active while focused
    currentMockTime += 5_000;
    await tracker.handleWindowFocusChanged(-1);

    // 30 seconds elapse while window is unfocused (e.g. user in another desktop app)
    currentMockTime += 30_000;
    await tracker.flush(currentMockTime);

    // Window regains focus
    await tracker.handleWindowFocusChanged(1);

    // Another 5 seconds active while focused
    currentMockTime += 5_000;
    await tracker.flush(currentMockTime);

    const storedState = await storage.getState();
    const dateKey = getLocalDateKey(new Date(currentMockTime));
    const socialUsage = storedState.usage[getUsageRecordKey(dateKey, 'col_social')];

    // Total should be 10 seconds (5s before blur + 5s after focus return), 0 during the 30s blur!
    assert.ok(socialUsage);
    assert.equal(socialUsage.accumulatedMs, 10_000);

    tracker.dispose();
  });

  it('Sleep discontinuity clamping: 3-hour sleep is clamped to 60s max delta', async () => {
    await setup();
    adapter.setTab({
      id: 1,
      url: 'https://reddit.com',
      active: true,
      incognito: false,
      windowId: 1,
    });

    await tracker.initialize();

    // 3 hours pass (laptop lid closed / system sleep)
    currentMockTime += 3 * 60 * 60 * 1000;
    await tracker.flush(currentMockTime);

    const storedState = await storage.getState();
    const dateKey = getLocalDateKey(new Date(currentMockTime));
    const socialUsage = storedState.usage[getUsageRecordKey(dateKey, 'col_social')];

    assert.ok(socialUsage);
    // Capped to 60,000 ms (MAX_DISCRETE_ACTIVE_DELTA_MS), not 10,800,000 ms
    assert.equal(socialUsage.accumulatedMs, 60_000);

    tracker.dispose();
  });

  it('Clock rollback defense: Negative delta does not corrupt or deduct usage', async () => {
    await setup();
    adapter.setTab({
      id: 1,
      url: 'https://reddit.com',
      active: true,
      incognito: false,
      windowId: 1,
    });

    await tracker.initialize();

    // 10 seconds of legitimate browsing
    currentMockTime += 10_000;
    await tracker.flush(currentMockTime);

    // System clock moves backwards
    currentMockTime -= 50_000;
    await tracker.flush(currentMockTime);

    const storedState = await storage.getState();
    const dateKey = getLocalDateKey(new Date(currentMockTime + 50_000));
    const socialUsage = storedState.usage[getUsageRecordKey(dateKey, 'col_social')];

    assert.ok(socialUsage);
    assert.equal(socialUsage.accumulatedMs, 10_000);

    tracker.dispose();
  });

  it('Tab closed: Flushes accumulated time up to closure and stops tracking', async () => {
    await setup();
    adapter.setTab({
      id: 1,
      url: 'https://reddit.com',
      active: true,
      incognito: false,
      windowId: 1,
    });

    await tracker.initialize();

    // Close tab after 7 seconds
    currentMockTime += 7_000;
    await tracker.handleTabRemoved(1);

    const storedState = await storage.getState();
    const dateKey = getLocalDateKey(new Date(currentMockTime));
    const socialUsage = storedState.usage[getUsageRecordKey(dateKey, 'col_social')];

    assert.ok(socialUsage);
    assert.equal(socialUsage.accumulatedMs, 7_000);

    const state = tracker.getState();
    assert.equal(state.activeTabId, null);
    assert.equal(state.activeCollectionId, null);

    tracker.dispose();
  });

  it('Navigation on active tab: Moving from tracked to untracked stops accumulation', async () => {
    await setup();
    adapter.setTab({
      id: 1,
      url: 'https://reddit.com',
      active: true,
      incognito: false,
      windowId: 1,
    });

    await tracker.initialize();

    // 12s on Reddit
    currentMockTime += 12_000;
    await tracker.handleNavigation({
      tabId: 1,
      url: 'https://wikipedia.org',
      frameId: 0,
      timestamp: currentMockTime,
    });

    const stateAfterNav = tracker.getState();
    assert.equal(stateAfterNav.activeCollectionId, null); // Wikipedia matches no collection

    // 20s on Wikipedia
    currentMockTime += 20_000;
    await tracker.flush(currentMockTime);

    const storedState = await storage.getState();
    const dateKey = getLocalDateKey(new Date(currentMockTime));
    const socialUsage = storedState.usage[getUsageRecordKey(dateKey, 'col_social')];

    assert.ok(socialUsage);
    assert.equal(socialUsage.accumulatedMs, 12_000); // Only the 12s on Reddit counted

    tracker.dispose();
  });

  it('Local midnight rollover: Accurately splits interval spanning midnight across date keys', async () => {
    await setup();
    adapter.setTab({
      id: 1,
      url: 'https://reddit.com',
      active: true,
      incognito: false,
      windowId: 1,
    });

    // 23:59:45 on Sept 8, 2026
    currentMockTime = new Date(2026, 8, 8, 23, 59, 45).getTime();
    await tracker.initialize();

    // 30 seconds pass (crossing midnight to 00:00:15 on Sept 9)
    currentMockTime = new Date(2026, 8, 9, 0, 0, 15).getTime();
    await tracker.flush(currentMockTime);

    const storedState = await storage.getState();
    const yesterdayUsage = storedState.usage[getUsageRecordKey('2026-09-08', 'col_social')];
    const todayUsage = storedState.usage[getUsageRecordKey('2026-09-09', 'col_social')];

    assert.ok(yesterdayUsage);
    assert.equal(yesterdayUsage.accumulatedMs, 15_000); // 15s before midnight

    assert.ok(todayUsage);
    assert.equal(todayUsage.accumulatedMs, 15_000); // 15s after midnight

    tracker.dispose();
  });

  it('Provides accurate TabUsageSummary via getUsageForTab', async () => {
    await setup();
    adapter.setTab({
      id: 1,
      url: 'https://reddit.com/r/technology',
      active: true,
      incognito: false,
      windowId: 1,
    });

    await tracker.initialize();

    // Pre-populate 10 minutes of usage in storage
    const today = getLocalDateKey(new Date(currentMockTime));
    await storage.updateState((draft: any) => {
      draft.usage[getUsageRecordKey(today, 'col_social')] = {
        dateKey: today,
        collectionId: 'col_social',
        accumulatedMs: 10 * 60 * 1000,
        updatedAt: currentMockTime,
      };
    });

    const summary = await tracker.getUsageForTab(1);

    assert.equal(summary.tabId, 1);
    assert.equal(summary.collectionId, 'col_social');
    assert.equal(summary.collectionName, 'Social Media');
    assert.equal(summary.dailyLimitMs, 30 * 60 * 1000);
    assert.equal(summary.usedMs, 10 * 60 * 1000);
    assert.equal(summary.remainingMs, 20 * 60 * 1000);
    assert.equal(summary.isExhausted, false);
    assert.equal(summary.formattedUsed, '10m');
    assert.equal(summary.formattedLimit, '30m');
    assert.equal(summary.formattedRemaining, '20m');

    tracker.dispose();
  });

  it('Provides accurate CollectionUsageSummary via getUsageForCollection', async () => {
    await setup();
    const today = getLocalDateKey(new Date(currentMockTime));
    await storage.updateState((draft: any) => {
      draft.usage[getUsageRecordKey(today, 'col_video')] = {
        dateKey: today,
        collectionId: 'col_video',
        accumulatedMs: 65 * 60 * 1000, // 65m on 60m limit
        updatedAt: currentMockTime,
      };
    });

    const summary = await tracker.getUsageForCollection('col_video');

    assert.equal(summary.collectionId, 'col_video');
    assert.equal(summary.collectionName, 'Streaming Video');
    assert.equal(summary.dailyLimitMs, 60 * 60 * 1000);
    assert.equal(summary.usedMs, 65 * 60 * 1000);
    assert.equal(summary.remainingMs, 0);
    assert.equal(summary.isExhausted, true);
    assert.equal(summary.formattedUsed, '1h 5m');
    assert.equal(summary.formattedLimit, '1h');
    assert.equal(summary.formattedRemaining, '0m');

    tracker.dispose();
  });

  describe('Phase 4.1 Audit 4: Active Context Exclusivity & Event Ordering', () => {
    it('Event Ordering: A active -> B activated -> B focused', async () => {
      await setup();
      adapter.setTab({ id: 1, url: 'https://reddit.com', active: true, incognito: false, windowId: 1 });
      adapter.setTab({ id: 2, url: 'https://youtube.com', active: false, incognito: false, windowId: 1 });
      await tracker.initialize();

      // 10s on Reddit
      currentMockTime += 10_000;

      // B activated in Window 1
      adapter.setTab({ id: 1, url: 'https://reddit.com', active: false, incognito: false, windowId: 1 });
      adapter.setTab({ id: 2, url: 'https://youtube.com', active: true, incognito: false, windowId: 1 });
      await tracker.handleTabActivated({ tabId: 2, windowId: 1 });

      // 15s on YouTube
      currentMockTime += 15_000;
      await tracker.flush(currentMockTime);

      const stored = await storage.getState();
      const today = getLocalDateKey(new Date(currentMockTime));
      assert.equal(stored.usage[getUsageRecordKey(today, 'col_social')]?.accumulatedMs, 10_000);
      assert.equal(stored.usage[getUsageRecordKey(today, 'col_video')]?.accumulatedMs, 15_000);

      tracker.dispose();
    });

    it('Event Ordering: A active -> window blur -> B activated -> window focus', async () => {
      await setup();
      adapter.setTab({ id: 1, url: 'https://reddit.com', active: true, incognito: false, windowId: 1 });
      adapter.setTab({ id: 2, url: 'https://youtube.com', active: false, incognito: false, windowId: 1 });
      await tracker.initialize();

      // 8s on Reddit
      currentMockTime += 8_000;

      // Window blur
      adapter.setFocusedWindow(-1);
      await tracker.handleWindowFocusChanged(-1);

      // 40s pass while blurred
      currentMockTime += 40_000;

      // Tab B activated while blurred
      adapter.setTab({ id: 1, url: 'https://reddit.com', active: false, incognito: false, windowId: 1 });
      adapter.setTab({ id: 2, url: 'https://youtube.com', active: true, incognito: false, windowId: 1 });
      await tracker.handleTabActivated({ tabId: 2, windowId: 1 });

      // Window focus returns
      adapter.setFocusedWindow(1);
      await tracker.handleWindowFocusChanged(1);

      // 12s on YouTube
      currentMockTime += 12_000;
      await tracker.flush(currentMockTime);

      const stored = await storage.getState();
      const today = getLocalDateKey(new Date(currentMockTime));
      // col_social should have only 8s (0 during blur)
      assert.equal(stored.usage[getUsageRecordKey(today, 'col_social')]?.accumulatedMs, 8_000);
      // col_video should have only 12s (0 during blur)
      assert.equal(stored.usage[getUsageRecordKey(today, 'col_video')]?.accumulatedMs, 12_000);

      tracker.dispose();
    });

    it('Event Ordering: A active -> window focus changes -> A remains active', async () => {
      await setup();
      adapter.setTab({ id: 1, url: 'https://reddit.com', active: true, incognito: false, windowId: 1 });
      await tracker.initialize();

      // 5s on Reddit
      currentMockTime += 5_000;

      // Window blur
      adapter.setFocusedWindow(-1);
      await tracker.handleWindowFocusChanged(-1);

      // 25s elapsed while blurred
      currentMockTime += 25_000;

      // Focus returns to Window 1 where Tab 1 is still active
      adapter.setFocusedWindow(1);
      await tracker.handleWindowFocusChanged(1);

      // 7s on Reddit
      currentMockTime += 7_000;
      await tracker.flush(currentMockTime);

      const stored = await storage.getState();
      const today = getLocalDateKey(new Date(currentMockTime));
      // Total 5s + 7s = 12s (no accumulation during the 25s blur)
      assert.equal(stored.usage[getUsageRecordKey(today, 'col_social')]?.accumulatedMs, 12_000);

      tracker.dispose();
    });

    it('Event Ordering: Rapid A -> B -> A -> B tab switches', async () => {
      await setup();
      adapter.setTab({ id: 1, url: 'https://reddit.com', active: true, incognito: false, windowId: 1 });
      adapter.setTab({ id: 2, url: 'https://youtube.com', active: false, incognito: false, windowId: 1 });
      await tracker.initialize();

      // A: 2s
      currentMockTime += 2_000;
      adapter.setTab({ id: 1, url: 'https://reddit.com', active: false, incognito: false, windowId: 1 });
      adapter.setTab({ id: 2, url: 'https://youtube.com', active: true, incognito: false, windowId: 1 });
      await tracker.handleTabActivated({ tabId: 2, windowId: 1 });

      // B: 2s
      currentMockTime += 2_000;
      adapter.setTab({ id: 2, url: 'https://youtube.com', active: false, incognito: false, windowId: 1 });
      adapter.setTab({ id: 1, url: 'https://reddit.com', active: true, incognito: false, windowId: 1 });
      await tracker.handleTabActivated({ tabId: 1, windowId: 1 });

      // A: 2s
      currentMockTime += 2_000;
      adapter.setTab({ id: 1, url: 'https://reddit.com', active: false, incognito: false, windowId: 1 });
      adapter.setTab({ id: 2, url: 'https://youtube.com', active: true, incognito: false, windowId: 1 });
      await tracker.handleTabActivated({ tabId: 2, windowId: 1 });

      // B: 2s
      currentMockTime += 2_000;
      await tracker.flush(currentMockTime);

      const stored = await storage.getState();
      const today = getLocalDateKey(new Date(currentMockTime));
      // A (Reddit): 2s + 2s = 4s
      assert.equal(stored.usage[getUsageRecordKey(today, 'col_social')]?.accumulatedMs, 4_000);
      // B (YouTube): 2s + 2s = 4s
      assert.equal(stored.usage[getUsageRecordKey(today, 'col_video')]?.accumulatedMs, 4_000);

      tracker.dispose();
    });
  });

  describe('Phase 4.1 Audit 5: Multi-Window Accounting', () => {
    it('Window A focused with Tab A, Window B unfocused with Tab B -> only A accumulates, then switch to B', async () => {
      await setup();
      // Window 1 has Tab 1 (Reddit)
      adapter.setTab({ id: 1, url: 'https://reddit.com', active: true, incognito: false, windowId: 1 });
      // Window 2 has Tab 2 (YouTube)
      adapter.setTab({ id: 2, url: 'https://youtube.com', active: true, incognito: false, windowId: 2 });

      adapter.setFocusedWindow(1);
      await tracker.initialize();

      // 10s pass while Window 1 is focused
      currentMockTime += 10_000;

      // Focus moves to Window 2
      adapter.setFocusedWindow(2);
      await tracker.handleWindowFocusChanged(2);

      // 10s pass while Window 2 is focused
      currentMockTime += 10_000;
      await tracker.flush(currentMockTime);

      const stored = await storage.getState();
      const today = getLocalDateKey(new Date(currentMockTime));

      assert.equal(stored.usage[getUsageRecordKey(today, 'col_social')]?.accumulatedMs, 10_000);
      assert.equal(stored.usage[getUsageRecordKey(today, 'col_video')]?.accumulatedMs, 10_000);

      tracker.dispose();
    });
  });

  describe('Phase 4.1 Audit 6: Navigation Accounting Boundary', () => {
    it('Collection A -> unrestricted page -> Collection B attributes time cleanly', async () => {
      await setup();
      adapter.setTab({ id: 1, url: 'https://reddit.com', active: true, incognito: false, windowId: 1 });
      await tracker.initialize();

      // 10s on Reddit
      currentMockTime += 10_000;
      await tracker.handleNavigation({
        tabId: 1,
        url: 'https://wikipedia.org',
        frameId: 0,
        timestamp: currentMockTime,
      });

      // 20s on Wikipedia (unrestricted)
      currentMockTime += 20_000;
      await tracker.handleNavigation({
        tabId: 1,
        url: 'https://youtube.com',
        frameId: 0,
        timestamp: currentMockTime,
      });

      // 15s on YouTube
      currentMockTime += 15_000;
      await tracker.flush(currentMockTime);

      const stored = await storage.getState();
      const today = getLocalDateKey(new Date(currentMockTime));

      assert.equal(stored.usage[getUsageRecordKey(today, 'col_social')]?.accumulatedMs, 10_000);
      assert.equal(stored.usage[getUsageRecordKey(today, 'col_video')]?.accumulatedMs, 15_000);

      tracker.dispose();
    });
  });

  describe('Phase 4.1 Audit 7: Tab Close Flush Semantics', () => {
    it('Closing inactive tab does not flush active tab or disrupt tracking', async () => {
      await setup();
      adapter.setTab({ id: 1, url: 'https://reddit.com', active: true, incognito: false, windowId: 1 });
      adapter.setTab({ id: 2, url: 'https://youtube.com', active: false, incognito: false, windowId: 1 });
      await tracker.initialize();

      // 5s pass on Reddit
      currentMockTime += 5_000;

      // Close inactive Tab 2
      await tracker.handleTabRemoved(2);

      // Active state should remain Tab 1 (Reddit)
      const state = tracker.getState();
      assert.equal(state.activeTabId, 1);
      assert.equal(state.activeCollectionId, 'col_social');

      // 5s more on Reddit
      currentMockTime += 5_000;
      await tracker.flush(currentMockTime);

      const stored = await storage.getState();
      const today = getLocalDateKey(new Date(currentMockTime));
      assert.equal(stored.usage[getUsageRecordKey(today, 'col_social')]?.accumulatedMs, 10_000);

      tracker.dispose();
    });

    it('Closing active tab in unfocused window flushes 0 extra delta and clears tracking', async () => {
      await setup();
      adapter.setTab({ id: 1, url: 'https://reddit.com', active: true, incognito: false, windowId: 1 });
      await tracker.initialize();

      // 6s on Reddit
      currentMockTime += 6_000;

      // Window blur
      adapter.setFocusedWindow(-1);
      await tracker.handleWindowFocusChanged(-1);

      // 10s pass while blurred
      currentMockTime += 10_000;

      // Tab closed while window is still blurred
      await tracker.handleTabRemoved(1);

      const state = tracker.getState();
      assert.equal(state.activeTabId, null);
      assert.equal(state.activeCollectionId, null);

      // Flush again to verify no duplicate flush occurs
      await tracker.flush(currentMockTime);

      const stored = await storage.getState();
      const today = getLocalDateKey(new Date(currentMockTime));
      assert.equal(stored.usage[getUsageRecordKey(today, 'col_social')]?.accumulatedMs, 6_000);

      tracker.dispose();
    });
  });

  describe('Phase 4.1 Audit 8: Midnight Rollover & Worker Restart', () => {
    it('Worker restart immediately across local midnight splits time cleanly', async () => {
      await setup();
      adapter.setTab({ id: 1, url: 'https://reddit.com', active: true, incognito: false, windowId: 1 });

      // 23:59:50 on Sept 8
      currentMockTime = new Date(2026, 8, 8, 23, 59, 50).getTime();
      await tracker.initialize();

      // 20 seconds elapse (crossing midnight to 00:00:10 on Sept 9)
      currentMockTime = new Date(2026, 8, 9, 0, 0, 10).getTime();

      // Worker suspension / restart simulation at 00:00:10
      await tracker.flush(currentMockTime);
      tracker.dispose();

      // New worker boots at 00:00:10 with fresh tracker instance sharing same storage
      const tracker2 = new ActiveTimeTracker(storage, adapter, engine, clock);
      await tracker2.initialize();

      // 10 seconds elapse on the new day
      currentMockTime += 10_000;
      await tracker2.flush(currentMockTime);

      const stored = await storage.getState();
      const yesterday = stored.usage[getUsageRecordKey('2026-09-08', 'col_social')];
      const today = stored.usage[getUsageRecordKey('2026-09-09', 'col_social')];

      assert.ok(yesterday);
      assert.equal(yesterday.accumulatedMs, 10_000); // 10s before midnight

      assert.ok(today);
      assert.equal(today.accumulatedMs, 20_000); // 10s before restart + 10s after restart

      tracker2.dispose();
    });
  });

  describe('Phase 4.1 Audit 12: Intent Pass Usage Accounting', () => {
    it('Time spent browsing under an active Intent Pass is accurately accumulated to the collection', async () => {
      await setup();
      adapter.setTab({ id: 1, url: 'https://reddit.com/r/technology', active: true, incognito: false, windowId: 1 });

      // Initial state: 29 minutes used out of 30 minute limit
      const today = getLocalDateKey(new Date(currentMockTime));
      await storage.updateState((draft: any) => {
        draft.usage[getUsageRecordKey(today, 'col_social')] = {
          dateKey: today,
          collectionId: 'col_social',
          accumulatedMs: 29 * 60 * 1000,
          updatedAt: currentMockTime,
        };
      });

      await tracker.initialize();

      // User spends 5 minutes browsing under an active Intent Pass (flushed periodically in 30s steps)
      for (let i = 0; i < 10; i++) {
        currentMockTime += 30_000;
        await tracker.flush(currentMockTime);
      }

      const stored = await storage.getState();
      const record = stored.usage[getUsageRecordKey(today, 'col_social')];

      // Usage MUST be 34 minutes (29m + 5m) - grant did NOT hide or erase active time!
      assert.ok(record);
      assert.equal(record.accumulatedMs, 34 * 60 * 1000);

      // Verify Tab Usage Summary reflects over-limit state correctly
      const summary = await tracker.getUsageForTab(1);
      assert.equal(summary.usedMs, 34 * 60 * 1000);
      assert.equal(summary.remainingMs, 0);
      assert.equal(summary.isExhausted, true);
      assert.equal(summary.formattedUsed, '34m');
      assert.equal(summary.formattedRemaining, '0m');

      tracker.dispose();
    });
  });

  describe('Phase 4.1 Audit 14: Simulated Service Worker Restart (5 Scenarios)', () => {
    it('Scenario 1: Worker restart while active tab is tracked preserves state without double counting', async () => {
      await setup();
      adapter.setTab({ id: 1, url: 'https://reddit.com', active: true, incognito: false, windowId: 1 });
      await tracker.initialize();

      // 10s on Reddit
      currentMockTime += 10_000;
      await tracker.flush(currentMockTime);
      tracker.dispose(); // Worker suspended

      // 5s suspension gap (worker is dormant)
      currentMockTime += 5_000;

      // Worker restarted with fresh tracker instance
      const tracker2 = new ActiveTimeTracker(storage, adapter, engine, clock);
      await tracker2.initialize();

      // 15s more on Reddit after worker restart
      currentMockTime += 15_000;
      await tracker2.flush(currentMockTime);

      const stored = await storage.getState();
      const today = getLocalDateKey(new Date(currentMockTime));
      // Total should be 10s + 15s = 25s (dormant 5s gap not counted)
      assert.equal(stored.usage[getUsageRecordKey(today, 'col_social')]?.accumulatedMs, 25_000);

      tracker2.dispose();
    });

    it('Scenario 2: Worker restart while tab is inactive/untracked does not accumulate time', async () => {
      await setup();
      adapter.setTab({ id: 1, url: 'https://wikipedia.org', active: true, incognito: false, windowId: 1 });
      await tracker.initialize();

      // 10s on Wikipedia
      currentMockTime += 10_000;
      tracker.dispose();

      // Worker restart
      const tracker2 = new ActiveTimeTracker(storage, adapter, engine, clock);
      await tracker2.initialize();

      // 20s on Wikipedia
      currentMockTime += 20_000;
      await tracker2.flush(currentMockTime);

      const stored = await storage.getState();
      const today = getLocalDateKey(new Date(currentMockTime));
      assert.equal(stored.usage[getUsageRecordKey(today, 'col_social')], undefined);

      tracker2.dispose();
    });

    it('Scenario 3: Worker restart while window is unfocused does not accumulate time', async () => {
      await setup();
      adapter.setTab({ id: 1, url: 'https://reddit.com', active: true, incognito: false, windowId: 1 });
      adapter.setFocusedWindow(-1);
      await tracker.initialize();

      // 10s pass while unfocused
      currentMockTime += 10_000;
      tracker.dispose();

      // Worker restart with unfocused window
      const tracker2 = new ActiveTimeTracker(storage, adapter, engine, clock);
      await tracker2.initialize();

      currentMockTime += 20_000;
      await tracker2.flush(currentMockTime);

      const stored = await storage.getState();
      const today = getLocalDateKey(new Date(currentMockTime));
      assert.equal(stored.usage[getUsageRecordKey(today, 'col_social')], undefined);

      tracker2.dispose();
    });

    it('Scenario 4: Worker restart when usage limit is nearly exhausted preserves budget', async () => {
      await setup();
      const today = getLocalDateKey(new Date(currentMockTime));
      await storage.updateState((draft: any) => {
        draft.usage[getUsageRecordKey(today, 'col_social')] = {
          dateKey: today,
          collectionId: 'col_social',
          accumulatedMs: 29 * 60 * 1000, // 29m of 30m limit
          updatedAt: currentMockTime,
        };
      });

      adapter.setTab({ id: 1, url: 'https://reddit.com', active: true, incognito: false, windowId: 1 });

      // Worker boots
      const tracker2 = new ActiveTimeTracker(storage, adapter, engine, clock);
      await tracker2.initialize();

      const initialSummary = await tracker2.getUsageForTab(1);
      assert.equal(initialSummary.usedMs, 29 * 60 * 1000);
      assert.equal(initialSummary.remainingMs, 1 * 60 * 1000);
      assert.equal(initialSummary.isExhausted, false);

      // Browse 2 minutes (crosses limit, 4 x 30s steps)
      for (let i = 0; i < 4; i++) {
        currentMockTime += 30_000;
        await tracker2.flush(currentMockTime);
      }

      const postSummary = await tracker2.getUsageForTab(1);
      assert.equal(postSummary.usedMs, 31 * 60 * 1000);
      assert.equal(postSummary.remainingMs, 0);
      assert.equal(postSummary.isExhausted, true);

      tracker2.dispose();
    });

    it('Scenario 5: Worker restart when usage limit is already exhausted preserves exhausted status', async () => {
      await setup();
      const today = getLocalDateKey(new Date(currentMockTime));
      await storage.updateState((draft: any) => {
        draft.usage[getUsageRecordKey(today, 'col_social')] = {
          dateKey: today,
          collectionId: 'col_social',
          accumulatedMs: 40 * 60 * 1000, // 40m of 30m limit
          updatedAt: currentMockTime,
        };
      });

      adapter.setTab({ id: 1, url: 'https://reddit.com', active: true, incognito: false, windowId: 1 });

      // Worker boots
      const tracker2 = new ActiveTimeTracker(storage, adapter, engine, clock);
      await tracker2.initialize();

      const summary = await tracker2.getUsageForTab(1);
      assert.equal(summary.usedMs, 40 * 60 * 1000);
      assert.equal(summary.remainingMs, 0);
      assert.equal(summary.isExhausted, true);
      assert.equal(summary.formattedUsed, '40m');
      assert.equal(summary.formattedRemaining, '0m');

      tracker2.dispose();
    });
  });

  describe('Phase 4.1 Audit 15 & 16: Clock Rollback & Forward Discontinuity in Tracker', () => {
    it('Audit 15: 10:00 -> 10:05 (5m) -> rollback to 09:00 -> 2m at 09:02 -> total 7m without negative usage', async () => {
      await setup();
      adapter.setTab({ id: 1, url: 'https://reddit.com', active: true, incognito: false, windowId: 1 });
      await tracker.initialize();

      // 5 minutes of legitimate browsing (10 x 30s steps)
      for (let i = 0; i < 10; i++) {
        currentMockTime += 30_000;
        await tracker.flush(currentMockTime);
      }

      // System clock rolls back 65 minutes
      currentMockTime -= 65 * 60 * 1000;
      await tracker.flush(currentMockTime); // Handled safely (0 delta, checkpoint updated)

      // 2 minutes of browsing after rollback (4 x 30s steps)
      for (let i = 0; i < 4; i++) {
        currentMockTime += 30_000;
        await tracker.flush(currentMockTime);
      }

      const stored = await storage.getState();
      const today = getLocalDateKey(new Date(currentMockTime));
      const record = stored.usage[getUsageRecordKey(today, 'col_social')];

      assert.ok(record);
      assert.equal(record.accumulatedMs, 7 * 60 * 1000); // 5m + 0 + 2m = 7m

      tracker.dispose();
    });

    it('Audit 16: Clock forward jump of 3 hours is clamped to 60 seconds', async () => {
      await setup();
      adapter.setTab({ id: 1, url: 'https://reddit.com', active: true, incognito: false, windowId: 1 });
      await tracker.initialize();

      // 1 minute of browsing
      currentMockTime += 60_000;
      await tracker.flush(currentMockTime);

      // Clock jumps 3 hours forward
      currentMockTime += 3 * 60 * 60 * 1000;
      await tracker.flush(currentMockTime);

      const stored = await storage.getState();
      const today = getLocalDateKey(new Date(currentMockTime));
      const record = stored.usage[getUsageRecordKey(today, 'col_social')];

      assert.ok(record);
      // 1 minute initial + 60s clamped jump = 2 minutes (not 3 hours and 1 minute)
      assert.equal(record.accumulatedMs, 120_000);

      tracker.dispose();
    });
  });
});
