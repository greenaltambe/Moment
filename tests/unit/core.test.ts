import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PlaceholderDecisionEngine } from '../../dist/chrome/core/decisions/engine.js';
import type { TemporaryAccessGrant } from '../../src/core/models/grant.js';

describe('Moment Core Domain & Decision Engine', () => {
  it('Placeholder engine returns ALLOW by default when no rules match', () => {
    const engine = new PlaceholderDecisionEngine();
    const decision = engine.evaluate({
      url: 'https://example.com/blog',
      tabId: 1,
      timestamp: 1000,
      activeGrants: [],
    });

    assert.equal(decision.action, 'ALLOW');
    assert.equal(decision.reason, 'NO_RULE_MATCH');
    assert.ok(decision.explanation.length > 0);
  });

  it('Placeholder engine returns ALLOW with ACTIVE_GRANT when valid unexpired grant exists', () => {
    const engine = new PlaceholderDecisionEngine();
    const grant: TemporaryAccessGrant = {
      id: 'g1',
      tabId: 42,
      target: 'example.com',
      grantedAt: 1000,
      expiresAt: 5000,
      nonce: 'n123',
      singleUse: true,
    };

    const decision = engine.evaluate({
      url: 'https://example.com/news',
      tabId: 42,
      timestamp: 2000, // Valid (before expiresAt)
      activeGrants: [grant],
    });

    assert.equal(decision.action, 'ALLOW');
    assert.equal(decision.reason, 'ACTIVE_GRANT');
    assert.ok(decision.explanation.includes('Temporary Access Grant'));
  });

  it('Expired grant is not accepted by decision engine', () => {
    const engine = new PlaceholderDecisionEngine();
    const expiredGrant: TemporaryAccessGrant = {
      id: 'g2',
      tabId: 42,
      target: 'example.com',
      grantedAt: 1000,
      expiresAt: 1500,
      nonce: 'n123',
      singleUse: true,
    };

    const decision = engine.evaluate({
      url: 'https://example.com/news',
      tabId: 42,
      timestamp: 2000, // Expired
      activeGrants: [expiredGrant],
    });

    assert.equal(decision.action, 'ALLOW');
    assert.equal(decision.reason, 'NO_RULE_MATCH'); // Not authorized via grant
  });
});
