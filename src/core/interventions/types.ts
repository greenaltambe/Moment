/**
 * Moment Core: Intervention Domain Types & Interfaces
 * Pure domain model - zero browser dependencies.
 * Implements Phase 3 Behavioral Mindfulness Intervention Specifications.
 */

import { PauseType } from '../models/boundary.js';

export type InterventionStatus =
  | 'NONE'
  | 'PENDING'
  | 'PRESENTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'GRANT_ISSUED'
  | 'NAVIGATING'
  | 'DESTINATION'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'DISCARDED';

export interface PendingIntervention {
  readonly id: string;
  readonly tabId: number;
  readonly targetUrl: string;
  readonly collectionId: string;
  readonly matchedRuleId?: string | null;
  readonly interventionType: PauseType; // 'BREATHE' | 'TIMER' | 'CONFIRM' | 'NONE'
  readonly durationSeconds: number;
  readonly requireIntentionText: boolean;
  readonly intentionText?: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly nonce: string;
  readonly status: InterventionStatus;
}
