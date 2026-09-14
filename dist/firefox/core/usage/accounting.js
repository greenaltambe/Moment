/**
 * Moment Core: Pure Usage Accounting & Daily Limit Engine
 * Pure domain logic - zero browser dependencies.
 */
import { MAX_DISCRETE_ACTIVE_DELTA_MS } from '../../shared/constants.js';
/**
 * Returns the local calendar date key 'YYYY-MM-DD' for a given timestamp or Date object.
 * Uses the local timezone of the host device.
 */
export function getLocalDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
/**
 * Calculates the active elapsed time between two timestamps with safe guards:
 * - Rejects negative deltas (system clock moved backward) by returning 0.
 * - Clamps deltas exceeding maxDeltaMs (machine sleep / hibernation) to maxDeltaMs.
 */
export function calculateActiveDelta(lastTimestamp, currentTimestamp, maxDeltaMs = MAX_DISCRETE_ACTIVE_DELTA_MS) {
    if (currentTimestamp <= lastTimestamp) {
        return 0;
    }
    const rawDelta = currentTimestamp - lastTimestamp;
    if (rawDelta > maxDeltaMs) {
        return maxDeltaMs;
    }
    return rawDelta;
}
/**
 * Splits an active time interval that may cross local calendar midnight into day-specific slices.
 * Correctly attributes pre-midnight time to the earlier day and post-midnight time to the next day.
 */
export function splitIntervalAtMidnight(startMs, endMs) {
    if (startMs >= endMs) {
        return [];
    }
    const startDate = new Date(startMs);
    const endDate = new Date(endMs);
    const startDateKey = getLocalDateKey(startDate);
    const endDateKey = getLocalDateKey(endDate);
    if (startDateKey === endDateKey) {
        return [{ dateKey: startDateKey, durationMs: endMs - startMs }];
    }
    // Calculate local midnight at the start of the next day
    const nextMidnight = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + 1, 0, 0, 0, 0);
    const midnightMs = nextMidnight.getTime();
    const firstSliceDuration = Math.max(0, midnightMs - startMs);
    const remainingDuration = Math.max(0, endMs - midnightMs);
    const slices = [];
    if (firstSliceDuration > 0) {
        slices.push({ dateKey: startDateKey, durationMs: firstSliceDuration });
    }
    if (remainingDuration > 0) {
        // If interval spans across multiple midnights, recurse for the remainder
        const subSlices = splitIntervalAtMidnight(midnightMs, endMs);
        slices.push(...subSlices);
    }
    return slices;
}
/**
 * Validates a configured daily limit duration.
 * Rejects negative, NaN, non-finite, and zero values by returning null (no limit).
 */
export function validateDailyLimit(limit) {
    if (typeof limit !== 'number' || !Number.isFinite(limit) || Number.isNaN(limit)) {
        return null;
    }
    if (limit <= 0) {
        return null;
    }
    return Math.floor(limit);
}
/**
 * Resolves the effective daily limit in milliseconds for a collection.
 * Checks collection.dailyLimitMs first, then falls back to boundary.limits.dailyMinutes.
 */
export function resolveCollectionLimitMs(collection) {
    if (collection.dailyLimitMs !== undefined && collection.dailyLimitMs !== null) {
        return validateDailyLimit(collection.dailyLimitMs);
    }
    const dailyMinutes = collection.boundary?.limits?.dailyMinutes;
    if (dailyMinutes !== undefined && dailyMinutes !== null) {
        const validatedMinutes = validateDailyLimit(dailyMinutes);
        return validatedMinutes ? validatedMinutes * 60 * 1000 : null;
    }
    return null;
}
/**
 * Computes remaining budget and exhaustion status from used time and configured limit.
 */
export function calculateRemainingBudget(usedMs, limitMs) {
    if (limitMs === null) {
        return { remainingMs: null, isExhausted: false };
    }
    const clampedUsed = Math.max(0, usedMs);
    const remaining = Math.max(0, limitMs - clampedUsed);
    return {
        remainingMs: remaining,
        isExhausted: remaining === 0,
    };
}
/**
 * Constructs a complete CollectionUsageBudget view.
 */
export function buildCollectionUsageBudget(collectionId, dateKey, usedMs, limitMs) {
    const { remainingMs, isExhausted } = calculateRemainingBudget(usedMs, limitMs);
    return {
        collectionId,
        dateKey,
        usedMs: Math.max(0, usedMs),
        limitMs,
        remainingMs,
        isExhausted,
    };
}
/**
 * Generates the standardized storage lookup key for a daily usage record.
 */
export function getUsageRecordKey(dateKey, collectionId) {
    return `${dateKey}:${collectionId}`;
}
/**
 * Calm, human-readable duration formatter (e.g., '45s', '12m', '1h 15m').
 */
export function formatDuration(ms) {
    if (ms <= 0)
        return '0m';
    const totalSeconds = Math.floor(ms / 1000);
    if (totalSeconds < 60) {
        return `${totalSeconds}s`;
    }
    const totalMinutes = Math.floor(totalSeconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) {
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }
    return `${minutes}m`;
}
