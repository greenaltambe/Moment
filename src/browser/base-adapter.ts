/**
 * Moment Shared Base Browser Adapter
 * Implements common WebExtensions APIs available across Chrome and Firefox.
 */

import { BrowserAdapter, NavigationEvent, TabInfo } from './adapter.js';
import { BrowserCapabilities } from './capabilities.js';
import '../shared/types.js';

function getApi(): any {
  if (typeof chrome !== 'undefined') return chrome;
  if (typeof browser !== 'undefined') return browser;
  return null;
}

export abstract class BaseBrowserAdapter implements BrowserAdapter {
  protected api: any;
  protected capabilities: BrowserCapabilities;

  constructor(capabilities: BrowserCapabilities) {
    this.api = getApi();
    this.capabilities = capabilities;
  }

  getCapabilities(): BrowserCapabilities {
    return this.capabilities;
  }

  async getCurrentTab(): Promise<TabInfo | null> {
    if (!this.api?.tabs?.query) return null;
    return new Promise((resolve) => {
      this.api.tabs.query({ active: true, currentWindow: true }, (tabs: any[]) => {
        if (tabs && tabs.length > 0) {
          const t = tabs[0];
          resolve({
            id: t.id ?? -1,
            url: t.url,
            title: t.title,
            active: t.active ?? false,
            incognito: t.incognito ?? false,
            windowId: t.windowId ?? -1,
          });
        } else {
          // Fallback to lastFocusedWindow for background workers / event pages without dedicated window context
          this.api.tabs.query({ active: true, lastFocusedWindow: true }, (fallbackTabs: any[]) => {
            if (!fallbackTabs || fallbackTabs.length === 0) resolve(null);
            else {
              const t = fallbackTabs[0];
              resolve({
                id: t.id ?? -1,
                url: t.url,
                title: t.title,
                active: t.active ?? false,
                incognito: t.incognito ?? false,
                windowId: t.windowId ?? -1,
              });
            }
          });
        }
      });
    });
  }

  async getTab(tabId: number): Promise<TabInfo | null> {
    if (!this.api?.tabs?.get) return null;
    return new Promise((resolve) => {
      this.api.tabs.get(tabId, (t: any) => {
        if (this.api.runtime.lastError || !t) resolve(null);
        else {
          resolve({
            id: t.id ?? -1,
            url: t.url,
            title: t.title,
            active: t.active ?? false,
            incognito: t.incognito ?? false,
            windowId: t.windowId ?? -1,
          });
        }
      });
    });
  }

  async getAllTabs(): Promise<TabInfo[]> {
    if (!this.api?.tabs?.query) return [];
    return new Promise((resolve) => {
      this.api.tabs.query({}, (tabs: any[]) => {
        if (this.api.runtime?.lastError || !tabs) resolve([]);
        else {
          resolve(
            tabs.map((t) => ({
              id: t.id ?? -1,
              url: t.url,
              title: t.title,
              active: t.active ?? false,
              incognito: t.incognito ?? false,
              windowId: t.windowId ?? -1,
            }))
          );
        }
      });
    });
  }

