/**
 * Moment Core: Focus Session Model
 * Pure domain model - zero browser dependencies.
 * Represents a user-facing, deliberate Focus Mode commitment session.
 */

export type FocusSessionId = string;
export type FocusSessionStatus = 'ACTIVE' | 'ENDED' | 'EXPIRED';

export interface FocusSession {
  readonly id: FocusSessionId;
  readonly startedAt: number; // Epoch ms
  readonly expiresAt: number; // Epoch ms
  readonly durationMs: number; // Configured duration ms
  readonly selectedCollectionIds: readonly string[];
  readonly status: FocusSessionStatus;
}
