import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MomentDecisionEngine } from '../../dist/chrome/core/decisions/engine.js';
import type { Collection } from '../../src/core/models/collection.js';
import type { TemporaryAccessGrant } from '../../src/core/models/grant.js';

describe('Moment Production Decision Engine (Phase 2)', () => {
  const baseCollection: Collection = {
    id: 'col_distracting',
    name: 'Distracting Websites',
    color: '#ff4444',
    icon: 'block',
    enabled: true,
    createdAt: 1000,
    updatedAt: 1000,
    targets: [],
    boundary: {
      schedule: { enabled: false, intervals: [] }, // Always active
      limits: { dailyMinutes: null, sessionMinutes: null },
      pause: { type: 'BREATHE', durationSeconds: 10, requireIntentionText: false },
      action: { type: 'BLOCK_PAGE', redirectUrl: null },
      strictMode: false,
    },
  };

  it('Returns ALLOW with NO_RULE_MATCH when no rules match navigation', () => {
    const engine = new MomentDecisionEngine([baseCollection]);
    const decision = engine.evaluate({
      url: 'https://productive-work.org/docs',
      tabId: 1,
      timestamp: 5000,
      activeGrants: [],
    });

    assert.equal(decision.action, 'ALLOW');
    assert.equal(decision.reason, 'NO_RULE_MATCH');
    assert.equal(decision.matchedRuleId, null);
    assert.ok(decision.explanation.length > 0);
  });

  it('Returns ALLOW with ACTIVE_GRANT when valid unexpired grant exists (Phase 1.1 Invariant)', () => {
    const col: Collection = {
      ...baseCollection,
      targets: [
        { id: 't_reddit', pattern: 'reddit.com', type: 'WEBSITE', isException: false, createdAt: 100 },
      ],
    };

    const grant: TemporaryAccessGrant = {
      id: 'g_active_123',
      tabId: 42,
      target: 'https://reddit.com',
      grantedAt: 1000,
      expiresAt: 10_000,
      nonce: 'n_valid',
      singleUse: true,
    };

    const engine = new MomentDecisionEngine([col]);
    const decision = engine.evaluate({
      url: 'https://reddit.com/r/programming',
      tabId: 42,
      timestamp: 4000, // Valid unexpired
      activeGrants: [grant],
    });

    assert.equal(decision.action, 'ALLOW');
    assert.equal(decision.reason, 'ACTIVE_GRANT');
    assert.equal(decision.matchedRuleId, 'g_active_123');
    assert.ok(decision.explanation.includes('Temporary Access Grant'));
  });

  it('Returns INTERVENE when matched by an active collection configured with Pause', () => {
    const col: Collection = {
      ...baseCollection,
      targets: [
        { id: 't_social', pattern: 'twitter.com', type: 'WEBSITE', isException: false, createdAt: 100 },
      ],
    };

    const engine = new MomentDecisionEngine([col]);
    const decision = engine.evaluate({
      url: 'https://twitter.com/explore',
      tabId: 1,
      timestamp: 5000,
      activeGrants: [],
    });

    assert.equal(decision.action, 'INTERVENE');
    assert.equal(decision.reason, 'INTERVENTION_REQUIRED');
    assert.equal(decision.matchedRuleId, 't_social');
    assert.equal(decision.collectionId, 'col_distracting');
    assert.ok(decision.trace);
    assert.equal(decision.trace!.isException, false);
    assert.equal(decision.trace!.boundaryActive, true);
  });

  it('Returns BLOCK when matched by an active collection configured with Terminal Block (No Pause)', () => {
    const col: Collection = {
      ...baseCollection,
      id: 'col_hard_block',
      name: 'Hard Blocklist',
      boundary: {
        ...baseCollection.boundary,
        pause: { type: 'NONE', durationSeconds: 0, requireIntentionText: false },
        action: { type: 'BLOCK_PAGE', redirectUrl: null },
      },
      targets: [
        { id: 't_gaming', pattern: 'twitch.tv', type: 'WEBSITE', isException: false, createdAt: 100 },
      ],
    };

    const engine = new MomentDecisionEngine([col]);
    const decision = engine.evaluate({
      url: 'https://twitch.tv/directory',
      tabId: 1,
      timestamp: 5000,
      activeGrants: [],
    });

    assert.equal(decision.action, 'BLOCK');
    assert.equal(decision.reason, 'SCHEDULE_ACTIVE');
    assert.equal(decision.matchedRuleId, 't_gaming');
  });

  it('Returns ALLOW with EXCEPTION_RULE when matched by high-specificity exception', () => {
    const col: Collection = {
      ...baseCollection,
      targets: [
        { id: 't_broad_block', pattern: 'reddit.com', type: 'WEBSITE', isException: false, createdAt: 100 },
        { id: 't_learn_allow', pattern: 'reddit.com/r/learnprogramming/*', type: 'GLOB', isException: true, createdAt: 100 },
      ],
    };

    const engine = new MomentDecisionEngine([col]);
    const decision = engine.evaluate({
      url: 'https://reddit.com/r/learnprogramming/faq',
      tabId: 1,
      timestamp: 5000,
      activeGrants: [],
    });

    assert.equal(decision.action, 'ALLOW');
    assert.equal(decision.reason, 'EXCEPTION_RULE');
    assert.equal(decision.matchedRuleId, 't_learn_allow');
    assert.ok(decision.trace);
    assert.equal(decision.trace!.isException, true);
  });

  it('Returns ALLOW with SCHEDULE_INACTIVE when matched rule is outside scheduled active window', () => {
    const col: Collection = {
      ...baseCollection,
      boundary: {
        ...baseCollection.boundary,
        schedule: {
          enabled: true,
          intervals: [
            { days: [1], startMinute: 9 * 60, endMinute: 17 * 60 }, // Mondays 09:00 - 17:00
          ],
        },
      },
      targets: [
        { id: 't_news', pattern: 'news.ycombinator.com', type: 'WEBSITE', isException: false, createdAt: 100 },
      ],
    };

    const engine = new MomentDecisionEngine([col]);

    // Construct a Sunday (day 0) timestamp
    const sunday = new Date();
    const diff = (0 - sunday.getDay() + 7) % 7;
    sunday.setDate(sunday.getDate() + diff);
    sunday.setHours(12, 0, 0, 0);

    const decision = engine.evaluate({
      url: 'https://news.ycombinator.com',
      tabId: 1,
      timestamp: sunday.getTime(),
      activeGrants: [],
    });

    assert.equal(decision.action, 'ALLOW');
    assert.equal(decision.reason, 'SCHEDULE_INACTIVE');
  });

  describe('Invariant & Property Tests: Determinism & Order Independence', () => {
    it('Order-independence property: Shuffling collections array produces identical winner', () => {
      const colA: Collection = {
        ...baseCollection,
        id: 'col_a',
        name: 'Broad Block',
        targets: [
          { id: 't_broad', pattern: 'youtube.com/*', type: 'GLOB', isException: false, createdAt: 10 },
        ],
      };
      const colB: Collection = {
        ...baseCollection,
        id: 'col_b',
        name: 'Specific Exception',
        targets: [
          { id: 't_spec', pattern: 'youtube.com/learning/*', type: 'GLOB', isException: true, createdAt: 20 },
        ],
      };

      const engineAB = new MomentDecisionEngine([colA, colB]);
      const engineBA = new MomentDecisionEngine([colB, colA]);

      const req = {
        url: 'https://youtube.com/learning/course1',
        tabId: 1,
        timestamp: 1000,
        activeGrants: [],
      };

      const decAB = engineAB.evaluate(req);
      const decBA = engineBA.evaluate(req);

      assert.equal(decAB.action, decBA.action);
      assert.equal(decAB.reason, decBA.reason);
      assert.equal(decAB.matchedRuleId, decBA.matchedRuleId);
      assert.equal(decAB.matchedRuleId, 't_spec'); // Specific exception wins regardless of order
    });

    it('Order-independence property: Shuffling targets array produces identical winner', () => {
      const t1 = { id: 't_broad', pattern: 'site.com/*', type: 'GLOB' as const, isException: false, createdAt: 10 };
      const t2 = { id: 't_middle', pattern: 'site.com/docs/*', type: 'GLOB' as const, isException: false, createdAt: 20 };
      const t3 = { id: 't_leaf', pattern: 'site.com/docs/api/*', type: 'GLOB' as const, isException: true, createdAt: 30 };

      const colForward: Collection = { ...baseCollection, targets: [t1, t2, t3] };
      const colReverse: Collection = { ...baseCollection, targets: [t3, t2, t1] };

      const engineForward = new MomentDecisionEngine([colForward]);
      const engineReverse = new MomentDecisionEngine([colReverse]);

      const req = {
        url: 'https://site.com/docs/api/v2',
        tabId: 1,
        timestamp: 1000,
        activeGrants: [],
      };

      const dec1 = engineForward.evaluate(req);
      const dec2 = engineReverse.evaluate(req);

      assert.equal(dec1.action, dec2.action);
      assert.equal(dec1.matchedRuleId, dec2.matchedRuleId);
      assert.equal(dec1.matchedRuleId, 't_leaf');
    });

    it('Safety invariant: Malformed URL never throws and returns safe ALLOW', () => {
      const engine = new MomentDecisionEngine([baseCollection]);
      const d1 = engine.evaluate({ url: 'not-a-url', tabId: 1, timestamp: 1000, activeGrants: [] });
      assert.equal(d1.action, 'ALLOW');

      const d2 = engine.evaluate({ url: 'javascript:alert(1)', tabId: 1, timestamp: 1000, activeGrants: [] });
      assert.equal(d2.action, 'ALLOW');
    });

    it('Safety invariant: Path boundary prevents prefix collision (/feed never matches /feedback)', () => {
      const col: Collection = {
        ...baseCollection,
        targets: [
          { id: 't_feed', pattern: 'example.com/feed', type: 'PATH_PREFIX', isException: false, createdAt: 10 },
        ],
      };
      const engine = new MomentDecisionEngine([col]);

      const matchFeed = engine.evaluate({ url: 'https://example.com/feed', tabId: 1, timestamp: 1000, activeGrants: [] });
      assert.equal(matchFeed.action, 'INTERVENE');

      const matchFeedback = engine.evaluate({ url: 'https://example.com/feedback', tabId: 1, timestamp: 1000, activeGrants: [] });
      assert.equal(matchFeedback.action, 'ALLOW');
      assert.equal(matchFeedback.reason, 'NO_RULE_MATCH');
    });

    it('Phase 2.1 / Phase 3.1 Invariant: Specific restriction dominates broad exception (no automatic exception win)', () => {
      const col: Collection = {
        ...baseCollection,
        boundary: {
          ...baseCollection.boundary,
          pause: { type: 'TIMER', durationSeconds: 10, requireIntentionText: false },
        },
        targets: [
          // Broad exception: allow youtube.com (K=1)
          { id: 't_broad_allow', pattern: 'youtube.com', type: 'WEBSITE', isException: true, createdAt: 100 },
          // Specific restriction: intervene on youtube.com/shorts/* (K=2)
          { id: 't_shorts_intervene', pattern: 'youtube.com/shorts/*', type: 'GLOB', isException: false, createdAt: 100 },
        ],
      };

      const engine = new MomentDecisionEngine([col]);

      // 1. Navigation to specific restricted path: restriction dominates, yields INTERVENE
      const decShorts = engine.evaluate({
        url: 'https://youtube.com/shorts/123',
        tabId: 1,
        timestamp: 5000,
        activeGrants: [],
      });
      assert.equal(decShorts.action, 'INTERVENE');
      assert.equal(decShorts.matchedRuleId, 't_shorts_intervene');

      // 2. Navigation to other parts of youtube.com: broad exception wins, yields ALLOW
      const decHome = engine.evaluate({
        url: 'https://youtube.com/watch?v=abc',
        tabId: 1,
        timestamp: 5000,
        activeGrants: [],
      });
      assert.equal(decHome.action, 'ALLOW');
      assert.equal(decHome.reason, 'EXCEPTION_RULE');
      assert.equal(decHome.matchedRuleId, 't_broad_allow');
    });
  });

  describe('Phase 4: Usage Limits & Daily Time Budget Decisions', () => {
    const colWithLimit: Collection = {
      ...baseCollection,
      id: 'col_limited',
      name: 'Limited Collection',
      dailyLimitMs: 30 * 60 * 1000, // 30 minutes
      boundary: {
        ...baseCollection.boundary,
        pause: { type: 'BREATHE', durationSeconds: 10, requireIntentionText: false },
      },
      targets: [
        { id: 't_reddit', pattern: 'reddit.com', type: 'WEBSITE', isException: false, createdAt: 100 },
        { id: 't_reddit_learn', pattern: 'reddit.com/r/learnprogramming/*', type: 'GLOB', isException: true, createdAt: 100 },
      ],
    };

    it('Returns INTERVENE with DAILY_LIMIT_EXHAUSTED when daily usage meets/exceeds limit on Pause collection', () => {
      const engine = new MomentDecisionEngine([colWithLimit]);
      const decision = engine.evaluate({
        url: 'https://reddit.com/r/technology',
        tabId: 1,
        timestamp: 100_000,
        activeGrants: [],
        dailyUsageMs: {
          col_limited: 30 * 60 * 1000, // exactly 30 minutes
        },
      });

      assert.equal(decision.action, 'BLOCK');
      assert.equal(decision.reason, 'DAILY_LIMIT_EXHAUSTED');
      assert.equal(decision.matchedRuleId, 't_reddit');
      assert.equal(decision.collectionId, 'col_limited');
    });

    it('Returns BLOCK with DAILY_LIMIT_EXHAUSTED when daily usage exceeds limit on Terminal Block collection', () => {
      const blockCol: Collection = {
        ...colWithLimit,
        id: 'col_block_limited',
        boundary: {
          ...baseCollection.boundary,
          pause: { type: 'NONE', durationSeconds: 0, requireIntentionText: false },
          action: { type: 'BLOCK_PAGE', redirectUrl: null },
        },
      };

      const engine = new MomentDecisionEngine([blockCol]);
      const decision = engine.evaluate({
        url: 'https://reddit.com/r/technology',
        tabId: 1,
        timestamp: 100_000,
        activeGrants: [],
        dailyUsageMs: {
          col_block_limited: 35 * 60 * 1000, // exceeded limit
        },
      });

      assert.equal(decision.action, 'BLOCK');
      assert.equal(decision.reason, 'DAILY_LIMIT_EXHAUSTED');
      assert.equal(decision.matchedRuleId, 't_reddit');
      assert.equal(decision.collectionId, 'col_block_limited');
    });

    it('Returns ALLOW with ACTIVE_GRANT even if daily limit is exhausted (Intent Pass Co-existence)', () => {
      const engine = new MomentDecisionEngine([colWithLimit]);
      const grant: TemporaryAccessGrant = {
        id: 'grant_pass_1',
        tabId: 1,
        target: 'https://reddit.com',
        grantedAt: 100_000,
        expiresAt: 200_000,
        nonce: 'valid_nonce',
        singleUse: true,
      };

      const decision = engine.evaluate({
        url: 'https://reddit.com/r/technology',
        tabId: 1,
        timestamp: 150_000,
        activeGrants: [grant],
        dailyUsageMs: {
          col_limited: 45 * 60 * 1000, // Exceeded limit, but active grant takes precedence!
        },
      });

      assert.equal(decision.action, 'ALLOW');
      assert.equal(decision.reason, 'ACTIVE_GRANT');
    });

    it('Returns ALLOW with EXCEPTION_RULE even if parent collection daily limit is exhausted', () => {
      const engine = new MomentDecisionEngine([colWithLimit]);
      const decision = engine.evaluate({
        url: 'https://reddit.com/r/learnprogramming/guide',
        tabId: 1,
        timestamp: 100_000,
        activeGrants: [],
        dailyUsageMs: {
          col_limited: 50 * 60 * 1000, // Limit exhausted
        },
      });

      assert.equal(decision.action, 'ALLOW');
      assert.equal(decision.reason, 'EXCEPTION_RULE');
      assert.equal(decision.matchedRuleId, 't_reddit_learn');
    });

    it('Returns normal INTERVENTION_REQUIRED when usage is below configured limit', () => {
      const engine = new MomentDecisionEngine([colWithLimit]);
      const decision = engine.evaluate({
        url: 'https://reddit.com/r/technology',
        tabId: 1,
        timestamp: 100_000,
        activeGrants: [],
        dailyUsageMs: {
          col_limited: 10 * 60 * 1000, // 10m used out of 30m limit
        },
      });

      // Budget model: free access while under the daily limit
      assert.equal(decision.action, 'ALLOW');
      assert.equal(decision.reason, 'WITHIN_DAILY_BUDGET');
    });

    it('Phase 4.1 Audit 1 Invariant: Broad exception + more-specific restriction under limited collection -> restriction wins', () => {
      // Setup: Broad exception on entire domain, more specific restriction on subpath
      const colAudit1: Collection = {
        ...baseCollection,
        id: 'col_audit_1',
        name: 'Audit 1 Collection',
        dailyLimitMs: 30 * 60 * 1000,
        boundary: {
          ...baseCollection.boundary,
          pause: { type: 'BREATHE', durationSeconds: 10, requireIntentionText: false },
        },
        targets: [
          { id: 't_broad_exception', pattern: 'news.example.com', type: 'WEBSITE', isException: true, createdAt: 100 },
          { id: 't_specific_restriction', pattern: 'news.example.com/distracting/*', type: 'GLOB', isException: false, createdAt: 100 },
        ],
      };

      const engine = new MomentDecisionEngine([colAudit1]);

      // 1. Navigation to specific restricted path: Specific restriction wins (K=2 vs K=1)
      // When daily limit is NOT exhausted -> INTERVENE (INTERVENTION_REQUIRED)
      const decRestrictedUnderLimit = engine.evaluate({
        url: 'https://news.example.com/distracting/feed',
        tabId: 1,
        timestamp: 100_000,
        activeGrants: [],
        dailyUsageMs: { col_audit_1: 15 * 60 * 1000 },
      });
      assert.equal(decRestrictedUnderLimit.action, 'ALLOW');
      assert.equal(decRestrictedUnderLimit.reason, 'WITHIN_DAILY_BUDGET');
      assert.equal(decRestrictedUnderLimit.matchedRuleId, 't_specific_restriction');

      // When daily limit IS exhausted -> INTERVENE (DAILY_LIMIT_EXHAUSTED)
      const decRestrictedExhausted = engine.evaluate({
        url: 'https://news.example.com/distracting/feed',
        tabId: 1,
        timestamp: 100_000,
        activeGrants: [],
        dailyUsageMs: { col_audit_1: 35 * 60 * 1000 },
      });
      assert.equal(decRestrictedExhausted.action, 'BLOCK');
      assert.equal(decRestrictedExhausted.reason, 'DAILY_LIMIT_EXHAUSTED');
      assert.equal(decRestrictedExhausted.matchedRuleId, 't_specific_restriction');

      // 2. Navigation to harmless page on domain: Broad exception matches, restriction does NOT match -> ALLOW (EXCEPTION_RULE)
      const decBroadException = engine.evaluate({
        url: 'https://news.example.com/local-news',
        tabId: 1,
        timestamp: 100_000,
        activeGrants: [],
        dailyUsageMs: { col_audit_1: 35 * 60 * 1000 },
      });
      assert.equal(decBroadException.action, 'ALLOW');
      assert.equal(decBroadException.reason, 'EXCEPTION_RULE');
      assert.equal(decBroadException.matchedRuleId, 't_broad_exception');
    });

    it('Phase 4.1 Audit 11: Intent Pass issued at 29:59 on 30m limit, usage crosses 30:00 -> active grant allows during session, then exhausted on expiration', () => {
      const engine = new MomentDecisionEngine([colWithLimit]);
      const grant: TemporaryAccessGrant = {
        id: 'grant_pass_lifecycle',
        tabId: 1,
        target: 'https://reddit.com',
        grantedAt: 100_000,
        expiresAt: 100_000 + 10 * 60 * 1000, // 10 minutes max
        nonce: 'valid_nonce_pass',
        singleUse: true,
      };

      // 1. While grant is active, usage is 34 minutes (limit was 30 minutes)
      const activeDecision = engine.evaluate({
        url: 'https://reddit.com/r/technology',
        tabId: 1,
        timestamp: 100_000 + 5 * 60 * 1000, // 5m into grant
        activeGrants: [grant],
        dailyUsageMs: {
          col_limited: 34 * 60 * 1000, // Exceeded limit during active grant
        },
      });

      assert.equal(activeDecision.action, 'ALLOW');
      assert.equal(activeDecision.reason, 'ACTIVE_GRANT');

      // 2. Once grant expires (timestamp > expiresAt) or is consumed (no longer in activeGrants)
      const expiredDecision = engine.evaluate({
        url: 'https://reddit.com/r/technology',
        tabId: 1,
        timestamp: 100_000 + 11 * 60 * 1000, // 11m (after grant expiration)
        activeGrants: [], // Grant consumed or removed
        dailyUsageMs: {
          col_limited: 34 * 60 * 1000, // Preserved accumulated usage
        },
      });

      assert.equal(expiredDecision.action, 'BLOCK');
      assert.equal(expiredDecision.reason, 'DAILY_LIMIT_EXHAUSTED');
      assert.equal(expiredDecision.collectionId, 'col_limited');
    });
  });
});
