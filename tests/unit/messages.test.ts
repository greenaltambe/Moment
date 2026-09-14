import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isValidMessage } from '../../dist/chrome/shared/messages.js';
import { ExtensionStorage } from '../../dist/chrome/storage/storage.js';

describe('Moment Message Protocol Runtime Validation', () => {
  it('Validates GET_STATE message', () => {
    assert.equal(isValidMessage({ type: 'GET_STATE' }), true);
  });

  it('Validates GET_CURRENT_TAB message', () => {
    assert.equal(isValidMessage({ type: 'GET_CURRENT_TAB' }), true);
  });

  it('Validates COMPLETE_INTERVENTION with all required fields', () => {
    assert.equal(
      isValidMessage({
        type: 'COMPLETE_INTERVENTION',
        tabId: 10,
        targetUrl: 'https://example.com/target',
        nonce: 'nonce_abc_123',
      }),
      true
    );
  });

  it('Rejects COMPLETE_INTERVENTION missing nonce', () => {
    assert.equal(
      isValidMessage({
        type: 'COMPLETE_INTERVENTION',
        tabId: 10,
        targetUrl: 'https://example.com/target',
      }),
      false
    );
  });

  it('Rejects COMPLETE_INTERVENTION with invalid tabId type', () => {
    assert.equal(
      isValidMessage({
        type: 'COMPLETE_INTERVENTION',
        tabId: 'not-a-number',
        targetUrl: 'https://example.com/target',
        nonce: 'abc',
      }),
      false
    );
  });

  it('Validates CANCEL_INTERVENTION with valid tabId and nonce', () => {
    assert.equal(
      isValidMessage({
        type: 'CANCEL_INTERVENTION',
        tabId: 42,
        nonce: 'nonce_cancel_789',
      }),
      true
    );
  });

  it('Rejects CANCEL_INTERVENTION missing nonce or empty nonce', () => {
    assert.equal(
      isValidMessage({
        type: 'CANCEL_INTERVENTION',
        tabId: 42,
      }),
      false
    );
    assert.equal(
      isValidMessage({
        type: 'CANCEL_INTERVENTION',
        tabId: 42,
        nonce: '',
      }),
      false
    );
  });

  it('Rejects CANCEL_INTERVENTION with invalid tabId', () => {
    assert.equal(
      isValidMessage({
        type: 'CANCEL_INTERVENTION',
        tabId: '42' as any,
        nonce: 'nonce_123',
      }),
      false
    );
  });

  it('Validates GET_INTERVENTION message', () => {
    assert.equal(
      isValidMessage({
        type: 'GET_INTERVENTION',
        tabId: 5,
        nonce: 'nonce_valid_123',
      }),
      true
    );
    assert.equal(
      isValidMessage({
        type: 'GET_INTERVENTION',
        tabId: 5,
      }),
      false
    );
  });

  it('Validates UPDATE_INTERVENTION_STATUS message', () => {
    assert.equal(
      isValidMessage({
        type: 'UPDATE_INTERVENTION_STATUS',
        tabId: 5,
        nonce: 'nonce_valid_123',
        status: 'IN_PROGRESS',
      }),
      true
    );
    assert.equal(
      isValidMessage({
        type: 'UPDATE_INTERVENTION_STATUS',
        tabId: 5,
        nonce: 'nonce_valid_123',
        status: 'INVALID_STATUS' as any,
      }),
      false
    );
  });

  it('Rejects messages with unknown types', () => {
    assert.equal(isValidMessage({ type: 'UNAUTHORIZED_ACTION' }), false);
    assert.equal(isValidMessage(null), false);
    assert.equal(isValidMessage('not an object'), false);
  });
});

