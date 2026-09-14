/**
 * Moment Core: Target Rule Models
 * Pure domain model - zero browser dependencies.
 */

export type TargetId = string;

export type TargetRuleType =
  | 'WEBSITE'
  | 'EXACT_HOST'
  | 'PATH_PREFIX'
  | 'EXACT_PAGE'
  | 'GLOB';

export interface Target {
  readonly id: TargetId;
  readonly pattern: string;
  readonly type: TargetRuleType;
  readonly isException: boolean; // true = ALLOW (punch hole), false = RESTRICT
  readonly priority?: number; // Explicit priority (-100 to 100, default 0)
  readonly createdAt: number;
}
