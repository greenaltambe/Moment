/**
 * Moment Constants & Defaults
 */

export const DEFAULT_GRANT_DURATION_MS = 60 * 1000; // 60 seconds
export const MAX_GRANT_DURATION_MS = 10 * 60 * 1000; // 10 minutes
export const DEFAULT_PAUSE_DURATION_SECONDS = 10;
export const MAX_DISCRETE_ACTIVE_DELTA_MS = 60 * 1000; // 60s clamp
export const DEFAULT_SITE_PASS_DURATION_MS = 5 * 60 * 1000; // 5 minutes
export const MAX_SITE_PASS_DURATION_MS = 10 * 60 * 1000; // 10 minutes

// Phase 6 Intent Pass Constants
export const ALLOWED_INTENT_PASS_DURATIONS_MS = [
  5 * 60 * 1000, // 5 minutes
  15 * 60 * 1000, // 15 minutes
  30 * 60 * 1000, // 30 minutes
] as const;
export const DEFAULT_INTENT_PASS_DURATION_MS = 15 * 60 * 1000; // 15 minutes default
export const MAX_INTENT_PASS_DURATION_MS = 30 * 60 * 1000; // 30 minutes maximum

// Phase 7 Focus Mode Constants
export const ALLOWED_FOCUS_MODE_DURATIONS_MS = [
  15 * 60 * 1000, // 15 minutes
  30 * 60 * 1000, // 30 minutes
  60 * 60 * 1000, // 60 minutes
  90 * 60 * 1000, // 90 minutes
  120 * 60 * 1000, // 120 minutes (2 hours)
] as const;
export const DEFAULT_FOCUS_MODE_DURATION_MS = 30 * 60 * 1000; // 30 minutes default
export const MAX_FOCUS_MODE_DURATION_MS = 120 * 60 * 1000; // 120 minutes (2 hours) maximum

// Daily budget extensions (Daily Limit exhausted -> optional, intention-gated extra time)
export const BUDGET_EXTENSION_MS = 5 * 60 * 1000; // 5 minutes per extension
export const MAX_BUDGET_EXTENSIONS_PER_DAY = 3;
export const MIN_EXTENSION_INTENTION_LENGTH = 3;
export const MAX_EXTENSION_INTENTION_LENGTH = 280;

// Pause enforcement & Intent Pass friction
export const PAUSE_ELAPSED_TOLERANCE_MS = 1500; // slack for UI vs background timing
export const BREATHE_PAUSE_MAX_SECONDS = 10; // the breathing exercise UI never runs longer than this requirement
export const INTENT_PASS_MIN_WAIT_MS = 5 * 1000; // minimum time on the pause page before an Intent Pass
export const MIN_INTENT_PASS_REASON_LENGTH = 3;
export const PASS_WARNING_LEAD_MS = 60 * 1000; // warn this long before a pass expires
export const BUDGET_WARNING_LEAD_MS = 5 * 60 * 1000; // show remaining minutes during the last 5 minutes of a budget

// Ending Focus Mode early requires a short wait and a written reason
export const FOCUS_END_WAIT_MS = 10 * 1000;
export const FOCUS_END_REQUEST_TTL_MS = 5 * 60 * 1000;
export const FOCUS_END_WAIT_TOLERANCE_MS = 1000;
export const MIN_FOCUS_END_REASON_LENGTH = 3;
