import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransition,
  transitionIntervention,
  isTerminalStatus,
  isInterventionActive,
  isInterventionExpired,
  MAX_PENDING_INTERVENTION_LIFETIME_MS,
} from '../../dist/chrome/core/interventions/state-machine.js';
import type { PendingIntervention, InterventionStatus } from '../../src/core/interventions/types.js';

describe('Moment Core: Intervention State Machine (Phase 3)', () => {
  const baseRecord: PendingIntervention = {
    id: 'intv_test_1',
    tabId: 10,
    targetUrl: 'https://example.com/distracting',
    collectionId: 'col_social',
    matchedRuleId: 'rule_1',
    interventionType: 'BREATHE',
    durationSeconds: 10,
    requireIntentionText: false,
    createdAt: 1000,
    updatedAt: 1000,
    nonce: 'nonce_secret_123',
    status: 'PENDING',
  };

  it('Allows valid forward lifecycle transitions', () => {
    assert.equal(canTransition('NONE', 'PENDING'), true);
    assert.equal(canTransition('PENDING', 'PRESENTED'), true);
    assert.equal(canTransition('PRESENTED', 'IN_PROGRESS'), true);
    assert.equal(canTransition('IN_PROGRESS', 'COMPLETED'), true);
    assert.equal(canTransition('COMPLETED', 'GRANT_ISSUED'), true);
    assert.equal(canTransition('GRANT_ISSUED', 'NAVIGATING'), true);
    assert.equal(canTransition('NAVIGATING', 'DESTINATION'), true);

    // Direct completion for CONFIRM mode (presented -> completed)
    assert.equal(canTransition('PRESENTED', 'COMPLETED'), true);
  });

  it('Executes sequential transition chain immutably', () => {
    const presented = transitionIntervention(baseRecord, 'PRESENTED', 1100);
    assert.equal(presented.status, 'PRESENTED');
    assert.equal(presented.updatedAt, 1100);

    const inProgress = transitionIntervention(presented, 'IN_PROGRESS', 1200);
    assert.equal(inProgress.status, 'IN_PROGRESS');

    const completed = transitionIntervention(inProgress, 'COMPLETED', 1300);
    assert.equal(completed.status, 'COMPLETED');

    const grantIssued = transitionIntervention(completed, 'GRANT_ISSUED', 1400);
    assert.equal(grantIssued.status, 'GRANT_ISSUED');

    const navigating = transitionIntervention(grantIssued, 'NAVIGATING', 1500);
    assert.equal(navigating.status, 'NAVIGATING');

    const destination = transitionIntervention(navigating, 'DESTINATION', 1600);
    assert.equal(destination.status, 'DESTINATION');
  });

  it('Rejects backward and illegal skip transitions (Replay Prevention)', () => {
    const completed = { ...baseRecord, status: 'COMPLETED' as InterventionStatus };
    assert.equal(canTransition('COMPLETED', 'IN_PROGRESS'), false);
    (assert as any).throws(() => transitionIntervention(completed, 'IN_PROGRESS'), /Illegal intervention state transition/);

    const grantIssued = { ...baseRecord, status: 'GRANT_ISSUED' as InterventionStatus };
    assert.equal(canTransition('GRANT_ISSUED', 'COMPLETED'), false);
    assert.equal(canTransition('GRANT_ISSUED', 'GRANT_ISSUED'), false);
    (assert as any).throws(() => transitionIntervention(grantIssued, 'GRANT_ISSUED'), /Illegal intervention state transition/);

    const destination = { ...baseRecord, status: 'DESTINATION' as InterventionStatus };
    assert.equal(canTransition('DESTINATION', 'PENDING'), false);
    (assert as any).throws(() => transitionIntervention(destination, 'PENDING'), /Illegal intervention state transition/);
  });

  it('Supports cancellation from active in-flight states only', () => {
    assert.equal(canTransition('PENDING', 'CANCELLED'), true);
    assert.equal(canTransition('PRESENTED', 'CANCELLED'), true);
    assert.equal(canTransition('IN_PROGRESS', 'CANCELLED'), true);

    // Cannot cancel after grant has already been completed or issued
    assert.equal(canTransition('COMPLETED', 'CANCELLED'), false);
    assert.equal(canTransition('GRANT_ISSUED', 'CANCELLED'), false);
    assert.equal(canTransition('DESTINATION', 'CANCELLED'), false);
  });

  it('Correctly identifies terminal and active statuses', () => {
    assert.equal(isInterventionActive('PENDING'), true);
    assert.equal(isInterventionActive('PRESENTED'), true);
    assert.equal(isInterventionActive('IN_PROGRESS'), true);
    assert.equal(isInterventionActive('COMPLETED'), false);
    assert.equal(isInterventionActive('GRANT_ISSUED'), false);
    assert.equal(isInterventionActive('CANCELLED'), false);

    assert.equal(isTerminalStatus('DESTINATION'), true);
    assert.equal(isTerminalStatus('CANCELLED'), true);
    assert.equal(isTerminalStatus('EXPIRED'), true);
    assert.equal(isTerminalStatus('DISCARDED'), true);
    assert.equal(isTerminalStatus('IN_PROGRESS'), false);
  });

  it('Evaluates intervention expiration based on lifetime bounds', () => {
    const now = 2000;
    const freshRecord = { ...baseRecord, createdAt: now - 5000 };
    assert.equal(isInterventionExpired(freshRecord, now), false);

    const expiredRecord = {
      ...baseRecord,
      createdAt: now - (MAX_PENDING_INTERVENTION_LIFETIME_MS + 1000),
    };
    assert.equal(isInterventionExpired(expiredRecord, now), true);

    const alreadyExpiredStatus = { ...baseRecord, status: 'EXPIRED' as InterventionStatus };
    assert.equal(isInterventionExpired(alreadyExpiredStatus, now), true);
  });
});
