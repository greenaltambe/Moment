/**
 * Moment Core: Boundary & Schedule Evaluator
 * Pure domain model - zero browser dependencies.
 * Evaluates whether a BoundaryPolicy is currently active at a specific timestamp.
 */

import { BoundaryPolicy, ScheduleInterval } from '../models/boundary.js';

/**
 * Checks if a specific day-and-minute time falls within a scheduled interval.
 *
 * Endpoint Semantics:
 * - Start is INCLUSIVE (currentMinute >= startMinute)
 * - End is EXCLUSIVE (currentMinute < endMinute)
 * - Overnight intervals (startMinute > endMinute) span midnight into the following day.
 */
export function isTimeInInterval(
  currentDay: number,
  currentMinute: number,
  interval: ScheduleInterval
): boolean {
  if (!interval || typeof interval !== 'object' || !Array.isArray(interval.days)) {
    return false;
  }

  const { days, startMinute, endMinute } = interval;

  // Daytime interval (e.g. 09:00 -> 17:00)
  if (startMinute < endMinute) {
    if (!days.includes(currentDay)) {
      return false;
    }
    return currentMinute >= startMinute && currentMinute < endMinute;
  }

  // Overnight interval spanning midnight (e.g. 22:00 -> 07:00)
  if (startMinute > endMinute) {
    // Case 1: Evening portion on the scheduled day (e.g. Monday 22:00 -> 23:59)
    if (days.includes(currentDay) && currentMinute >= startMinute) {
      return true;
    }

    // Case 2: Morning portion on the subsequent day (e.g. Tuesday 00:00 -> 06:59)
    const previousDay = (currentDay + 6) % 7;
    if (days.includes(previousDay) && currentMinute < endMinute) {
      return true;
    }

    return false;
  }

  // Edge case: startMinute === endMinute (24-hour window if scheduled on that day)
  if (startMinute === endMinute) {
    return days.includes(currentDay);
  }

  return false;
}

/**
 * Evaluates whether a boundary policy is active at the given timestamp.
 *
 * Rules:
 * - If schedule is disabled (enabled === false), the boundary is ALWAYS active (24/7).
 * - If schedule is enabled, boundary is active if any interval matches.
 * - Empty interval list when enabled is considered inactive.
 * - Safe fail-closed: malformed policy defaults to always active.
 */
export function isBoundaryActive(
  policy: BoundaryPolicy | null | undefined,
  timestamp: number
): boolean {
  if (!policy || !policy.schedule) {
    return true; // Safe fallback: restrict by default
  }

  // If schedule is disabled, policy is 24/7 always active
  if (!policy.schedule.enabled) {
    return true;
  }

  const intervals = policy.schedule.intervals;
  if (!intervals || !Array.isArray(intervals) || intervals.length === 0) {
    return false;
  }

  const date = new Date(timestamp);
  const currentDay = date.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const currentMinute = date.getHours() * 60 + date.getMinutes();

  return intervals.some((interval) => isTimeInInterval(currentDay, currentMinute, interval));
}
