/**
 * Moment Core: Intent Pass Model
 * Pure domain model - zero browser dependencies.
 * Represents a user-facing, deliberate temporary access permission.
 */

import { TargetRuleType } from './target.js';

export type IntentPassId = string;

export interface IntentPassScope {
  readonly type: TargetRuleType;
  readonly pattern: string;
}

export interface IntentPass {
  readonly id: IntentPassId;
  readonly tabId: number;
  readonly scope: IntentPassScope;
  readonly collectionId: string;
  readonly matchedRuleId: string | null;
  readonly grantedAt: number; // Epoch ms
  readonly expiresAt: number; // Epoch ms
  readonly durationMs: number; // Configured duration ms
}
