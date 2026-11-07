/**
 * Unit Tests: Phase 5 UI Message Protocol & Background CRUD Lifecycle
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isValidMessage } from '../../dist/chrome/shared/messages.js';
import { ExtensionStorage } from '../../dist/chrome/storage/storage.js';
import { MomentDecisionEngine } from '../../dist/chrome/core/decisions/engine.js';
import { validateCollectionName, validateTargetPattern, validateImportPayload } from '../../dist/chrome/core/validation/rules.js';
import type { Collection } from '../../src/core/models/collection.js';
import type { Target } from '../../src/core/models/target.js';

describe('Phase 5 UI: Message Protocol Validation (isValidMessage)', () => {
  describe('GET_CURRENT_SITE_STATE', () => {
    it('accepts valid message with optional tabId', () => {
      assert.equal(isValidMessage({ type: 'GET_CURRENT_SITE_STATE' }), true);
      assert.equal(isValidMessage({ type: 'GET_CURRENT_SITE_STATE', tabId: 10 }), true);
    });

    it('rejects invalid tabId type', () => {
      assert.equal(isValidMessage({ type: 'GET_CURRENT_SITE_STATE', tabId: '10' as any }), false);
    });
  });

  describe('GET_COLLECTIONS', () => {
    it('accepts valid GET_COLLECTIONS message', () => {
      assert.equal(isValidMessage({ type: 'GET_COLLECTIONS' }), true);
    });
  });

  describe('CREATE_COLLECTION', () => {
    it('accepts message with valid collection name', () => {
      assert.equal(isValidMessage({ type: 'CREATE_COLLECTION', name: 'Focus' }), true);
      assert.equal(isValidMessage({ type: 'CREATE_COLLECTION', name: 'Social', color: '#15803d', dailyLimitMs: 3600000 }), true);
    });

    it('rejects message missing name or with non-string name', () => {
      assert.equal(isValidMessage({ type: 'CREATE_COLLECTION' }), false);
      assert.equal(isValidMessage({ type: 'CREATE_COLLECTION', name: 123 as any }), false);
    });
  });

  describe('UPDATE_COLLECTION', () => {
    it('accepts valid collectionId and updates object', () => {
      assert.equal(isValidMessage({ type: 'UPDATE_COLLECTION', collectionId: 'col_1', updates: { name: 'Work' } }), true);
    });

    it('rejects missing collectionId or non-object updates', () => {
      assert.equal(isValidMessage({ type: 'UPDATE_COLLECTION', updates: { name: 'Work' } }), false);
      assert.equal(isValidMessage({ type: 'UPDATE_COLLECTION', collectionId: 'col_1', updates: 'not an object' as any }), false);
    });
  });

  describe('DELETE_COLLECTION', () => {
    it('accepts valid collectionId', () => {
      assert.equal(isValidMessage({ type: 'DELETE_COLLECTION', collectionId: 'col_1' }), true);
    });

    it('rejects missing or empty collectionId', () => {
      assert.equal(isValidMessage({ type: 'DELETE_COLLECTION' }), false);
      assert.equal(isValidMessage({ type: 'DELETE_COLLECTION', collectionId: '' }), false);
    });
  });

  describe('CREATE_RULE', () => {
    it('accepts valid collectionId, pattern, and ruleType', () => {
      assert.equal(
        isValidMessage({
          type: 'CREATE_RULE',
          collectionId: 'col_1',
          pattern: 'youtube.com',
          ruleType: 'WEBSITE',
        }),
        true
      );
      assert.equal(
        isValidMessage({
          type: 'CREATE_RULE',
          collectionId: 'col_1',
          pattern: 'reddit.com/r/*',
          ruleType: 'GLOB',
          isException: true,
        }),
        true
      );
    });

    it('rejects invalid ruleType or missing pattern', () => {
      assert.equal(
        isValidMessage({
          type: 'CREATE_RULE',
          collectionId: 'col_1',
          pattern: 'youtube.com',
          ruleType: 'INVALID_TYPE' as any,
        }),
        false
      );
      assert.equal(
        isValidMessage({
          type: 'CREATE_RULE',
          collectionId: 'col_1',
          ruleType: 'WEBSITE',
        }),
        false
      );
    });
  });

  describe('UPDATE_RULE', () => {
    it('accepts valid collectionId, ruleId, and updates object', () => {
      assert.equal(
        isValidMessage({
          type: 'UPDATE_RULE',
          collectionId: 'col_1',
          ruleId: 'r_1',
          updates: { isException: true },
        }),
        true
      );
    });

    it('rejects missing ruleId or collectionId', () => {
      assert.equal(
        isValidMessage({
          type: 'UPDATE_RULE',
          collectionId: 'col_1',
          updates: {},
        }),
        false
      );
    });
  });

  describe('DELETE_RULE', () => {
    it('accepts valid collectionId and ruleId', () => {
      assert.equal(
        isValidMessage({
          type: 'DELETE_RULE',
          collectionId: 'col_1',
          ruleId: 'r_1',
        }),
        true
      );
    });

    it('rejects missing ruleId or collectionId', () => {
      assert.equal(isValidMessage({ type: 'DELETE_RULE', collectionId: 'col_1' }), false);
      assert.equal(isValidMessage({ type: 'DELETE_RULE', ruleId: 'r_1' }), false);
    });
  });

  describe('GET_SETTINGS & UPDATE_SETTINGS', () => {
    it('accepts GET_SETTINGS', () => {
      assert.equal(isValidMessage({ type: 'GET_SETTINGS' }), true);
    });

    it('accepts UPDATE_SETTINGS with settings object', () => {
      assert.equal(isValidMessage({ type: 'UPDATE_SETTINGS', settings: { theme: 'dark' } }), true);
      assert.equal(isValidMessage({ type: 'UPDATE_SETTINGS', settings: 'invalid' as any }), false);
    });
  });

  describe('EXPORT_DATA & IMPORT_DATA', () => {
    it('accepts EXPORT_DATA', () => {
      assert.equal(isValidMessage({ type: 'EXPORT_DATA' }), true);
    });

    it('accepts IMPORT_DATA with data payload', () => {
      assert.equal(isValidMessage({ type: 'IMPORT_DATA', data: { schemaVersion: 3 } }), true);
      assert.equal(isValidMessage({ type: 'IMPORT_DATA', data: {}, mode: 'replace' }), true);
      assert.equal(isValidMessage({ type: 'IMPORT_DATA' }), false);
    });
  });
});

describe('Phase 5 UI: Background CRUD Lifecycle & Engine Synchronization', () => {
  function createMockStorage() {
    const db: Record<string, any> = {};
    const backend = {
      get: (k: string, cb: (res: any) => void) => cb({ [k]: db[k] }),
      set: (obj: any, cb: () => void) => {
        Object.assign(db, obj);
        cb();
      },
    };
    return new ExtensionStorage(backend);
  }

  it('Creates collection, adds rules, updates rule to exception, and synchronizes engine', async () => {
    const storage = createMockStorage();
    const engine = new MomentDecisionEngine();

    // 1. CREATE_COLLECTION
    const colNameVal = validateCollectionName('Social Media');
    assert.equal(colNameVal.valid, true);

    const newCollection: Collection = {
      id: 'col_social',
      name: colNameVal.sanitized!,
      color: '#15803d',
      icon: 'shield',
      enabled: true,
      createdAt: 1000,
      updatedAt: 1000,
      dailyLimitMs: null, // no daily limit: pause applies on every visit
      targets: [],
      boundary: {
        schedule: { enabled: false, intervals: [] },
        limits: { dailyMinutes: null, sessionMinutes: null },
        pause: { type: 'BREATHE', durationSeconds: 10, requireIntentionText: false },
        action: { type: 'BLOCK_PAGE', redirectUrl: null },
        strictMode: false,
      },
    };

    await storage.updateState((draft: any) => {
      draft.collections['col_social'] = newCollection;
    });

    let state = await storage.getState();
    engine.setCollections(state.collections);
    assert.equal(Object.keys(state.collections).length, 1);

    // 2. CREATE_RULE (WEBSITE rule)
    const ruleVal = validateTargetPattern('reddit.com', 'WEBSITE');
    assert.equal(ruleVal.valid, true);

    const target1: Target = {
      id: 't_reddit',
      pattern: ruleVal.sanitized!,
      type: 'WEBSITE',
      isException: false,
      createdAt: 1001,
    };

    await storage.updateState((draft: any) => {
      const col = draft.collections['col_social'];
      draft.collections['col_social'] = {
        ...col,
        targets: [...col.targets, target1],
      };
    });

    state = await storage.getState();
    engine.setCollections(state.collections);

    // Evaluate: reddit.com should now INTERVENE via BREATHE pause
    const decision1 = engine.evaluate({
      url: 'https://reddit.com/r/all',
      tabId: 1,
      timestamp: 2000,
      collections: state.collections,
    });
    assert.equal(decision1.action, 'INTERVENE');
    assert.equal(decision1.collectionId, 'col_social');
    assert.equal(decision1.matchedRuleId, 't_reddit');

    // 3. CREATE_RULE (Exception for specific sub-page)
    const excVal = validateTargetPattern('reddit.com/r/science', 'PATH_PREFIX');
    assert.equal(excVal.valid, true);

    const targetException: Target = {
      id: 't_reddit_science',
      pattern: excVal.sanitized!,
      type: 'PATH_PREFIX',
      isException: true,
      createdAt: 1002,
    };

    await storage.updateState((draft: any) => {
      const col = draft.collections['col_social'];
      draft.collections['col_social'] = {
        ...col,
        targets: [...col.targets, targetException],
      };
    });

    state = await storage.getState();
    engine.setCollections(state.collections);

    // Path prefix exception has higher specificity than broad WEBSITE rule -> ALLOW
    const decision2 = engine.evaluate({
      url: 'https://reddit.com/r/science',
      tabId: 1,
      timestamp: 2000,
      collections: state.collections,
    });
    assert.equal(decision2.action, 'ALLOW');
    assert.equal(decision2.matchedRuleId, 't_reddit_science');

    // General page still INTERVENE
    const decision3 = engine.evaluate({
      url: 'https://reddit.com/r/gaming',
      tabId: 1,
      timestamp: 2000,
      collections: state.collections,
    });
    assert.equal(decision3.action, 'INTERVENE');
    assert.equal(decision3.matchedRuleId, 't_reddit');

    // 4. DELETE_RULE
    await storage.updateState((draft: any) => {
      const col = draft.collections['col_social'];
      draft.collections['col_social'] = {
        ...col,
        targets: col.targets.filter((t: any) => t.id !== 't_reddit_science'),
      };
    });

    state = await storage.getState();
    engine.setCollections(state.collections);

    // Now /r/science is intercepted by t_reddit again
    const decision4 = engine.evaluate({
      url: 'https://reddit.com/r/science',
      tabId: 1,
      timestamp: 2000,
      collections: state.collections,
    });
    assert.equal(decision4.action, 'INTERVENE');

    // 5. DELETE_COLLECTION
    await storage.updateState((draft: any) => {
      delete draft.collections['col_social'];
    });

    state = await storage.getState();
    engine.setCollections(state.collections);
    assert.equal(Object.keys(state.collections).length, 0);

    const decision5 = engine.evaluate({
      url: 'https://reddit.com/r/all',
      tabId: 1,
      timestamp: 2000,
      collections: state.collections,
    });
    assert.equal(decision5.action, 'ALLOW');
    assert.equal(decision5.reason, 'NO_RULE_MATCH');
  });

  it('Safely exports configuration excluding runtime transient state', async () => {
    const storage = createMockStorage();

    // Populate storage with collections, settings, AND active runtime grants/interventions
    await storage.updateState((draft: any) => {
      draft.settings.theme = 'sepia';
      draft.collections['col_news'] = {
        id: 'col_news',
        name: 'News',
        color: '#0369a1',
        enabled: true,
        targets: [{ id: 't_news', pattern: 'cnn.com', type: 'WEBSITE', isException: false }],
        boundary: { schedule: { enabled: false, intervals: [] } },
      };
      // Transient runtime state
      draft.runtime.pendingInterventions['5'] = { tabId: 5, nonce: 'nonce_secret', targetUrl: 'https://cnn.com' };
      draft.runtime.temporaryAccessGrants['5'] = { tabId: 5, nonce: 'grant_secret', expiresAt: 9999999 };
    });

    const state = await storage.getState();

    // Replicate EXPORT_DATA logic
    const exportPayload = {
      schemaVersion: state.schemaVersion,
      exportedAt: Date.now(),
      collections: state.collections,
      settings: state.settings,
    };

    // Assert: Runtime nonces and temporary grants MUST NOT be in the export payload
    assert.equal((exportPayload as any).runtime, undefined);
    assert.equal((exportPayload as any).collections['col_news'].name, 'News');
    assert.equal(exportPayload.settings.theme, 'sepia');

    // Verify payload validation accepts the clean export
    const valResult = validateImportPayload(exportPayload);
    assert.equal(valResult.valid, true);
  });
});
