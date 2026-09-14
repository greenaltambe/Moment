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
];
export const DEFAULT_INTENT_PASS_DURATION_MS = 15 * 60 * 1000; // 15 minutes default
export const MAX_INTENT_PASS_DURATION_MS = 30 * 60 * 1000; // 30 minutes maximum
// Phase 7 Focus Mode Constants
export const ALLOWED_FOCUS_MODE_DURATIONS_MS = [
    15 * 60 * 1000, // 15 minutes
    30 * 60 * 1000, // 30 minutes
    60 * 60 * 1000, // 60 minutes
    90 * 60 * 1000, // 90 minutes
    120 * 60 * 1000, // 120 minutes (2 hours)
];
export const DEFAULT_FOCUS_MODE_DURATION_MS = 30 * 60 * 1000; // 30 minutes default
export const MAX_FOCUS_MODE_DURATION_MS = 120 * 60 * 1000; // 120 minutes (2 hours) maximum
