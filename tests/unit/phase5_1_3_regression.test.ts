/**
 * Phase 5.1.3 Regression Test Suite
 *
 * Verifies Site-Level Post-Intervention Cooldown (SitePass / SiteCooldown):
 * 1. Intervention completion creates SitePass.
 * 2. Original destination is allowed.
 * 3. Same-site subpage is allowed.
 * 4. Multiple same-site subpages are allowed.
 * 5. Same-site reload is allowed during pass.
 * 6. SitePass is tab-scoped.
 * 7. Another tab is still blocked/intervened.
 * 8. Unrelated domain is not allowed.
 * 9. Same-site redirects remain allowed.
 * 10. SitePass expiration returns to normal policy.
 * 11. Exact expiration boundary.
 * 12. SitePass survives worker persistence/restart.
 * 13. Tab close cleans SitePass.
 * 14. SitePass does not reset daily usage.
 * 15. Daily limit behavior remains correct.
 * 16. UI cannot create a SitePass.
 * 17. Underlying rule remains unchanged.
 * 18. TemporaryAccessGrant still has its existing single-use semantics.
 * 19. Existing intervention completion flow still works.
 * 20. Existing cancellation flow still works.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ExtensionStorage } from '../../dist/chrome/storage/storage.js';
import { MomentDecisionEngine } from '../../dist/chrome/core/decisions/engine.js';
import { isGrantValidForNavigation, resolveGrantDuration } from '../../dist/chrome/core/grants/grant-validator.js';
import {
  isSitePassValidForNavigation,
  resolveSiteScope,
  resolveSitePassDuration,
} from '../../dist/chrome/core/grants/site-pass-validator.js';
import { parseCanonicalUrl, toCanonicalString } from '../../dist/chrome/core/matching/url.js';
import { canTransition, isInterventionExpired } from '../../dist/chrome/core/interventions/state-machine.js';
import { isSafeDestination } from '../../dist/chrome/shared/urls.js';
import { isValidMessage } from '../../dist/chrome/shared/messages.js';
import { DEFAULT_SITE_PASS_DURATION_MS, MAX_SITE_PASS_DURATION_MS } from '../../dist/chrome/shared/constants.js';
import type { Collection } from '../../src/core/models/collection.js';
import type { PendingIntervention } from '../../src/core/interventions/types.js';
import type { TemporaryAccessGrant } from '../../src/core/models/grant.js';
import type { SitePass } from '../../src/core/models/site-pass.js';
import type { MomentStorageEnvelope } from '../../src/storage/schema.js';

describe('Phase 5.1.3: Site-Level Post-Intervention Cooldown (SitePass)', () => {
  const socialCollection: Collection = {
    id: 'col_social',
    name: 'Social Media',
    color: '#3b82f6',
    icon: 'heart',
    enabled: true,
    createdAt: 1000,
    updatedAt: 1000,
    dailyLimitMs: null,
    targets: [
      { id: 't_reddit', pattern: 'reddit.com', type: 'WEBSITE', isException: false, createdAt: 1000 },
      { id: 't_example', pattern: 'example.com', type: 'WEBSITE', isException: false, createdAt: 1000 },
      { id: 't_twitter', pattern: 'twitter.com', type: 'WEBSITE', isException: false, createdAt: 1000 },
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
   * Helper simulating the Phase 5.1.3 background navigation and message handling
   */
  class BackgroundSimulator {
    storage: ExtensionStorage;
    engine: MomentDecisionEngine;

    constructor(storage?: ExtensionStorage) {
      this.storage = storage || new ExtensionStorage();
      this.engine = new MomentDecisionEngine([socialCollection]);
    }

    async init() {
      await this.storage.updateState((draft: MomentStorageEnvelope) => {
        draft.collections[socialCollection.id] = socialCollection;
      });
    }

    // Simulates adapter.onNavigation
    async onBeforeNavigate(
      tabId: number,
      url: string,
      now: number = Date.now()
    ): Promise<{ action: string; reason: string; routeTo?: string; site?: string }> {
      // Step 1: Web scheme check
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return { action: 'ALLOW', reason: 'NON_WEB_SCHEME' };
      }

      const state = await this.storage.getState();

      // Step 2: Check TemporaryAccessGrant for immediate destination
      const currentGrant = state.runtime.temporaryAccessGrants?.[String(tabId)];
      if (currentGrant && isGrantValidForNavigation(currentGrant, tabId, url, now)) {
        return { action: 'ALLOW', reason: 'ACTIVE_GRANT' };
      }

      // Step 3: Check SitePass for tab + site post-intervention cooldown
      const sitePass = state.runtime.sitePasses?.[String(tabId)];
      if (sitePass) {
        if (isSitePassValidForNavigation(sitePass, tabId, url, now)) {
          return { action: 'ALLOW', reason: 'SITE_PASS', site: sitePass.site };
        } else if (now >= sitePass.expiresAt) {
          // Prune expired pass
          await this.storage.updateState((draft: MomentStorageEnvelope) => {
            const p = draft.runtime.sitePasses?.[String(tabId)];
            if (p && p.id === sitePass.id) {
              delete draft.runtime.sitePasses[String(tabId)];
            }
          });
        }
      }

      // Step 4: Core policy engine evaluation
      const activeGrants = (Object.values(state.runtime.temporaryAccessGrants || {}) as TemporaryAccessGrant[]).filter(
        (g) => g.expiresAt > now
      );

      this.engine.setCollections(state.collections);
      const decision = this.engine.evaluate({
        url,
        tabId,
        timestamp: now,
        activeGrants,
        collections: state.collections,
        dailyUsageMs: {},
      });

      if (decision.action === 'ALLOW') {
        return { action: 'ALLOW', reason: decision.reason };
      }

      if (decision.action === 'BLOCK') {
        return { action: 'BLOCK', reason: decision.reason };
      }

      // Intercept to intervention page
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

    // Simulates COMPLETE_INTERVENTION
    async completeIntervention(
      tabId: number,
      targetUrl: string,
      nonce: string,
      now: number = Date.now(),
      intentionText?: string
    ): Promise<{ success: boolean; data?: any; error?: string }> {
      if (!isSafeDestination(targetUrl)) {
        return { success: false, error: 'Unsafe destination' };
      }

      const canonicalTarget = parseCanonicalUrl(targetUrl);
      const normalizedTargetUrl = canonicalTarget ? toCanonicalString(canonicalTarget) : targetUrl;
      let grantCreated: TemporaryAccessGrant | null = null;
      let sitePassCreated: SitePass | null = null;

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
            (pendingCanonical &&
              targetCanonical &&
              toCanonicalString(pendingCanonical) === toCanonicalString(targetCanonical));

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

          if (pending.requireIntentionText && (!intentionText || intentionText.trim().length === 0)) {
            throw new Error('Intention text is required');
          }

          delete draft.runtime.pendingInterventions[key];

          // 1. Issue TemporaryAccessGrant (single-use, immediate navigation)
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

          // 2. Issue SitePass (post-intervention cooldown window) under WEBSITE semantics
          const col = draft.collections[pending.collectionId];
          const matchedRule = pending.matchedRuleId && col
            ? col.targets.find((t) => t.id === pending.matchedRuleId)
            : null;
          const siteScope = resolveSiteScope(normalizedTargetUrl, matchedRule);

          if (siteScope) {
            const pass: SitePass = {
              id: `pass_${now}`,
              tabId,
              site: siteScope,
              grantedAt: now,
              expiresAt: now + DEFAULT_SITE_PASS_DURATION_MS,
            };
            if (!draft.runtime.sitePasses) {
              draft.runtime.sitePasses = {};
            }
            draft.runtime.sitePasses[key] = pass;
            sitePassCreated = pass;
          }
        });

        return {
          success: true,
          data: { targetUrl: normalizedTargetUrl, grant: grantCreated, sitePass: sitePassCreated },
        };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }

    // Simulates CANCEL_INTERVENTION
    async cancelIntervention(tabId: number, nonce: string): Promise<{ success: boolean; error?: string }> {
      let cancelled = false;
      await this.storage.updateState((draft: MomentStorageEnvelope) => {
        const key = String(tabId);
        const pending = draft.runtime.pendingInterventions[key];
        if (!pending || pending.nonce !== nonce) return;

        delete draft.runtime.pendingInterventions[key];
        delete draft.runtime.temporaryAccessGrants[key];
        if (draft.runtime.sitePasses) {
          delete draft.runtime.sitePasses[key];
        }
        cancelled = true;
      });

      return { success: cancelled };
    }

    // Simulates onNavigationCommitted (single-use grant consumption)
    async onNavigationCommitted(tabId: number, url: string, now: number = Date.now()) {
      const state = await this.storage.getState();
      const currentGrant = state.runtime.temporaryAccessGrants?.[String(tabId)];
      if (currentGrant && currentGrant.singleUse) {
        if (isGrantValidForNavigation(currentGrant, tabId, url, now)) {
          await this.storage.updateState((draft: MomentStorageEnvelope) => {
            const g = draft.runtime.temporaryAccessGrants?.[String(tabId)];
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
        if (draft.runtime.sitePasses) {
          delete draft.runtime.sitePasses[key];
        }
      });
    }
  }

  // 1. Intervention completion creates SitePass
  it('1. Intervention completion creates SitePass with default 5-minute duration and canonical site', async () => {
    const sim = new BackgroundSimulator();
    await sim.init();
    const tabId = 1;
    const url = 'https://reddit.com/';
    const now = 10000;

    await sim.onBeforeNavigate(tabId, url, now);
    const state1 = await sim.storage.getState();
    const nonce = state1.runtime.pendingInterventions[String(tabId)].nonce;

    const res = await sim.completeIntervention(tabId, url, nonce, now + 100);
    assert.equal(res.success, true);
    assert.ok(res.data?.sitePass);
    assert.equal(res.data.sitePass.site, 'reddit.com');
    assert.equal(res.data.sitePass.tabId, tabId);
    assert.equal(res.data.sitePass.expiresAt, (now + 100) + DEFAULT_SITE_PASS_DURATION_MS);

    // Verify persisted in storage
    const state2 = await sim.storage.getState();
    const pass = state2.runtime.sitePasses[String(tabId)];
    assert.ok(pass);
    assert.equal(pass.site, 'reddit.com');
    assert.equal(pass.expiresAt, (now + 100) + DEFAULT_SITE_PASS_DURATION_MS);
  });

  // 2. Original destination is allowed
  it('2. Original destination is allowed upon completing intervention', async () => {
    const sim = new BackgroundSimulator();
    await sim.init();
    const tabId = 1;
    const url = 'https://reddit.com/';
    const now = 10000;

    await sim.onBeforeNavigate(tabId, url, now);
    const state1 = await sim.storage.getState();
    const nonce = state1.runtime.pendingInterventions[String(tabId)].nonce;
    await sim.completeIntervention(tabId, url, nonce, now + 100);

    const destNav = await sim.onBeforeNavigate(tabId, url, now + 200);
    assert.equal(destNav.action, 'ALLOW');
  });

  // 3. Same-site subpage is allowed after initial grant consumption
  it('3. Same-site subpage navigation is allowed after initial destination commits and consumes single-use grant', async () => {
    const sim = new BackgroundSimulator();
    await sim.init();
    const tabId = 1;
    const url = 'https://reddit.com/';
    const now = 10000;

    await sim.onBeforeNavigate(tabId, url, now);
    const state1 = await sim.storage.getState();
    const nonce = state1.runtime.pendingInterventions[String(tabId)].nonce;
    await sim.completeIntervention(tabId, url, nonce, now + 100);

    // Commit initial destination navigation -> consumes single-use TemporaryAccessGrant
    await sim.onNavigationCommitted(tabId, url, now + 300);

    const stateAfterCommit = await sim.storage.getState();
    assert.equal(stateAfterCommit.runtime.temporaryAccessGrants[String(tabId)], undefined, 'TemporaryAccessGrant must be consumed');
    assert.ok(stateAfterCommit.runtime.sitePasses[String(tabId)], 'SitePass must remain active');

    // Subpage navigation
    const subpageNav = await sim.onBeforeNavigate(tabId, 'https://reddit.com/r/sidemen', now + 500);
    assert.equal(subpageNav.action, 'ALLOW');
    assert.equal(subpageNav.reason, 'SITE_PASS');
  });

  // 4. Multiple same-site subpages are allowed
  it('4. Multiple sequential same-site subpages are allowed without triggering interventions', async () => {
    const sim = new BackgroundSimulator();
    await sim.init();
    const tabId = 1;
    const url = 'https://reddit.com/';
    const now = 10000;

    await sim.onBeforeNavigate(tabId, url, now);
    const state1 = await sim.storage.getState();
    const nonce = state1.runtime.pendingInterventions[String(tabId)].nonce;
    await sim.completeIntervention(tabId, url, nonce, now + 100);
    await sim.onNavigationCommitted(tabId, url, now + 200);

    const subpages = [
      'https://reddit.com/r/sidemen',
      'https://reddit.com/r/technology',
      'https://reddit.com/r/webdev/comments/12345/discussion',
      'https://reddit.com/user/testuser',
    ];

    for (let i = 0; i < subpages.length; i++) {
      const nav = await sim.onBeforeNavigate(tabId, subpages[i], now + 1000 + (i * 5000));
      assert.equal(nav.action, 'ALLOW', `Subpage ${subpages[i]} should be allowed`);
      assert.equal(nav.reason, 'SITE_PASS');
    }
  });

  // 5. Same-site reload is allowed during pass
  it('5. Same-site page reload is allowed during active SitePass', async () => {
    const sim = new BackgroundSimulator();
    await sim.init();
    const tabId = 1;
    const url = 'https://reddit.com/r/sidemen';
    const now = 10000;

    await sim.onBeforeNavigate(tabId, url, now);
    const state1 = await sim.storage.getState();
    const nonce = state1.runtime.pendingInterventions[String(tabId)].nonce;
    await sim.completeIntervention(tabId, url, nonce, now + 100);
    await sim.onNavigationCommitted(tabId, url, now + 200);

    // First visit allowed
    const nav1 = await sim.onBeforeNavigate(tabId, url, now + 500);
    assert.equal(nav1.action, 'ALLOW');

    // Reload allowed
    const reloadNav = await sim.onBeforeNavigate(tabId, url, now + 1500);
    assert.equal(reloadNav.action, 'ALLOW');
    assert.equal(reloadNav.reason, 'SITE_PASS');
  });

  // 6. SitePass is tab-scoped
  it('6. SitePass is strictly tab-scoped (pass in Tab 1 does not authorize Tab 2)', async () => {
    const sim = new BackgroundSimulator();
    await sim.init();
    const now = 10000;

    // Issue pass in Tab 1
    await sim.onBeforeNavigate(1, 'https://reddit.com/', now);
    const state = await sim.storage.getState();
    const nonce = state.runtime.pendingInterventions['1'].nonce;
    await sim.completeIntervention(1, 'https://reddit.com/', nonce, now + 100);

    const pass = (await sim.storage.getState()).runtime.sitePasses['1'];
    assert.equal(isSitePassValidForNavigation(pass, 1, 'https://reddit.com/r/sidemen', now + 200), true);
    assert.equal(isSitePassValidForNavigation(pass, 2, 'https://reddit.com/r/sidemen', now + 200), false);
  });

  // 7. Another tab is still blocked/intervened
  it('7. Navigating to the same site in another tab still triggers an intervention', async () => {
    const sim = new BackgroundSimulator();
    await sim.init();
    const now = 10000;

    // Tab 1 completes intervention
    await sim.onBeforeNavigate(1, 'https://reddit.com/', now);
    const state = await sim.storage.getState();
    const nonce = state.runtime.pendingInterventions['1'].nonce;
    await sim.completeIntervention(1, 'https://reddit.com/', nonce, now + 100);

    // Tab 2 navigates to the same blocked site
    const tab2Nav = await sim.onBeforeNavigate(2, 'https://reddit.com/r/sidemen', now + 200);
    assert.equal(tab2Nav.action, 'INTERVENE', 'Tab 2 must not inherit Tab 1 SitePass');
  });

  // 8. Unrelated domain is not allowed
  it('8. SitePass does not authorize unrelated domains or lookalikes', async () => {
    const sim = new BackgroundSimulator();
    await sim.init();
    const tabId = 1;
    const now = 10000;

    // Tab 1 completes intervention on reddit.com
    await sim.onBeforeNavigate(tabId, 'https://reddit.com/', now);
    const state = await sim.storage.getState();
    const nonce = state.runtime.pendingInterventions[String(tabId)].nonce;
    await sim.completeIntervention(tabId, 'https://reddit.com/', nonce, now + 100);

    // Twitter is also blocked
    const twitterNav = await sim.onBeforeNavigate(tabId, 'https://twitter.com/home', now + 200);
    assert.equal(twitterNav.action, 'INTERVENE');

    // Suffix lookalike rejected
    const pass = (await sim.storage.getState()).runtime.sitePasses[String(tabId)];
    assert.equal(isSitePassValidForNavigation(pass, tabId, 'https://reddit.com.evil.com/page', now + 200), false);
    assert.equal(isSitePassValidForNavigation(pass, tabId, 'https://evil-reddit.com/page', now + 200), false);
    assert.equal(isSitePassValidForNavigation(pass, tabId, 'https://reddit.net/page', now + 200), false);
  });

  // 9. Same-site redirects remain allowed
  it('9. Same-site redirects (apex <-> www and subdomains) remain allowed', async () => {
    const sim = new BackgroundSimulator();
    await sim.init();
    const tabId = 1;
    const now = 10000;

    await sim.onBeforeNavigate(tabId, 'https://reddit.com/', now);
    const state = await sim.storage.getState();
    const nonce = state.runtime.pendingInterventions[String(tabId)].nonce;
    await sim.completeIntervention(tabId, 'https://reddit.com/', nonce, now + 100);

    // Initial navigation commits and consumes single-use grant
    await sim.onNavigationCommitted(tabId, 'https://reddit.com/', now + 150);

    // Apex -> www redirect
    const wwwNav = await sim.onBeforeNavigate(tabId, 'https://www.reddit.com/', now + 200);
    assert.equal(wwwNav.action, 'ALLOW');
    assert.equal(wwwNav.reason, 'SITE_PASS');

    // www -> subpage
    const homeNav = await sim.onBeforeNavigate(tabId, 'https://reddit.com/home', now + 300);
    assert.equal(homeNav.action, 'ALLOW');
    assert.equal(homeNav.reason, 'SITE_PASS');

    // Subdomain
    const subNav = await sim.onBeforeNavigate(tabId, 'https://m.reddit.com/r/foo', now + 400);
    assert.equal(subNav.action, 'ALLOW');
    assert.equal(subNav.reason, 'SITE_PASS');
  });

  // 10. SitePass expiration returns to normal policy
  it('10. Expired SitePass returns to normal Core policy evaluation and triggers intervention', async () => {
    const sim = new BackgroundSimulator();
    await sim.init();
    const tabId = 1;
    const now = 10000;

    await sim.onBeforeNavigate(tabId, 'https://reddit.com/', now);
    const state = await sim.storage.getState();
    const nonce = state.runtime.pendingInterventions[String(tabId)].nonce;
    await sim.completeIntervention(tabId, 'https://reddit.com/', nonce, now + 100);
    await sim.onNavigationCommitted(tabId, 'https://reddit.com/', now + 200);

    // Expired timestamp: 5 minutes + 1 second later
    const expiredTimestamp = (now + 100) + DEFAULT_SITE_PASS_DURATION_MS + 1000;
    const expiredNav = await sim.onBeforeNavigate(tabId, 'https://reddit.com/r/sidemen', expiredTimestamp);

    assert.equal(expiredNav.action, 'INTERVENE');

    // Verify pass was pruned from storage
    const stateAfterExpiry = await sim.storage.getState();
    assert.equal(stateAfterExpiry.runtime.sitePasses[String(tabId)], undefined);
  });

  // 11. Exact expiration boundary
  it('11. Verifies exact expiration boundary: duration - 1ms is valid, duration is expired', () => {
    const tabId = 1;
    const grantedAt = 1000;
    const duration = DEFAULT_SITE_PASS_DURATION_MS; // 300,000ms
    const expiresAt = grantedAt + duration;

    const pass: SitePass = {
      id: 'pass_test',
      tabId,
      site: 'reddit.com',
      grantedAt,
      expiresAt,
    };

    const targetUrl = 'https://reddit.com/r/sidemen';

    // 1ms before expiration -> VALID
    assert.equal(isSitePassValidForNavigation(pass, tabId, targetUrl, expiresAt - 1), true);

    // Exact expiration moment -> EXPIRED (invalid)
    assert.equal(isSitePassValidForNavigation(pass, tabId, targetUrl, expiresAt), false);

    // 1ms after expiration -> EXPIRED (invalid)
    assert.equal(isSitePassValidForNavigation(pass, tabId, targetUrl, expiresAt + 1), false);

    // Duration resolver clamping and defaults
    assert.equal(resolveSitePassDuration(), DEFAULT_SITE_PASS_DURATION_MS);
    assert.equal(resolveSitePassDuration(60_000), 60_000);
    assert.equal(resolveSitePassDuration(999_999_999), MAX_SITE_PASS_DURATION_MS);
    assert.equal(resolveSitePassDuration(-100), DEFAULT_SITE_PASS_DURATION_MS);
  });

  // 12. SitePass survives worker persistence/restart
  it('12. SitePass survives simulated service worker suspension and restart', async () => {
    const sharedStorage = new ExtensionStorage();
    const sim1 = new BackgroundSimulator(sharedStorage);
    await sim1.init();
    const tabId = 1;
    const now = 10000;

    // Worker 1 creates pass
    await sim1.onBeforeNavigate(tabId, 'https://reddit.com/', now);
    const state1 = await sharedStorage.getState();
    const nonce = state1.runtime.pendingInterventions[String(tabId)].nonce;
    await sim1.completeIntervention(tabId, 'https://reddit.com/', nonce, now + 100);
    await sim1.onNavigationCommitted(tabId, 'https://reddit.com/', now + 150);

    // Simulate Worker shutdown and new Worker instantiation
    const sim2 = new BackgroundSimulator(sharedStorage);
    const navAfterRestart = await sim2.onBeforeNavigate(tabId, 'https://reddit.com/r/technology', now + 5000);
    assert.equal(navAfterRestart.action, 'ALLOW');
    assert.equal(navAfterRestart.reason, 'SITE_PASS');
  });

  // 13. Tab close cleans SitePass
  it('13. Closing the tab immediately cleans up the associated SitePass', async () => {
    const sim = new BackgroundSimulator();
    await sim.init();
    const tabId = 1;
    const now = 10000;

    await sim.onBeforeNavigate(tabId, 'https://reddit.com/', now);
    const state = await sim.storage.getState();
    const nonce = state.runtime.pendingInterventions[String(tabId)].nonce;
    await sim.completeIntervention(tabId, 'https://reddit.com/', nonce, now + 100);

    // Close tab
    await sim.onTabRemoved(tabId);

    const stateAfterClose = await sim.storage.getState();
    assert.equal(stateAfterClose.runtime.sitePasses[String(tabId)], undefined);
    assert.equal(stateAfterClose.runtime.temporaryAccessGrants[String(tabId)], undefined);
    assert.equal(stateAfterClose.runtime.pendingInterventions[String(tabId)], undefined);
  });

  // 14. SitePass does not reset daily usage
  it('14. SitePass does not reset or reduce accumulated daily usage in storage', async () => {
    const sim = new BackgroundSimulator();
    await sim.init();
    const tabId = 1;
    const now = 10000;
    const dateKey = '2026-09-09';

    // Seed existing usage
    await sim.storage.updateState((draft: MomentStorageEnvelope) => {
      draft.usage[`${dateKey}:col_social`] = {
        collectionId: 'col_social',
        dateKey,
        accumulatedMs: 15 * 60 * 1000, // 15 minutes
        updatedAt: now,
      };
    });

    await sim.onBeforeNavigate(tabId, 'https://reddit.com/', now);
    const state = await sim.storage.getState();
    const nonce = state.runtime.pendingInterventions[String(tabId)].nonce;
    await sim.completeIntervention(tabId, 'https://reddit.com/', nonce, now + 100);

    // Verify usage record remains intact
    const stateAfterPass = await sim.storage.getState();
    assert.equal(
      stateAfterPass.usage[`${dateKey}:col_social`].accumulatedMs,
      15 * 60 * 1000,
      'Accumulated usage must not be reset or reduced'
    );
  });

  // 15. Daily limit behavior remains correct
  it('15. Policy engine enforces DAILY_LIMIT_EXHAUSTED after SitePass expires or in other tabs', async () => {
    const engine = new MomentDecisionEngine();
    const limitedCollection: Collection = {
      ...socialCollection,
      dailyLimitMs: 20 * 60 * 1000, // 20m limit
    };

    const dateKey = '2026-09-09';
    const timestamp = new Date('2026-09-09T14:00:00Z').getTime();

    // Evaluation with exhausted usage and no active grant
    const decision = engine.evaluate({
      url: 'https://reddit.com/r/technology',
      tabId: 2, // Another tab without grant
      timestamp,
      activeGrants: [],
      collections: { [limitedCollection.id]: limitedCollection },
      dailyUsageMs: {
        col_social: 25 * 60 * 1000, // 25m used (exceeded)
        [`${dateKey}:col_social`]: 25 * 60 * 1000,
      },
    });

    assert.equal(decision.action, 'INTERVENE');
    assert.equal(decision.reason, 'DAILY_LIMIT_EXHAUSTED');
  });

  // 16. UI cannot create a SitePass
  it('16. UI messages cannot create a SitePass (no unauthorized message types)', () => {
    assert.equal(isValidMessage({ type: 'CREATE_SITE_PASS' }), false);
    assert.equal(isValidMessage({ type: 'CREATE_SITE_PASS', site: 'reddit.com' }), false);
    assert.equal(isValidMessage({ type: 'ADD_SITE_PASS', tabId: 1 }), false);
  });

  // 17. Underlying rule remains unchanged
  it('17. Collection rules and targets in storage remain completely unmodified by SitePass lifecycle', async () => {
    const sim = new BackgroundSimulator();
    await sim.init();
    const tabId = 1;
    const now = 10000;

    const initialTargets = JSON.stringify(socialCollection.targets);

    await sim.onBeforeNavigate(tabId, 'https://reddit.com/', now);
    const state1 = await sim.storage.getState();
    const nonce = state1.runtime.pendingInterventions[String(tabId)].nonce;
    await sim.completeIntervention(tabId, 'https://reddit.com/', nonce, now + 100);

    const state2 = await sim.storage.getState();
    assert.equal(
      JSON.stringify(state2.collections[socialCollection.id].targets),
      initialTargets,
      'Collection targets must remain strictly unchanged'
    );
  });

  // 18. TemporaryAccessGrant still has its existing single-use semantics
  it('18. TemporaryAccessGrant retains single-use semantics and is consumed upon navigation commit', async () => {
    const sim = new BackgroundSimulator();
    await sim.init();
    const tabId = 1;
    const url = 'https://reddit.com/';
    const now = 10000;

    await sim.onBeforeNavigate(tabId, url, now);
    const state = await sim.storage.getState();
    const nonce = state.runtime.pendingInterventions[String(tabId)].nonce;
    const res = await sim.completeIntervention(tabId, url, nonce, now + 100);

    assert.ok(res.data?.grant);
    assert.equal(res.data.grant.singleUse, true);

    // Initial navigation authorized by TemporaryAccessGrant before commit
    const stateBeforeCommit = await sim.storage.getState();
    assert.ok(stateBeforeCommit.runtime.temporaryAccessGrants[String(tabId)]);

    // Navigation commits -> consumes single-use TemporaryAccessGrant
    await sim.onNavigationCommitted(tabId, url, now + 200);

    const stateAfterCommit = await sim.storage.getState();
    assert.equal(stateAfterCommit.runtime.temporaryAccessGrants[String(tabId)], undefined);
  });

  // 19. Existing intervention completion flow still works
  it('19. Existing intervention completion flow with nonce validation succeeds and creates both grant and pass', async () => {
    const sim = new BackgroundSimulator();
    await sim.init();
    const tabId = 1;
    const url = 'https://example.com/';
    const now = 10000;

    // Trigger intervention
    const nav = await sim.onBeforeNavigate(tabId, url, now);
    assert.equal(nav.action, 'INTERVENE');

    const state = await sim.storage.getState();
    const pending = state.runtime.pendingInterventions[String(tabId)];
    assert.ok(pending);
    assert.equal(pending.status, 'PENDING');

    // Complete intervention
    const completeRes = await sim.completeIntervention(tabId, url, pending.nonce, now + 100);
    assert.equal(completeRes.success, true);
    assert.ok(completeRes.data?.grant);
    assert.ok(completeRes.data?.sitePass);

    // Verify pending intervention was consumed atomically
    const stateAfter = await sim.storage.getState();
    assert.equal(stateAfter.runtime.pendingInterventions[String(tabId)], undefined);
  });

  // 20. Existing cancellation flow still works
  it('20. Existing cancellation flow properly clears pending intervention, grants, and passes', async () => {
    const sim = new BackgroundSimulator();
    await sim.init();
    const tabId = 1;
    const url = 'https://reddit.com/';
    const now = 10000;

    await sim.onBeforeNavigate(tabId, url, now);
    const state = await sim.storage.getState();
    const nonce = state.runtime.pendingInterventions[String(tabId)].nonce;

    const cancelRes = await sim.cancelIntervention(tabId, nonce);
    assert.equal(cancelRes.success, true);

    const stateAfter = await sim.storage.getState();
    assert.equal(stateAfter.runtime.pendingInterventions[String(tabId)], undefined);
    assert.equal(stateAfter.runtime.temporaryAccessGrants[String(tabId)], undefined);
    assert.equal(stateAfter.runtime.sitePasses[String(tabId)], undefined);
  });
});
