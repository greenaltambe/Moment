/**
 * Moment Core: Usage Accounting & Time Budget Types
 * Pure domain models - zero browser dependencies.
 */

export interface DailyUsageRecord {
  readonly dateKey: string; // Local calendar date 'YYYY-MM-DD'
  readonly collectionId: string;
  accumulatedMs: number;
  updatedAt: number; // Epoch timestamp ms
}

export interface CollectionUsageBudget {
  readonly collectionId: string;
  readonly dateKey: string;
  readonly usedMs: number;
  readonly limitMs: number | null;
  readonly remainingMs: number | null;
  readonly isExhausted: boolean;
}

export interface ActiveTrackingState {
  activeTabId: number | null;
  activeWindowId: number | null;
  isWindowFocused: boolean;
  activeCollectionId: string | null;
  lastCheckpointTimestamp: number | null;
}
