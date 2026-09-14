/**
 * Moment Core: Intervention State Machine
 * Pure domain model - zero browser dependencies.
 * Guarantees strict acyclic transitions and prevents illegal or duplicate grant issuance.
 */
export const MAX_PENDING_INTERVENTION_LIFETIME_MS = 15 * 60 * 1000; // 15 minutes
const VALID_TRANSITIONS = {
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
export function canTransition(from, to) {
    const allowed = VALID_TRANSITIONS[from];
    return allowed ? allowed.includes(to) : false;
}
/**
 * Checks if an intervention status is a terminal state.
 */
export function isTerminalStatus(status) {
    return (status === 'DESTINATION' ||
        status === 'CANCELLED' ||
        status === 'EXPIRED' ||
        status === 'DISCARDED');
}
/**
 * Checks if an intervention is currently in an active (in-flight) state.
 */
export function isInterventionActive(status) {
    return status === 'PENDING' || status === 'PRESENTED' || status === 'IN_PROGRESS';
}
/**
 * Determines whether a pending intervention has expired due to age.
 */
export function isInterventionExpired(intervention, now, maxLifetimeMs = MAX_PENDING_INTERVENTION_LIFETIME_MS) {
    if (isTerminalStatus(intervention.status)) {
        return intervention.status === 'EXPIRED';
    }
    return now - intervention.createdAt > maxLifetimeMs;
}
/**
 * Executes a deterministic state transition on an intervention record.
 * Throws an Error if the transition is illegal, preventing duplicate grant or reverse transitions.
 */
export function transitionIntervention(record, nextStatus, now = Date.now()) {
    if (!canTransition(record.status, nextStatus)) {
        throw new Error(`Illegal intervention state transition from '${record.status}' to '${nextStatus}' for intervention '${record.id}'`);
    }
    return {
        ...record,
        status: nextStatus,
        updatedAt: now,
    };
}
