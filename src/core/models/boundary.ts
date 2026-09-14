/**
 * Moment Core: Boundary & Policy Models
 * Pure domain model - zero browser dependencies.
 */

export type PauseType = 'BREATHE' | 'TIMER' | 'CONFIRM' | 'NONE';

export type TerminalActionType = 'BLOCK_PAGE' | 'REDIRECT';

export interface ScheduleInterval {
  readonly days: number[]; // 0 = Sun, 1 = Mon, ..., 6 = Sat
  readonly startMinute: number; // Minutes from 00:00 (e.g. 540 = 09:00)
  readonly endMinute: number; // (e.g. 1020 = 17:00)
}

export interface ScheduleConfig {
  readonly enabled: boolean;
  readonly intervals: readonly ScheduleInterval[];
}

export interface UsageLimitsConfig {
  readonly dailyMinutes: number | null;
  /**
   * Reserved in Phase 0.2 schema for forward compatibility.
   * Explicitly marked as NOT REQUIRED in V1 (deferred to V1.5).
   * null or undefined means disabled.
   */
  readonly sessionMinutes: number | null;
}

export interface PauseConfig {
  readonly type: PauseType;
  readonly durationSeconds: number;
  readonly requireIntentionText: boolean;
}

export interface TerminalActionConfig {
  readonly type: TerminalActionType;
  readonly redirectUrl: string | null;
}

export interface BoundaryPolicy {
  readonly schedule: ScheduleConfig;
  readonly limits: UsageLimitsConfig;
  readonly pause: PauseConfig;
  readonly action: TerminalActionConfig;
  readonly strictMode: boolean; // If true, Intent Passes are disabled on Block Page
}
