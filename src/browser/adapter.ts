/**
 * Moment Browser Adapter Interface
 * Isolates all browser extension API interactions behind a typed contract.
 * Core NEVER imports browser APIs directly.
 */

import { BrowserCapabilities } from './capabilities.js';

export interface TabInfo {
  readonly id: number;
  readonly url?: string;
  readonly title?: string;
  readonly active: boolean;
  readonly incognito: boolean;
  readonly windowId: number;
}

export interface NavigationEvent {
  readonly tabId: number;
  readonly url: string;
  readonly frameId: number;
  readonly timestamp: number;
}

export interface BrowserAdapter {
  getCapabilities(): BrowserCapabilities;
  getCurrentTab(): Promise<TabInfo | null>;
  getTab(tabId: number): Promise<TabInfo | null>;
  getAllTabs(): Promise<TabInfo[]>;
  updateTab(tabId: number, properties: { url?: string; active?: boolean }): Promise<void>;
  createTab(properties: { url: string; active?: boolean }): Promise<TabInfo>;
  removeTab(tabId: number): Promise<void>;
  onNavigation(listener: (nav: NavigationEvent) => void): () => void;
  onNavigationCommitted(listener: (nav: NavigationEvent) => void): () => void;
  onHistoryStateUpdated(listener: (nav: NavigationEvent) => void): () => void;
  onTabActivated(listener: (activeInfo: { tabId: number; windowId: number }) => void): () => void;
  onTabRemoved(listener: (tabId: number) => void): () => void;
  onWindowFocusChanged(listener: (windowId: number) => void): () => void;
  createAlarm(name: string, alarmInfo: { when?: number; periodInMinutes?: number }): void;
  clearAlarm(name: string): Promise<void>;
  onAlarm(listener: (name: string) => void): () => void;
  getExtensionUrl(path: string): string;
  isIncognitoAccessAllowed(): Promise<boolean>;
}
