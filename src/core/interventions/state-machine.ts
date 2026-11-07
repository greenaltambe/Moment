/**
 * Moment Core: Intervention State Machine
 * Pure domain model - zero browser dependencies.
 * Guarantees strict acyclic transitions and prevents illegal or duplicate grant issuance.
 */

import { InterventionStatus, PendingIntervention } from './types.js';

export const MAX_PENDING_INTERVENTION_LIFETIME_MS = 15 * 60 * 1000; // 15 minutes

const VALID_TRANSITIONS: Record<InterventionStatus, readonly InterventionStatus[]> = {
  NONE: ['PENDING'],
  PENDING: ['PRESENTED', 'CANCELLED', 'EXPIRED', 'DISCARDED'],
  PRESENTED: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'DISCARDED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED', 'EXPIRED', 'DISCARDED'],
  COMPLETED: ['GRANT_ISSUED', 'DISCARDED'],
  GRANT_ISSUED: ['NAVIGATING', 'DISCARDED'],
  NAVIGATING: ['DESTINATION', 'DISCARDED'],
  DESTINATION: ['DISCARDED'],
  CANCELLED: ['DISCARDED'],
  EXPIRED: ['DISCARDED'],
  DISCARDED: [],
};

/**
 * Checks whether a transition between two statuses is permitted.
 */
export function canTransition(from: InterventionStatus, to: InterventionStatus): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/**
 * Checks if an intervention status is a terminal state.
 */
export function isTerminalStatus(status: InterventionStatus): boolean {
  return (
    status === 'DESTINATION' ||
    status === 'CANCELLED' ||
    status === 'EXPIRED' ||
    status === 'DISCARDED'
  );
}

/**
 * Checks if an intervention is currently in an active (in-flight) state.
 */
export function isInterventionActive(status: InterventionStatus): boolean {
  return status === 'PENDING' || status === 'PRESENTED' || status === 'IN_PROGRESS';
}

/**
 * Determines whether a pending intervention has expired due to age.
 */
export function isInterventionExpired(
  intervention: PendingIntervention,
  now: number,
  maxLifetimeMs: number = MAX_PENDING_INTERVENTION_LIFETIME_MS
): boolean {
  if (isTerminalStatus(intervention.status)) {
    return intervention.status === 'EXPIRED';
  }
  return now - intervention.createdAt > maxLifetimeMs;
}

/**
 * Executes a deterministic state transition on an intervention record.
 * Throws an Error if the transition is illegal, preventing duplicate grant or reverse transitions.
 */
export function transitionIntervention(
  record: PendingIntervention,
  nextStatus: InterventionStatus,
  now: number = Date.now()
): PendingIntervention {
  if (!canTransition(record.status, nextStatus)) {
    throw new Error(
      `Illegal intervention state transition from '${record.status}' to '${nextStatus}' for intervention '${record.id}'`
    );
  }

  return {
    ...record,
    status: nextStatus,
    updatedAt: now,
  };
}

/**
 * Minimum time the pause must have been on screen before completion is accepted.
 * BREATHE is capped because the breathing exercise itself has a fixed length.
 */
export function requiredPauseMs(interventionType: string, durationSeconds: number): number {
  const secs = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  if (interventionType === 'BREATHE') return Math.min(secs, 10) * 1000;
  if (interventionType === 'TIMER') return secs * 1000;
  return 0; // CONFIRM / NONE: no mandatory wait
}

/**
 * True when enough time has passed since the pause was presented (with timing tolerance).
 */
export function hasPauseElapsed(
  intervention: PendingIntervention,
  now: number,
  toleranceMs: number = 1500
): boolean {
  const required = requiredPauseMs(intervention.interventionType, intervention.durationSeconds);
  if (required <= 0) return true;
  const start = intervention.presentedAt ?? intervention.createdAt;
  return now - start >= required - toleranceMs;
}
