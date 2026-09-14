/**
 * Phase 5.1.2 Regression Test Suite
 *
 * Verifies the resolution of the Critical Intervention Navigation Loop:
 * 1. Complete intervention -> destination loads exactly once.
 * 2. Complete intervention -> no second intervention loop.
 * 3. Grant persists through destination navigation (survives onBeforeNavigate).
 * 4. Grant is consumed exactly once upon top-level navigation commit.
 * 5. Expired grant causes intervention (cannot authorize navigation).
 * 6. Cancellation does not loop (safe neutral navigation, no history.back recursion).
 * 7. Stale pending state is cleaned up properly.
 * 8. Same-origin redirect behavior (grant persists and authorizes same-origin redirects).
 * 9. Unrelated-origin redirect behavior (grant strictly rejected, normal policy applies).
 * 10. Multi-tab grant isolation (Tab A grant does not authorize Tab B).
 * 11. Intervention-page reload handling (re-querying completed/cancelled intervention fails cleanly).
 * 12. Tab close cleanup (closing tab cleans up pending intervention and grants).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ExtensionStorage } from '../../dist/chrome/storage/storage.js';
import { MomentDecisionEngine } from '../../dist/chrome/core/decisions/engine.js';
import { isGrantValidForNavigation, resolveGrantDuration } from '../../dist/chrome/core/grants/grant-validator.js';
import { parseCanonicalUrl, toCanonicalString } from '../../dist/chrome/core/matching/url.js';
import { canTransition, isInterventionExpired } from '../../dist/chrome/core/interventions/state-machine.js';
import { isSafeDestination } from '../../dist/chrome/shared/urls.js';
import type { Collection } from '../../src/core/models/collection.js';
import type { PendingIntervention } from '../../src/core/interventions/types.js';
import type { TemporaryAccessGrant } from '../../src/core/models/grant.js';
import type { MomentStorageEnvelope } from '../../src/storage/schema.js';

describe('Phase 5.1.2 Regression: Intervention Navigation Loop & Lifecycle', () => {
  const socialCollection: Collection = {
    id: 'col_social',
    name: 'Social Media',
    color: '#e11d48',
    icon: 'shield',
    enabled: true,
    createdAt: 1000,
    updatedAt: 1000,
    dailyLimitMs: null,
    targets: [
      { id: 't_reddit', pattern: 'reddit.com', type: 'WEBSITE', isException: false, createdAt: 1000 },
      { id: 't_example', pattern: 'example.com', type: 'WEBSITE', isException: false, createdAt: 1000 },
    ],
    boundary: {
      schedule: { enabled: false, intervals: [] },
      limits: { dailyMinutes: null, sessionMinutes: null },
      pause: { type: 'CONFIRM', durationSeconds: 0, requireIntentionText: false },
      action: { type: 'BLOCK_PAGE', redirectUrl: null },
      strictMode: false,
    },
  };

  /**
   * Helper simulating the background lifecycle for intervention and navigation:
   */
  class BackgroundSimulator {
    storage: ExtensionStorage;
    engine: MomentDecisionEngine;

    constructor() {
      this.storage = new ExtensionStorage();
      this.engine = new MomentDecisionEngine([socialCollection]);
    }

    async init() {
      await this.storage.updateState((draft: MomentStorageEnvelope) => {
        draft.collections[socialCollection.id] = socialCollection;
      });
    }

    // Simulates onBeforeNavigate
    async onBeforeNavigate(tabId: number, url: string, now: number = Date.now()): Promise<{ action: string; reason: string; routeTo?: string }> {
      const state = await this.storage.getState();
      const activeGrants = (Object.values(state.runtime.temporaryAccessGrants) as TemporaryAccessGrant[]).filter((g) => g.expiresAt > now);

      this.engine.setCollections(state.collections);
      const decision = this.engine.evaluate({
        url,
        tabId,
        timestamp: now,
        activeGrants,
        collections: state.collections,
        dailyUsageMs: {},
      });

      if (decision.action === 'ALLOW' && decision.reason === 'ACTIVE_GRANT') {
        // Critical: Do NOT delete grant here! Grant must survive until onCommitted.
        return { action: 'ALLOW', reason: 'ACTIVE_GRANT' };
      }

      if (decision.action === 'ALLOW') {
        return { action: 'ALLOW', reason: decision.reason };
      }

      // Route to intervention
      const nonce = `nonce_${now}_${Math.random().toString(36).slice(2, 6)}`;
      const pending: PendingIntervention = {
        id: `intv_${now}`,
        tabId,
        targetUrl: url,
        collectionId: decision.collectionId || '',
        matchedRuleId: decision.matchedRuleId,
        interventionType: 'CONFIRM',
        durationSeconds: 0,
        requireIntentionText: false,
        createdAt: now,
        updatedAt: now,
        nonce,
        status: 'PENDING',
      };

      await this.storage.updateState((draft: MomentStorageEnvelope) => {
        draft.runtime.pendingInterventions[String(tabId)] = pending;
      });

      const routeTo = `ui/intervene/intervene.html?target=${encodeURIComponent(url)}&tabId=${tabId}&nonce=${nonce}`;
      return { action: 'INTERVENE', reason: decision.reason, routeTo };
    }

    // Simulates COMPLETE_INTERVENTION message handler
    async completeIntervention(tabId: number, targetUrl: string, nonce: string, now: number = Date.now()): Promise<{ success: boolean; data?: any; error?: string }> {
      if (!isSafeDestination(targetUrl)) {
        return { success: false, error: 'Unsafe destination' };
      }

      const canonicalTarget = parseCanonicalUrl(targetUrl);
      const normalizedTargetUrl = canonicalTarget ? toCanonicalString(canonicalTarget) : targetUrl;
      let grantCreated: TemporaryAccessGrant | null = null;

      try {
        await this.storage.updateState((draft: MomentStorageEnvelope) => {
          const key = String(tabId);
          const pending = draft.runtime.pendingInterventions[key];

          if (!pending) throw new Error('No pending intervention');
          if (pending.nonce !== nonce) throw new Error('Nonce mismatch');

          const pendingCanonical = parseCanonicalUrl(pending.targetUrl);
          const targetCanonical = parseCanonicalUrl(targetUrl);
          const targetsMatch =
            pending.targetUrl === targetUrl ||
            (pendingCanonical && targetCanonical && toCanonicalString(pendingCanonical) === toCanonicalString(targetCanonical));

          if (!targetsMatch) throw new Error('Target mismatch');
          if (isInterventionExpired(pending, now)) {
            delete draft.runtime.pendingInterventions[key];
            throw new Error('Intervention expired');
          }

          let effectiveStatus = pending.status;
          if (effectiveStatus === 'PENDING') {
            effectiveStatus = 'PRESENTED';
          }
          if (!canTransition(effectiveStatus, 'COMPLETED')) {
            throw new Error(`Cannot transition from ${pending.status}`);
          }

          delete draft.runtime.pendingInterventions[key];

          const grantDuration = resolveGrantDuration(0);
          const grant: TemporaryAccessGrant = {
            id: `grant_${now}`,
            tabId,
            target: normalizedTargetUrl,
            grantedAt: now,
            expiresAt: now + grantDuration,
            nonce,
            singleUse: true,
          };

          draft.runtime.temporaryAccessGrants[key] = grant;
          grantCreated = grant;
        });

        return { success: true, data: { targetUrl: normalizedTargetUrl, grant: grantCreated } };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }

    // Simulates CANCEL_INTERVENTION message handler
    async cancelIntervention(tabId: number, nonce: string): Promise<{ success: boolean; error?: string }> {
      let cancelled = false;
      await this.storage.updateState((draft: MomentStorageEnvelope) => {
        const key = String(tabId);
        const pending = draft.runtime.pendingInterventions[key];
        if (!pending || pending.nonce !== nonce) return;

        delete draft.runtime.pendingInterventions[key];
        delete draft.runtime.temporaryAccessGrants[key];
        cancelled = true;
      });

      return { success: cancelled };
    }

    // Simulates onNavigationCommitted (consumption timing)
    async onNavigationCommitted(tabId: number, url: string, now: number = Date.now()) {
      const state = await this.storage.getState();
      const currentGrant = state.runtime.temporaryAccessGrants[String(tabId)];
      if (currentGrant && currentGrant.singleUse) {
        if (isGrantValidForNavigation(currentGrant, tabId, url, now)) {
          await this.storage.updateState((draft: MomentStorageEnvelope) => {
            const g = draft.runtime.temporaryAccessGrants[String(tabId)];
            if (g && g.id === currentGrant.id) {
              delete draft.runtime.temporaryAccessGrants[String(tabId)];
            }
          });
        }
      }
    }

    // Simulates onTabRemoved
    async onTabRemoved(tabId: number) {
      await this.storage.updateState((draft: MomentStorageEnvelope) => {
        const key = String(tabId);
        delete draft.runtime.pendingInterventions[key];
        delete draft.runtime.temporaryAccessGrants[key];
      });
    }
  }

  // 1 & 2. Complete intervention -> destination loads exactly once without second intervention
  it('1 & 2. Complete intervention allows destination navigation without second intervention loop', async () => {
    const sim = new BackgroundSimulator();
    await sim.init();
    const tabId = 1;
    const url = 'https://example.com/';
    const now = 10000;

    // Initial navigation intercepted
    const nav1 = await sim.onBeforeNavigate(tabId, url, now);
    assert.equal(nav1.action, 'INTERVENE');
    assert.ok(nav1.routeTo?.includes('ui/intervene/intervene.html'));

    // Extract nonce
    const state1 = await sim.storage.getState();
    const nonce = state1.runtime.pendingInterventions[String(tabId)].nonce;

    // Complete intervention
    const completeRes = await sim.completeIntervention(tabId, url, nonce, now + 100);
    assert.equal(completeRes.success, true);
    assert.equal(completeRes.data?.targetUrl, url);

    // Destination navigation begins (onBeforeNavigate)
    const destNav = await sim.onBeforeNavigate(tabId, url, now + 200);
    assert.equal(destNav.action, 'ALLOW');
    assert.equal(destNav.reason, 'ACTIVE_GRANT');

    // Navigation commits
    await sim.onNavigationCommitted(tabId, url, now + 300);

    // Grant is consumed; destination is loaded. No second intervention occurred.
    const stateAfterCommit = await sim.storage.getState();
    assert.equal(stateAfterCommit.runtime.temporaryAccessGrants[String(tabId)], undefined);
  });

  // 3. Grant persists through destination navigation (survives onBeforeNavigate)
  it('3. Grant survives through initial onBeforeNavigate without premature deletion', async () => {
    const sim = new BackgroundSimulator();
    await sim.init();
    const tabId = 2;
    const url = 'https://example.com/';
    const now = 10000;

    await sim.onBeforeNavigate(tabId, url, now);
    const state = await sim.storage.getState();
    const nonce = state.runtime.pendingInterventions[String(tabId)].nonce;

    await sim.completeIntervention(tabId, url, nonce, now + 100);

    // Initial onBeforeNavigate should NOT delete grant
    const nav = await sim.onBeforeNavigate(tabId, url, now + 200);
    assert.equal(nav.action, 'ALLOW');
    assert.equal(nav.reason, 'ACTIVE_GRANT');

    // Assert grant is STILL in storage before commit
    const stateBeforeCommit = await sim.storage.getState();
    assert.ok(stateBeforeCommit.runtime.temporaryAccessGrants[String(tabId)], 'Grant must persist until commit');
  });

  // 4. Grant is consumed exactly once upon top-level commit
  it('4. Grant is consumed exactly once upon commit and cannot be reused for subsequent reloads', async () => {
    const sim = new BackgroundSimulator();
    await sim.init();
    const tabId = 3;
    const url = 'https://example.com/';
    const now = 10000;

    await sim.onBeforeNavigate(tabId, url, now);
    const state = await sim.storage.getState();
    const nonce = state.runtime.pendingInterventions[String(tabId)].nonce;
    await sim.completeIntervention(tabId, url, nonce, now + 50);

    // Allowed
    await sim.onBeforeNavigate(tabId, url, now + 100);
    // Commits
    await sim.onNavigationCommitted(tabId, url, now + 200);

    // Page Reload (F5) should now be intercepted because single-use grant was consumed
    const reloadNav = await sim.onBeforeNavigate(tabId, url, now + 300);
    assert.equal(reloadNav.action, 'INTERVENE', 'Reload after consumption must trigger fresh policy evaluation');
  });

  // 5. Expired grant causes intervention
  it('5. Expired grant is ignored by onBeforeNavigate and triggers intervention', async () => {
    const sim = new BackgroundSimulator();
    await sim.init();
    const tabId = 4;
    const url = 'https://example.com/';
    const now = 10000;

    // Manually inject an expired grant
    await sim.storage.updateState((draft: MomentStorageEnvelope) => {
      draft.runtime.temporaryAccessGrants[String(tabId)] = {
        id: 'g_expired',
        tabId,
        target: url,
        grantedAt: now - 700_000,
        expiresAt: now - 100_000, // Expired in the past
        nonce: 'nonce_old',
        singleUse: true,
      };
    });

    const nav = await sim.onBeforeNavigate(tabId, url, now);
    assert.equal(nav.action, 'INTERVENE');
    assert.ok(nav.reason !== 'ACTIVE_GRANT');
  });

  // 6. Cancellation does not loop
  it('6. Cancellation cleans up pending intervention and allows safe neutral page navigation without loop', async () => {
    const sim = new BackgroundSimulator();
    await sim.init();
    const tabId = 5;
    const url = 'https://example.com/';
    const now = 10000;

    await sim.onBeforeNavigate(tabId, url, now);
    const state1 = await sim.storage.getState();
    const nonce = state1.runtime.pendingInterventions[String(tabId)].nonce;

    // User clicks "Turn Back"
    const cancelRes = await sim.cancelIntervention(tabId, nonce);
    assert.equal(cancelRes.success, true);

    // Storage is clean
    const state2 = await sim.storage.getState();
    assert.equal(state2.runtime.pendingInterventions[String(tabId)], undefined);
    assert.equal(state2.runtime.temporaryAccessGrants[String(tabId)], undefined);

    // Resulting navigation to about:blank (neutral page) is allowed without policy intervention
    const blankNav = await sim.onBeforeNavigate(tabId, 'about:blank', now + 100);
    assert.equal(blankNav.action, 'ALLOW');
    assert.ok(blankNav.action !== 'INTERVENE');
  });

  // 7. Stale pending state is cleaned up
  it('7. Stale or expired pending intervention cannot be completed', async () => {
    const sim = new BackgroundSimulator();
    await sim.init();
    const tabId = 6;
    const url = 'https://example.com/';
    const now = 10000;

    await sim.onBeforeNavigate(tabId, url, now);
    const state = await sim.storage.getState();
    const nonce = state.runtime.pendingInterventions[String(tabId)].nonce;

    // Attempting completion after 20 minutes (expired)
    const res = await sim.completeIntervention(tabId, url, nonce, now + 20 * 60 * 1000);
    assert.equal(res.success, false);
    assert.ok(res.error?.includes('expired') || res.error?.includes('Invalid'));
  });

  // 8. Same-origin redirect behavior
  it('8. Same-origin redirect survives through onBeforeNavigate and commits successfully', async () => {
    const sim = new BackgroundSimulator();
    await sim.init();
    const tabId = 7;
    const initialUrl = 'https://example.com/';
    const redirectUrl = 'https://example.com/dashboard';
    const now = 10000;

    await sim.onBeforeNavigate(tabId, initialUrl, now);
    const state = await sim.storage.getState();
    const nonce = state.runtime.pendingInterventions[String(tabId)].nonce;
    await sim.completeIntervention(tabId, initialUrl, nonce, now + 50);

    // Hop 1: Initial URL
    const hop1 = await sim.onBeforeNavigate(tabId, initialUrl, now + 100);
    assert.equal(hop1.action, 'ALLOW');
    assert.equal(hop1.reason, 'ACTIVE_GRANT');

    // Hop 2: Same-origin redirect to /dashboard
    const hop2 = await sim.onBeforeNavigate(tabId, redirectUrl, now + 200);
    assert.equal(hop2.action, 'ALLOW', 'Same-origin redirect must be authorized by the grant');
    assert.equal(hop2.reason, 'ACTIVE_GRANT');

    // Navigation commits at /dashboard
    await sim.onNavigationCommitted(tabId, redirectUrl, now + 300);

    // Consumed upon commit
    const finalState = await sim.storage.getState();
    assert.equal(finalState.runtime.temporaryAccessGrants[String(tabId)], undefined);
  });

  // 9. Unrelated-origin redirect behavior
  it('9. Unrelated-origin redirect is strictly rejected by the grant and intercepted', async () => {
    const sim = new BackgroundSimulator();
    await sim.init();
    const tabId = 8;
    const initialUrl = 'https://example.com/';
    const evilRedirectUrl = 'https://reddit.com/r/all';
    const now = 10000;

    await sim.onBeforeNavigate(tabId, initialUrl, now);
    const state = await sim.storage.getState();
    const nonce = state.runtime.pendingInterventions[String(tabId)].nonce;
    await sim.completeIntervention(tabId, initialUrl, nonce, now + 50);

    // Hop 1: Initial URL allowed
    const hop1 = await sim.onBeforeNavigate(tabId, initialUrl, now + 100);
    assert.equal(hop1.action, 'ALLOW');

    // Hop 2: Redirect to unrelated blocked site (reddit.com)
    const hop2 = await sim.onBeforeNavigate(tabId, evilRedirectUrl, now + 200);
    assert.equal(hop2.action, 'INTERVENE', 'Unrelated origin must NOT inherit grant');
  });

  // 10. Multi-tab grant isolation
  it('10. Multi-tab isolation: Grant in Tab A does NOT authorize same site in Tab B', async () => {
    const sim = new BackgroundSimulator();
    await sim.init();
    const tabA = 10;
    const tabB = 20;
    const url = 'https://example.com/';
    const now = 10000;

    // Tab A gets intervention and completes it
    await sim.onBeforeNavigate(tabA, url, now);
    const stateA = await sim.storage.getState();
    const nonceA = stateA.runtime.pendingInterventions[String(tabA)].nonce;
    await sim.completeIntervention(tabA, url, nonceA, now + 50);

    // Tab A is authorized
    const navA = await sim.onBeforeNavigate(tabA, url, now + 100);
    assert.equal(navA.action, 'ALLOW');
    assert.equal(navA.reason, 'ACTIVE_GRANT');

    // Tab B attempts same URL -> must be INTERCEPTED
    const navB = await sim.onBeforeNavigate(tabB, url, now + 150);
    assert.equal(navB.action, 'INTERVENE', 'Tab B must not be authorized by Tab A grant');
  });

  // 11. Intervention-page reload
  it('11. Replaying or re-completing intervention fails cleanly without creating duplicate grants', async () => {
    const sim = new BackgroundSimulator();
    await sim.init();
    const tabId = 11;
    const url = 'https://example.com/';
    const now = 10000;

    await sim.onBeforeNavigate(tabId, url, now);
    const state = await sim.storage.getState();
    const nonce = state.runtime.pendingInterventions[String(tabId)].nonce;

    // First completion succeeds
    const res1 = await sim.completeIntervention(tabId, url, nonce, now + 50);
    assert.equal(res1.success, true);

    // Replay attempt with same nonce
    const res2 = await sim.completeIntervention(tabId, url, nonce, now + 100);
    assert.equal(res2.success, false);
    assert.ok(res2.error?.includes('No pending intervention'));
  });

  // 12. Tab close cleanup
  it('12. Tab closure completely cleans up pending interventions and temporary access grants', async () => {
    const sim = new BackgroundSimulator();
    await sim.init();
    const tabId = 12;
    const url = 'https://example.com/';
    const now = 10000;

    // Start intervention
    await sim.onBeforeNavigate(tabId, url, now);
    const state1 = await sim.storage.getState();
    const nonce = state1.runtime.pendingInterventions[String(tabId)].nonce;
    await sim.completeIntervention(tabId, url, nonce, now + 50);

    // Assert grant exists in storage
    const state2 = await sim.storage.getState();
    assert.ok(state2.runtime.temporaryAccessGrants[String(tabId)]);

    // Tab closed
    await sim.onTabRemoved(tabId);

    // Assert completely cleaned up
    const stateAfterClose = await sim.storage.getState();
    assert.equal(stateAfterClose.runtime.pendingInterventions[String(tabId)], undefined);
    assert.equal(stateAfterClose.runtime.temporaryAccessGrants[String(tabId)], undefined);
  });
});