  async updateTab(tabId: number, properties: { url?: string; active?: boolean }): Promise<void> {
    if (!this.api?.tabs?.update) return;
    return new Promise((resolve, reject) => {
      this.api.tabs.update(tabId, properties, () => {
        if (this.api.runtime.lastError) {
          reject(new Error(this.api.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  async createTab(properties: { url: string; active?: boolean }): Promise<TabInfo> {
    if (!this.api?.tabs?.create) throw new Error('tabs.create API not available');
    return new Promise((resolve, reject) => {
      this.api.tabs.create(properties, (t: any) => {
        if (this.api.runtime.lastError || !t) {
          reject(new Error(this.api.runtime.lastError?.message || 'Failed to create tab'));
        } else {
          resolve({
            id: t.id ?? -1,
            url: t.url,
            title: t.title,
            active: t.active ?? false,
            incognito: t.incognito ?? false,
            windowId: t.windowId ?? -1,
          });
        }
      });
    });
  }

  async removeTab(tabId: number): Promise<void> {
    if (!this.api?.tabs?.remove) return;
    return new Promise((resolve) => {
      this.api.tabs.remove(tabId, () => resolve());
    });
  }

  onNavigation(listener: (nav: NavigationEvent) => void): () => void {
    if (!this.api?.webNavigation?.onBeforeNavigate) return () => {};
    const handler = (details: any) => {
      listener({
        tabId: details.tabId,
        url: details.url,
        frameId: details.frameId,
        timestamp: Date.now(),
      });
    };
    this.api.webNavigation.onBeforeNavigate.addListener(handler);
    return () => this.api.webNavigation.onBeforeNavigate.removeListener(handler);
  }

  onNavigationCommitted(listener: (nav: NavigationEvent) => void): () => void {
    if (!this.api?.webNavigation?.onCommitted) return () => {};
    const handler = (details: any) => {
      listener({
        tabId: details.tabId,
        url: details.url,
        frameId: details.frameId,
        timestamp: Date.now(),
      });
    };
    this.api.webNavigation.onCommitted.addListener(handler);
    return () => this.api.webNavigation.onCommitted.removeListener(handler);
  }

  onHistoryStateUpdated(listener: (nav: NavigationEvent) => void): () => void {
    if (!this.api?.webNavigation?.onHistoryStateUpdated) return () => {};
    const handler = (details: any) => {
      listener({
        tabId: details.tabId,
        url: details.url,
        frameId: details.frameId,
        timestamp: Date.now(),
      });
    };
    this.api.webNavigation.onHistoryStateUpdated.addListener(handler);
    return () => this.api.webNavigation.onHistoryStateUpdated.removeListener(handler);
  }

  onTabActivated(listener: (activeInfo: { tabId: number; windowId: number }) => void): () => void {
    if (!this.api?.tabs?.onActivated) return () => {};
    const handler = (info: any) => listener(info);
    this.api.tabs.onActivated.addListener(handler);
    return () => this.api.tabs.onActivated.removeListener(handler);
  }

  onTabRemoved(listener: (tabId: number) => void): () => void {
    if (!this.api?.tabs?.onRemoved) return () => {};
    const handler = (tabId: number) => listener(tabId);
    this.api.tabs.onRemoved.addListener(handler);
    return () => this.api.tabs.onRemoved.removeListener(handler);
  }

  onWindowFocusChanged(listener: (windowId: number) => void): () => void {
    if (!this.capabilities.supportsWindowFocus || !this.api?.windows?.onFocusChanged) {
      return () => {};
    }
    const handler = (winId: number) => listener(winId);
    this.api.windows.onFocusChanged.addListener(handler);
    return () => this.api.windows.onFocusChanged.removeListener(handler);
  }

  createAlarm(name: string, alarmInfo: { when?: number; periodInMinutes?: number }): void {
    if (this.api?.alarms?.create) {
      this.api.alarms.create(name, alarmInfo);
    }
  }

  async clearAlarm(name: string): Promise<void> {
    if (!this.api?.alarms?.clear) return;
    return new Promise((resolve) => {
      this.api.alarms.clear(name, () => resolve());
    });
  }

  onAlarm(listener: (name: string) => void): () => void {
    if (!this.api?.alarms?.onAlarm) return () => {};
    const handler = (alarm: any) => {
      if (alarm?.name) listener(alarm.name);
    };
    this.api.alarms.onAlarm.addListener(handler);
    return () => this.api.alarms.onAlarm.removeListener(handler);
  }

  getExtensionUrl(path: string): string {
    if (!this.api?.runtime?.getURL) return path;
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    return this.api.runtime.getURL(cleanPath);
  }

  setBadge(tabId: number, text: string): void {
    try {
      const action = this.api?.action ?? this.api?.browserAction;
      if (!action?.setBadgeText || tabId < 0) return;
      const swallow = () => void this.api?.runtime?.lastError;
      action.setBadgeText({ tabId, text }, swallow);
      if (text && action.setBadgeBackgroundColor) {
        action.setBadgeBackgroundColor({ tabId, color: '#b45309' }, swallow);
      }
    } catch {
      // Badges are a courtesy; never let them break enforcement.
    }
  }

  async isIncognitoAccessAllowed(): Promise<boolean> {
    if (!this.api?.extension?.isAllowedIncognitoAccess) return false;
    return new Promise((resolve) => {
      this.api.extension.isAllowedIncognitoAccess((allowed: boolean) => resolve(allowed ?? false));
    });
  }
}
