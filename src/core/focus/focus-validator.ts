/**
 * Moment Core: Focus Mode Validator
 * Pure domain model - zero browser dependencies.
 * Validates user-facing, deliberate Focus Mode commitment sessions.
 */

import { FocusSession } from '../models/focus-session.js';
import { Collection } from '../models/collection.js';
import { resolveCollectionLimitMs } from '../usage/accounting.js';
import {
  FOCUS_END_WAIT_MS,
  FOCUS_END_REQUEST_TTL_MS,
  FOCUS_END_WAIT_TOLERANCE_MS,
  ALLOWED_FOCUS_MODE_DURATIONS_MS,
  DEFAULT_FOCUS_MODE_DURATION_MS,
  MAX_FOCUS_MODE_DURATION_MS,
} from '../../shared/constants.js';

/**
 * Validates and clamps client-requested Focus Mode duration to authorized discrete values.
 */
export function resolveFocusModeDuration(requestedDuration?: unknown): number {
  if (typeof requestedDuration !== 'number') {
    return DEFAULT_FOCUS_MODE_DURATION_MS;
  }

  if (!Number.isFinite(requestedDuration) || Number.isNaN(requestedDuration)) {
    return DEFAULT_FOCUS_MODE_DURATION_MS;
  }

  if (requestedDuration <= 0) {
    return DEFAULT_FOCUS_MODE_DURATION_MS;
  }

  const floored = Math.floor(requestedDuration);

  // Exact match with configured allowed durations (15m, 30m, 60m, 90m, 120m)
  if ((ALLOWED_FOCUS_MODE_DURATIONS_MS as readonly number[]).includes(floored)) {
    return floored;
  }

  // Strict maximum clamp (2 hours)
  if (floored > MAX_FOCUS_MODE_DURATION_MS) {
    return MAX_FOCUS_MODE_DURATION_MS;
  }

  // Fallback clamping for lower bound (15 min)
  if (floored < ALLOWED_FOCUS_MODE_DURATIONS_MS[0]) {
    return ALLOWED_FOCUS_MODE_DURATIONS_MS[0];
  }

  // Snap to nearest discrete allowed duration
  let closest: number = DEFAULT_FOCUS_MODE_DURATION_MS;
  let minDiff = Infinity;
  for (const allowed of ALLOWED_FOCUS_MODE_DURATIONS_MS) {
    const diff = Math.abs(floored - allowed);
    if (diff < minDiff) {
      minDiff = diff;
      closest = allowed;
    }
  }

  return closest;
}

/**
 * Validates whether a FocusSession is currently active and unexpired.
 */
export function isFocusSessionActive(
  session: FocusSession | null | undefined,
  now: number = Date.now()
): boolean {
  if (!session || typeof session !== 'object') {
    return false;
  }

  if (session.status !== 'ACTIVE') {
    return false;
  }

  if (typeof session.id !== 'string' || session.id.trim().length === 0) {
    return false;
  }

  if (
    typeof session.startedAt !== 'number' ||
    typeof session.expiresAt !== 'number' ||
    !Number.isFinite(session.startedAt) ||
    !Number.isFinite(session.expiresAt)
  ) {
    return false;
  }

  if (session.startedAt >= session.expiresAt) {
    return false;
  }

  // Expiration check: at exactly expiresAt, session is expired
  if (now >= session.expiresAt) {
    return false;
  }

  // Pre-activation or clock anomaly check
  if (now < session.startedAt) {
    return false;
  }

  // Strict maximum duration check
  if (session.expiresAt - session.startedAt > MAX_FOCUS_MODE_DURATION_MS) {
    return false;
  }

  if (!Array.isArray(session.selectedCollectionIds) || session.selectedCollectionIds.length === 0) {
    return false;
  }

  return true;
}

/**
 * Filters and validates a set of collection IDs against available stored collections.
 * Guarantees unique, existing, enabled collection IDs.
 */
export function filterValidFocusCollectionIds(
  requestedIds: unknown,
  availableCollections: Record<string, Collection>
): string[] {
  if (!Array.isArray(requestedIds) || !availableCollections || typeof availableCollections !== 'object') {
    return [];
  }

  const validSet = new Set<string>();
  for (const id of requestedIds) {
    if (typeof id === 'string' && id.trim().length > 0) {
      const col = availableCollections[id];
      if (col && col.enabled !== false) {
        validSet.add(id);
      }
    }
  }

  return Array.from(validSet);
}

/**
 * Focus Mode only changes behaviour for collections that are NOT already fully active:
 * those with a schedule (Focus Mode applies them outside their window) or a daily limit
 * (Focus Mode applies the pause even while time is left). Always-on collections without a
 * limit are already restricted, so Focus Mode would add nothing.
 */
export function isFocusRelevantCollection(collection: Collection | null | undefined): boolean {
  if (!collection || collection.enabled === false) return false;
  if (collection.boundary?.schedule?.enabled) return true;
  return resolveCollectionLimitMs(collection) !== null;
}

/**
 * Decides whether an active Focus session may be ended now.
 * The user must first request to end (starting a short wait), then confirm within a time window.
 */
export function getFocusEndGate(
  session: FocusSession,
  now: number
): { allowed: boolean; waitMs: number; needsRequest: boolean } {
  const requestedAt = session.endRequestedAt;
  if (typeof requestedAt !== 'number' || now - requestedAt > FOCUS_END_REQUEST_TTL_MS) {
    return { allowed: false, waitMs: FOCUS_END_WAIT_MS, needsRequest: true };
  }
  const waitMs = Math.max(0, requestedAt + FOCUS_END_WAIT_MS - FOCUS_END_WAIT_TOLERANCE_MS - now);
  return { allowed: waitMs === 0, waitMs, needsRequest: false };
}
