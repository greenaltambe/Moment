/**
 * Moment Core: Decision Engine Interfaces
 * Pure domain model - zero browser dependencies.
 */

import { TemporaryAccessGrant } from '../models/grant.js';
import { Collection } from '../models/collection.js';
import { Target } from '../models/target.js';
import { FocusSession } from '../models/focus-session.js';
import { SpecificityTuple } from './specificity.js';

export type DecisionAction = 'ALLOW' | 'INTERVENE' | 'BLOCK';

export type DecisionReason =
  | 'NO_RULE_MATCH'
  | 'EXCEPTION_RULE'
  | 'ACTIVE_GRANT'
  | 'SITE_PASS'
  | 'INTENT_PASS'
  | 'FOCUS_MODE'
  | 'SCHEDULE_ACTIVE'
  | 'SCHEDULE_INACTIVE'
  | 'DAILY_LIMIT_EXHAUSTED'
  | 'WITHIN_DAILY_BUDGET'
  | 'INTERVENTION_REQUIRED'
  | 'MANUAL_OVERRIDE';

export interface DecisionTrace {
  readonly finalAction?: DecisionAction;
  readonly reason?: DecisionReason;
  readonly matchedTarget?: Target;
  readonly specificity?: SpecificityTuple;
  readonly collectionId?: string;
  readonly boundaryActive?: boolean;
  readonly focusModeActive?: boolean;
  readonly isException?: boolean;
  readonly totalCandidateRulesMatched: number;
}

export interface Decision {
  readonly action: DecisionAction;
  readonly reason: DecisionReason;
  readonly targetUrl: string;
  readonly matchedRuleId: string | null;
  readonly collectionId: string | null;
  readonly explanation: string;
  readonly timestamp: number;
  readonly trace?: DecisionTrace;
}

export interface DecisionRequest {
  readonly url: string;
  readonly tabId: number;
  readonly timestamp: number;
  readonly activeGrants: readonly TemporaryAccessGrant[];
  readonly collections?: Record<string, Collection> | readonly Collection[];
  readonly dailyUsageMs?: Record<string, number>;
  readonly dailyExtensionMs?: Record<string, number>; // Extra budget granted today, keyed by collectionId
  readonly focusSession?: FocusSession | null;
}

export interface DecisionEngine {
  evaluate(request: DecisionRequest): Decision;
}
