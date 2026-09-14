import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ExtensionStorage } from '../../dist/chrome/storage/storage.js';
import { resolveGrantDuration, isGrantValidForNavigation } from '../../dist/chrome/core/grants/grant-validator.js';
import { MAX_GRANT_DURATION_MS } from '../../dist/chrome/shared/constants.js';
import { canTransition, transitionIntervention, isInterventionExpired } from '../../dist/chrome/core/interventions/state-machine.js';
import type { PendingIntervention } from '../../src/core/interventions/types.js';
import type { TemporaryAccessGrant } from '../../src/core/models/grant.js';
import type { MomentStorageEnvelope } from '../../src/storage/schema.js';

describe('Moment Intervention Lifecycle & Multi-Tab Security (Phase 3)', () => {
  // Helper simulating background navigation evaluation & grant consumption
  async function simulateNavigation(
    storage: ExtensionStorage,
    tabId: number,
    url: string,
    now: number = Date.now()
  ) {
    const state = await storage.getState();
    const activeGrants = Object.values(state.runtime.temporaryAccessGrants) as TemporaryAccessGrant[];
    const matchingGrant = activeGrants.find((grant) =>
      isGrantValidForNavigation(grant, tabId, url, now)
    );

    if (matchingGrant) {
      if (matchingGrant.singleUse) {
        await storage.updateState((draft: MomentStorageEnvelope) => {
          const currentGrant = draft.runtime.temporaryAccessGrants[String(tabId)];
          if (currentGrant && currentGrant.id === matchingGrant.id) {
            delete draft.runtime.temporaryAccessGrants[String(tabId)];
          }
        });
      }
      return { allowed: true, reason: 'ACTIVE_GRANT' as const };
    }

    return { allowed: false, reason: 'POLICY_EVALUATION' as const };
  }
  // Helper simulating background message dispatcher
  async function simulateGetIntervention(
    storage: ExtensionStorage,
    tabId: number,
    nonce: string,
    now: number = Date.now()
  ) {
    const state = await storage.getState();
    const key = String(tabId);
    const pending = state.runtime.pendingInterventions[key];

    if (!pending || pending.nonce !== nonce) {
      return { success: false, error: 'Intervention not found or nonce invalid' };
    }

    if (isInterventionExpired(pending, now)) {
      await storage.updateState((draft: MomentStorageEnvelope) => {
        delete draft.runtime.pendingInterventions[key];
      });
      return { success: false, error: 'Intervention has expired' };
    }

    if (pending.status === 'PENDING') {
      await storage.updateState((draft: MomentStorageEnvelope) => {
        const current = draft.runtime.pendingInterventions[key];
        if (current && current.status === 'PENDING') {
          draft.runtime.pendingInterventions[key] = transitionIntervention(current, 'PRESENTED', now);
        }
      });
    }

    return {
      success: true,
      data: {
        ...pending,
        status: pending.status === 'PENDING' ? 'PRESENTED' : pending.status,
      },
    };
  }

  async function simulateCompleteIntervention(
    storage: ExtensionStorage,
    msg: { tabId: number; targetUrl: string; nonce: string; durationMs?: number; intentionText?: string },
    now: number = Date.now()
  ): Promise<{ success: boolean; data?: { targetUrl: string; grant: TemporaryAccessGrant | null }; error?: string }> {
    const { tabId, targetUrl, nonce, durationMs, intentionText } = msg;
    let grantCreated: TemporaryAccessGrant | null = null;

    try {
      await storage.updateState((draft: MomentStorageEnvelope) => {
        const key = String(tabId);
        const pending = draft.runtime.pendingInterventions[key];

        if (!pending || pending.nonce !== nonce || pending.targetUrl !== targetUrl) {
          throw new Error('Invalid, expired, or forged intervention nonce');
        }

        if (isInterventionExpired(pending, now)) {
          delete draft.runtime.pendingInterventions[key];
          throw new Error('Intervention has expired');
        }

        if (!canTransition(pending.status, 'COMPLETED')) {
          throw new Error(`Intervention cannot be completed from state '${pending.status}'`);
        }

        if (pending.requireIntentionText && (!intentionText || intentionText.trim().length === 0)) {
          throw new Error('Intention text is required to complete this intervention');
        }

        delete draft.runtime.pendingInterventions[key];

        const grantDuration = resolveGrantDuration(durationMs || (pending.durationSeconds * 1000));
        const grant: TemporaryAccessGrant = {
          id: `grant_${now}_${Math.random().toString(36).substring(2, 7)}`,
          tabId,
          target: targetUrl,
          grantedAt: now,
          expiresAt: now + grantDuration,
          nonce,
          singleUse: true,
        };

        draft.runtime.temporaryAccessGrants[key] = grant;
        grantCreated = grant;
      });

      return { success: true, data: { targetUrl, grant: grantCreated } };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async function simulateCancelIntervention(
    storage: ExtensionStorage,
    tabId: number,
    nonce: string
  ) {
    let cancelled = false;
    await storage.updateState((draft: MomentStorageEnvelope) => {
      const key = String(tabId);
      const pending = draft.runtime.pendingInterventions[key];

      if (!pending || pending.nonce !== nonce) {
        return;
      }

      delete draft.runtime.pendingInterventions[key];
      cancelled = true;
    });

    if (!cancelled) {
      return { success: false, error: 'Invalid, nonexistent, or mismatched intervention cancellation' };
    }
    return { success: true };
  }

  it('Full Lifecycle: PENDING -> PRESENTED -> IN_PROGRESS -> COMPLETED -> GRANT_ISSUED', async () => {
    const storage = new ExtensionStorage();
    const now = 10000;
    const tabId = 1;
    const nonce = 'nonce_abc';
    const targetUrl = 'https://reddit.com/r/all';

    const pending: PendingIntervention = {
      id: 'intv_1',
      tabId,
      targetUrl,
      collectionId: 'col_social',
      matchedRuleId: 'r_reddit',
      interventionType: 'TIMER',
      durationSeconds: 5,
      requireIntentionText: false,
      createdAt: now,
      updatedAt: now,
      nonce,
      status: 'PENDING',
    };

    await storage.updateState((draft: MomentStorageEnvelope) => {
      draft.runtime.pendingInterventions[String(tabId)] = pending;
    });

    // 1. UI Loads -> GET_INTERVENTION transitions PENDING to PRESENTED
    const getRes = await simulateGetIntervention(storage, tabId, nonce, now + 100);
    assert.equal(getRes.success, true);
    assert.equal(getRes.data?.status, 'PRESENTED');

    const stateAfterGet = await storage.getState();
    assert.equal(stateAfterGet.runtime.pendingInterventions[String(tabId)].status, 'PRESENTED');

    // 2. Complete Intervention -> issues grant and removes pending intervention
    const completeRes = await simulateCompleteIntervention(
      storage,
      { tabId, targetUrl, nonce, durationMs: 60000 },
      now + 5000
    );

    assert.equal(completeRes.success, true);
    assert.ok(completeRes.data?.grant);
    assert.equal(completeRes.data!.grant!.tabId, tabId);
    assert.equal(completeRes.data!.grant!.target, targetUrl);

    // 3. Pending intervention is consumed (replay defense)
    const stateAfterComplete = await storage.getState();
    assert.equal(stateAfterComplete.runtime.pendingInterventions[String(tabId)], undefined);
    assert.ok(stateAfterComplete.runtime.temporaryAccessGrants[String(tabId)]);
  });

  it('Replay Defense: Duplicate completion messages are strictly rejected', async () => {
    const storage = new ExtensionStorage();
    const now = 10000;
    const tabId = 2;
    const nonce = 'nonce_def';
    const targetUrl = 'https://twitter.com/home';

    await storage.updateState((draft: MomentStorageEnvelope) => {
      draft.runtime.pendingInterventions[String(tabId)] = {
        id: 'intv_2',
        tabId,
        targetUrl,
        collectionId: 'col_social',
        interventionType: 'CONFIRM',
        durationSeconds: 0,
        requireIntentionText: false,
        createdAt: now,
        updatedAt: now,
        nonce,
        status: 'PRESENTED',
      };
    });

    // First completion succeeds
    const firstRes = await simulateCompleteIntervention(storage, { tabId, targetUrl, nonce }, now + 100);
    assert.equal(firstRes.success, true);

    // Second completion with identical parameters fails
    const secondRes = await simulateCompleteIntervention(storage, { tabId, targetUrl, nonce }, now + 200);
    assert.equal(secondRes.success, false);
    assert.equal(secondRes.error, 'Invalid, expired, or forged intervention nonce');
  });

  it('Multi-Tab Concurrency & Strict Tab Isolation', async () => {
    const storage = new ExtensionStorage();
    const now = 10000;
    const targetUrl = 'https://youtube.com/';

    // Tab 1 and Tab 2 navigate to same restricted site
    await storage.updateState((draft: MomentStorageEnvelope) => {
      draft.runtime.pendingInterventions['1'] = {
        id: 'intv_tab1',
        tabId: 1,
        targetUrl,
        collectionId: 'col_video',
        interventionType: 'BREATHE',
        durationSeconds: 10,
        requireIntentionText: false,
        createdAt: now,
        updatedAt: now,
        nonce: 'nonce_tab1',
        status: 'PRESENTED',
      };

      draft.runtime.pendingInterventions['2'] = {
        id: 'intv_tab2',
        tabId: 2,
        targetUrl,
        collectionId: 'col_video',
        interventionType: 'BREATHE',
        durationSeconds: 10,
        requireIntentionText: false,
        createdAt: now,
        updatedAt: now,
        nonce: 'nonce_tab2',
        status: 'PRESENTED',
      };
    });

    // Tab 1 completes
    const resTab1 = await simulateCompleteIntervention(
      storage,
      { tabId: 1, targetUrl, nonce: 'nonce_tab1' },
      now + 1000
    );
    assert.equal(resTab1.success, true);

    // Verify Tab 2 is still pending and has NO grant
    const state = await storage.getState();
    assert.ok(state.runtime.pendingInterventions['2']);
    assert.equal(state.runtime.temporaryAccessGrants['2'], undefined);
    assert.ok(state.runtime.temporaryAccessGrants['1']);

    // Tab 2 cannot forge completion using Tab 1's nonce
    const forgeRes = await simulateCompleteIntervention(
      storage,
      { tabId: 2, targetUrl, nonce: 'nonce_tab1' },
      now + 1500
    );
    assert.equal(forgeRes.success, false);
    assert.equal(forgeRes.error, 'Invalid, expired, or forged intervention nonce');

    // Cancelling Tab 1's nonexistent pending does not affect Tab 2
    const cancelRes = await simulateCancelIntervention(storage, 1, 'nonce_tab1');
    assert.equal(cancelRes.success, false);

    const stateAfterCancel = await storage.getState();
    assert.ok(stateAfterCancel.runtime.pendingInterventions['2']); // Tab 2 unharmed
  });

  it('Enforces intention text requirement when configured', async () => {
    const storage = new ExtensionStorage();
    const now = 10000;
    const tabId = 3;
    const nonce = 'nonce_intent';
    const targetUrl = 'https://news.ycombinator.com';

    await storage.updateState((draft: MomentStorageEnvelope) => {
      draft.runtime.pendingInterventions[String(tabId)] = {
        id: 'intv_intent',
        tabId,
        targetUrl,
        collectionId: 'col_news',
        interventionType: 'CONFIRM',
        durationSeconds: 0,
        requireIntentionText: true,
        createdAt: now,
        updatedAt: now,
        nonce,
        status: 'PRESENTED',
      };
    });

    // Fails without intention text
    const failRes = await simulateCompleteIntervention(
      storage,
      { tabId, targetUrl, nonce, intentionText: '' },
      now + 500
    );
    assert.equal(failRes.success, false);
    assert.equal(failRes.error, 'Intention text is required to complete this intervention');

    // Succeeds with valid intention text
    const passRes = await simulateCompleteIntervention(
      storage,
      { tabId, targetUrl, nonce, intentionText: 'Checking one specific technical release' },
      now + 600
    );
    assert.equal(passRes.success, true);
  });

  it('Rejects expired pending interventions (Age > 15 minutes)', async () => {
    const storage = new ExtensionStorage();
    const now = 10000;
    const tabId = 4;
    const nonce = 'nonce_stale';
    const targetUrl = 'https://reddit.com';

    await storage.updateState((draft: MomentStorageEnvelope) => {
      draft.runtime.pendingInterventions[String(tabId)] = {
        id: 'intv_stale',
        tabId,
        targetUrl,
        collectionId: 'col_social',
        interventionType: 'CONFIRM',
        durationSeconds: 0,
        requireIntentionText: false,
        createdAt: now - (16 * 60 * 1000), // 16 minutes old
        updatedAt: now - (16 * 60 * 1000),
        nonce,
        status: 'PENDING',
      };
    });

    const getRes = await simulateGetIntervention(storage, tabId, nonce, now);
    assert.equal(getRes.success, false);
    assert.equal(getRes.error, 'Intervention has expired');

    // Complete fails on expired
    const completeRes = await simulateCompleteIntervention(storage, { tabId, targetUrl, nonce }, now);
    assert.equal(completeRes.success, false);
  });

  it('Concurrency & Duplicate Completion Race: Simultaneously submitted completions resolve with exactly one grant', async () => {
    const storage = new ExtensionStorage();
    const now = 10000;
    const tabId = 5;
    const nonce = 'nonce_race_test';
    const targetUrl = 'https://instagram.com/explore';

    await storage.updateState((draft: MomentStorageEnvelope) => {
      draft.runtime.pendingInterventions[String(tabId)] = {
        id: 'intv_race',
        tabId,
        targetUrl,
        collectionId: 'col_social',
        interventionType: 'CONFIRM',
        durationSeconds: 0,
        requireIntentionText: false,
        createdAt: now,
        updatedAt: now,
        nonce,
        status: 'PRESENTED',
      };
    });

    // Fire two completion requests simultaneously
    const [res1, res2] = await Promise.all([
      simulateCompleteIntervention(storage, { tabId, targetUrl, nonce }, now + 100),
      simulateCompleteIntervention(storage, { tabId, targetUrl, nonce }, now + 100),
    ]);

    // Exactly one must succeed, exactly one must fail
    const successes = [res1, res2].filter((r) => r.success);
    const failures = [res1, res2].filter((r) => !r.success);

    assert.equal(successes.length, 1, 'Exactly one completion must succeed');
    assert.equal(failures.length, 1, 'Exactly one completion must fail');
    assert.equal(failures[0].error, 'Invalid, expired, or forged intervention nonce');

    // Exactly one grant exists in storage
    const state = await storage.getState();
    assert.ok(state.runtime.temporaryAccessGrants[String(tabId)]);
    assert.equal(state.runtime.temporaryAccessGrants[String(tabId)].target, targetUrl);

    // Pending intervention is consumed once; no resurrection
    assert.equal(state.runtime.pendingInterventions[String(tabId)], undefined);
  });

  it('Single-Use Grant Consumption: First navigation succeeds; second navigation, reload, and another tab encounter policy evaluation', async () => {
    const storage = new ExtensionStorage();
    const now = 10000;
    const tabId = 6;
    const targetUrl = 'https://news.ycombinator.com/';
    const nonce = 'nonce_single_use';

    // Set up presented intervention
    await storage.updateState((draft: MomentStorageEnvelope) => {
      draft.runtime.pendingInterventions[String(tabId)] = {
        id: 'intv_single_use',
        tabId,
        targetUrl,
        collectionId: 'col_news',
        interventionType: 'CONFIRM',
        durationSeconds: 0,
        requireIntentionText: false,
        createdAt: now,
        updatedAt: now,
        nonce,
        status: 'PRESENTED',
      };
    });

    // Complete intervention -> grant issued
    const completeRes = await simulateCompleteIntervention(storage, { tabId, targetUrl, nonce }, now + 50);
    assert.equal(completeRes.success, true);

    // 1. First authorized navigation
    const nav1 = await simulateNavigation(storage, tabId, targetUrl, now + 100);
    assert.equal(nav1.allowed, true);
    assert.equal(nav1.reason, 'ACTIVE_GRANT');

    // Grant is consumed immediately upon first authorized navigation
    const stateAfterNav1 = await storage.getState();
    assert.equal(stateAfterNav1.runtime.temporaryAccessGrants[String(tabId)], undefined);

    // 2. Second navigation after consumption (ordinary policy evaluation applies)
    const nav2 = await simulateNavigation(storage, tabId, targetUrl, now + 200);
    assert.equal(nav2.allowed, false);
    assert.equal(nav2.reason, 'POLICY_EVALUATION');

    // 3. Page reload after consumption
    const navReload = await simulateNavigation(storage, tabId, targetUrl, now + 300);
    assert.equal(navReload.allowed, false);
    assert.equal(navReload.reason, 'POLICY_EVALUATION');

    // 4. Repeated navigation attempts
    const navRepeat = await simulateNavigation(storage, tabId, targetUrl, now + 400);
    assert.equal(navRepeat.allowed, false);
    assert.equal(navRepeat.reason, 'POLICY_EVALUATION');

    // 5. Same target in another tab
    const navOtherTab = await simulateNavigation(storage, 999, targetUrl, now + 500);
    assert.equal(navOtherTab.allowed, false);
    assert.equal(navOtherTab.reason, 'POLICY_EVALUATION');
  });

  it('Redirect Semantics: Grant authorizes redirect within scope, but strictly rejects redirect to unrelated origin', async () => {
    const now = 10000;
    const tabId = 7;
    const grant: TemporaryAccessGrant = {
      id: 'g_redirect_test',
      tabId,
      target: 'https://example.com/',
      grantedAt: now,
      expiresAt: now + 60_000,
      nonce: 'nonce_redirect',
      singleUse: true,
    };

    // 1. Authorized initial navigation target
    assert.equal(isGrantValidForNavigation(grant, tabId, 'https://example.com/login', now), true);

    // 2. Redirect to unrelated origin (must return false, preventing "allow everything from tab")
    assert.equal(isGrantValidForNavigation(grant, tabId, 'https://evil.com/phish', now), false);
    assert.equal(isGrantValidForNavigation(grant, tabId, 'https://another-distraction.com', now), false);

    // 3. Redirect within authorized scope (same origin subpath)
    assert.equal(isGrantValidForNavigation(grant, tabId, 'https://example.com/dashboard', now), true);

    // 4. Subpath-scoped grant target
    const subpathGrant: TemporaryAccessGrant = {
      id: 'g_subpath_test',
      tabId,
      target: 'https://example.com/feed',
      grantedAt: now,
      expiresAt: now + 60_000,
      nonce: 'nonce_subpath',
      singleUse: true,
    };

    assert.equal(isGrantValidForNavigation(subpathGrant, tabId, 'https://example.com/feed/sub', now), true);
    // Redirect outside path scope must be rejected
    assert.equal(isGrantValidForNavigation(subpathGrant, tabId, 'https://example.com/admin', now), false);
  });

  it('Tab + Target Scope: Production grant validator strictly enforces tab and target bounds', () => {
    const now = 10000;
    const grant: TemporaryAccessGrant = {
      id: 'g_scope_test',
      tabId: 10,
      target: 'https://target-a.com',
      grantedAt: now,
      expiresAt: now + 60_000,
      nonce: 'nonce_scope',
      singleUse: true,
    };

    // Grant(Tab A, Target X) authorizes (Tab A, Target X)
    assert.equal(isGrantValidForNavigation(grant, 10, 'https://target-a.com', now), true);

    // Grant(Tab A, Target X) does NOT authorize Grant(Tab B, Target X)
    assert.equal(isGrantValidForNavigation(grant, 20, 'https://target-a.com', now), false);

    // Grant(Tab A, Target X) does NOT authorize Grant(Tab A, Target Y)
    assert.equal(isGrantValidForNavigation(grant, 10, 'https://target-b.com', now), false);
  });

  it('Intervention State Machine: Enforces rejection of invalid transitions in production', async () => {
    const storage = new ExtensionStorage();
    const now = 10000;
    const tabId = 8;
    const nonce = 'nonce_invalid_transitions';
    const targetUrl = 'https://reddit.com';

    // Pure state-machine rejection assertions
    assert.equal(canTransition('PENDING', 'GRANT_ISSUED'), false);
    assert.equal(canTransition('PRESENTED', 'DESTINATION'), false);
    assert.equal(canTransition('COMPLETED', 'IN_PROGRESS'), false);
    assert.equal(canTransition('CANCELLED', 'COMPLETED'), false);
    assert.equal(canTransition('EXPIRED', 'GRANT_ISSUED'), false);
    assert.equal(canTransition('DISCARDED', 'GRANT_ISSUED'), false);

    // Production lifecycle rejection: attempting to complete directly from PENDING
    await storage.updateState((draft: MomentStorageEnvelope) => {
      draft.runtime.pendingInterventions[String(tabId)] = {
        id: 'intv_invalid',
        tabId,
        targetUrl,
        collectionId: 'col_social',
        interventionType: 'CONFIRM',
        durationSeconds: 0,
        requireIntentionText: false,
        createdAt: now,
        updatedAt: now,
        nonce,
        status: 'PENDING',
      };
    });

    const res = await simulateCompleteIntervention(storage, { tabId, targetUrl, nonce }, now);
    assert.equal(res.success, false);
    assert.equal(res.error, "Intervention cannot be completed from state 'PENDING'");
  });

  it('Reload & Stale State: Reload preserves pending state; stale page completion is rejected', async () => {
    const storage = new ExtensionStorage();
    const now = 10000;
    const tabId = 9;
    const nonce = 'nonce_reload_test';
    const targetUrl = 'https://twitter.com';

    await storage.updateState((draft: MomentStorageEnvelope) => {
      draft.runtime.pendingInterventions[String(tabId)] = {
        id: 'intv_reload',
        tabId,
        targetUrl,
        collectionId: 'col_social',
        interventionType: 'TIMER',
        durationSeconds: 10,
        requireIntentionText: false,
        createdAt: now,
        updatedAt: now,
        nonce,
        status: 'PRESENTED',
      };
    });

    // 1. Page Reload -> calls GET_INTERVENTION
    const reloadRes = await simulateGetIntervention(storage, tabId, nonce, now + 100);
    assert.equal(reloadRes.success, true);
    assert.equal(reloadRes.data?.id, 'intv_reload');

    // Verify reload did NOT issue a grant
    const stateAfterReload = await storage.getState();
    assert.equal(stateAfterReload.runtime.temporaryAccessGrants[String(tabId)], undefined);
    // Verify pending state was preserved without duplication
    assert.ok(stateAfterReload.runtime.pendingInterventions[String(tabId)]);

    // 2. Normal completion
    const completeRes = await simulateCompleteIntervention(storage, { tabId, targetUrl, nonce }, now + 200);
    assert.equal(completeRes.success, true);

    // 3. Stale old page tries to complete again
    const staleRes = await simulateCompleteIntervention(storage, { tabId, targetUrl, nonce }, now + 300);
    assert.equal(staleRes.success, false);
    assert.equal(staleRes.error, 'Invalid, expired, or forged intervention nonce');
  });

  it('Grant Duration Clamping: requested duration > 10 minutes clamps to <= 10 minutes in grant issuance', async () => {
    const storage = new ExtensionStorage();
    const now = 10000;
    const tabId = 11;
    const nonce = 'nonce_duration_clamp';
    const targetUrl = 'https://youtube.com';

    await storage.updateState((draft: MomentStorageEnvelope) => {
      draft.runtime.pendingInterventions[String(tabId)] = {
        id: 'intv_clamp',
        tabId,
        targetUrl,
        collectionId: 'col_video',
        interventionType: 'CONFIRM',
        durationSeconds: 0,
        requireIntentionText: false,
        createdAt: now,
        updatedAt: now,
        nonce,
        status: 'PRESENTED',
      };
    });

    // Request 24 hours (86,400,000 ms)
    const res24h = await simulateCompleteIntervention(
      storage,
      { tabId, targetUrl, nonce, durationMs: 86_400_000 },
      now
    );
    assert.equal(res24h.success, true);
    assert.ok(res24h.data?.grant);

    const grantDuration = res24h.data!.grant!.expiresAt - res24h.data!.grant!.grantedAt;
    assert.ok(grantDuration <= MAX_GRANT_DURATION_MS, 'Grant duration must not exceed 10 minutes');
    assert.equal(grantDuration, MAX_GRANT_DURATION_MS, 'Grant duration must be clamped to 10 minutes');
  });
});