describe('Moment Intervention Cancellation Authorization Logic', () => {
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

  // Exactly replicates background cancellation logic
  async function performCancellation(
    storage: ExtensionStorage,
    tabId: number,
    nonce: string
  ): Promise<{ success: boolean; error?: string }> {
    let cancelled = false;
    await storage.updateState((draft: any) => {
      const key = String(tabId);
      const pending = draft.runtime.pendingInterventions[key];
      if (!pending) return;
      if (pending.nonce !== nonce) return;
      delete draft.runtime.pendingInterventions[key];
      cancelled = true;
    });

    if (!cancelled) {
      return { success: false, error: 'Invalid, nonexistent, or mismatched intervention cancellation' };
    }
    return { success: true };
  }

  it('Successfully cancels pending intervention when tabId and nonce match', async () => {
    const storage = createMockStorage();
    await storage.updateState((draft: any) => {
      draft.runtime.pendingInterventions['10'] = {
        tabId: 10,
        targetUrl: 'https://reddit.com',
        nonce: 'correct_nonce',
        createdAt: 1000,
      };
    });

    const res = await performCancellation(storage, 10, 'correct_nonce');
    assert.equal(res.success, true);

    const state = await storage.getState();
    assert.equal(state.runtime.pendingInterventions['10'], undefined);
  });

  it('Rejects cancellation when intervention does not exist', async () => {
    const storage = createMockStorage();
    const res = await performCancellation(storage, 99, 'any_nonce');
    assert.equal(res.success, false);
    assert.ok(res.error?.includes('nonexistent'));
  });

  it('Rejects cancellation on wrong tab ID', async () => {
    const storage = createMockStorage();
    await storage.updateState((draft: any) => {
      draft.runtime.pendingInterventions['10'] = {
        tabId: 10,
        targetUrl: 'https://reddit.com',
        nonce: 'nonce_10',
        createdAt: 1000,
      };
    });

    const res = await performCancellation(storage, 20, 'nonce_10');
    assert.equal(res.success, false);

    const state = await storage.getState();
    assert.ok(state.runtime.pendingInterventions['10']); // Unmodified
  });

  it('Rejects cancellation on wrong or malformed nonce', async () => {
    const storage = createMockStorage();
    await storage.updateState((draft: any) => {
      draft.runtime.pendingInterventions['10'] = {
        tabId: 10,
        targetUrl: 'https://reddit.com',
        nonce: 'secret_10',
        createdAt: 1000,
      };
    });

    const res = await performCancellation(storage, 10, 'forged_or_wrong_nonce');
    assert.equal(res.success, false);

    const state = await storage.getState();
    assert.equal(state.runtime.pendingInterventions['10'].nonce, 'secret_10'); // Untouched
  });

  it('Prevents replay / repeated cancellation attacks', async () => {
    const storage = createMockStorage();
    await storage.updateState((draft: any) => {
      draft.runtime.pendingInterventions['10'] = {
        tabId: 10,
        targetUrl: 'https://reddit.com',
        nonce: 'single_use_nonce',
        createdAt: 1000,
      };
    });

    // First cancellation succeeds
    const res1 = await performCancellation(storage, 10, 'single_use_nonce');
    assert.equal(res1.success, true);

    // Replay cancellation fails
    const res2 = await performCancellation(storage, 10, 'single_use_nonce');
    assert.equal(res2.success, false);
  });

  it('Ensures cancelling one tab cannot affect another tab', async () => {
    const storage = createMockStorage();
    await storage.updateState((draft: any) => {
      draft.runtime.pendingInterventions['10'] = {
        tabId: 10,
        targetUrl: 'https://reddit.com',
        nonce: 'nonce_10',
        createdAt: 1000,
      };
      draft.runtime.pendingInterventions['20'] = {
        tabId: 20,
        targetUrl: 'https://twitter.com',
        nonce: 'nonce_20',
        createdAt: 1000,
      };
    });

    // Cancel tab 10
    await performCancellation(storage, 10, 'nonce_10');

    const state = await storage.getState();
    assert.equal(state.runtime.pendingInterventions['10'], undefined);
    assert.ok(state.runtime.pendingInterventions['20']); // Tab 20 strictly preserved
    assert.equal(state.runtime.pendingInterventions['20'].targetUrl, 'https://twitter.com');
  });
});
