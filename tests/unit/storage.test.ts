import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_SCHEMA_VERSION, DEFAULT_STORAGE_STATE } from '../../dist/chrome/storage/schema.js';
import { migrateStorageState } from '../../dist/chrome/storage/migrations.js';
import { ExtensionStorage } from '../../dist/chrome/storage/storage.js';
import { isGrantValidForNavigation } from '../../dist/chrome/core/grants/grant-validator.js';
import type { TemporaryAccessGrant } from '../../src/core/models/grant.js';

describe('Moment Storage & Schema Architecture', () => {
  it('Initializes with valid default schema version and settings', () => {
    assert.equal(DEFAULT_STORAGE_STATE.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(DEFAULT_STORAGE_STATE.schemaVersion, 3);
    assert.equal(DEFAULT_STORAGE_STATE.settings.theme, 'system');
    assert.deepEqual(DEFAULT_STORAGE_STATE.collections, {});
    assert.deepEqual(DEFAULT_STORAGE_STATE.usage, {});
  });

  it('Migration handler initializes fresh state when raw state is empty or invalid', () => {
    const migrated = migrateStorageState(null);
    assert.equal(migrated.schemaVersion, 3);
    assert.equal(migrated.settings.theme, 'system');
    assert.deepEqual(migrated.runtime.temporaryAccessGrants, {});
    assert.deepEqual(migrated.usage, {});
  });

  it('Migration handler deterministically upgrades v1 schema to v3', () => {
    const v1State = {
      schemaVersion: 1,
      settings: { theme: 'dark', timeFormat: '12h' },
      collections: {
        col1: {
          id: 'col1',
          name: 'Focus',
          targets: [
            { id: 't1', pattern: 'reddit.com', type: 'WEBSITE', isException: false, createdAt: 100 },
          ],
        },
      },
      runtime: {
        pendingInterventions: {},
        temporaryAccessGrants: {},
      },
    };

    const migrated = migrateStorageState(v1State);
    assert.equal(migrated.schemaVersion, 3);
    assert.equal(migrated.settings.theme, 'dark');
    assert.equal(migrated.settings.timeFormat, '12h');
    assert.ok(migrated.collections.col1);
    assert.equal(migrated.collections.col1.targets[0].priority, 0); // Default priority assigned
    assert.deepEqual(migrated.usage, {});
  });

  it('Migration handler deterministically upgrades v2 schema to v3', () => {
    const v2State = {
      schemaVersion: 2,
      settings: { theme: 'light', timeFormat: '24h' },
      collections: {
        col1: {
          id: 'col1',
          name: 'Focus',
          targets: [],
        },
      },
      runtime: {
        pendingInterventions: {},
        temporaryAccessGrants: {},
      },
    };

    const migrated = migrateStorageState(v2State);
    assert.equal(migrated.schemaVersion, 3);
    assert.equal(migrated.settings.theme, 'light');
    assert.ok(migrated.usage);
    assert.deepEqual(migrated.usage, {});
  });

  it('Migration handler preserves existing user settings when schema matches current version', () => {
    const raw = {
      schemaVersion: 3,
      settings: { theme: 'sepia', timeFormat: '24h' },
      collections: { col1: { id: 'col1', name: 'Work' } },
      usage: { '2026-09-08:col1': { dateKey: '2026-09-08', collectionId: 'col1', accumulatedMs: 5000, updatedAt: 1000 } },
      runtime: {},
    };

    const migrated = migrateStorageState(raw);
    assert.equal(migrated.schemaVersion, 3);
    assert.equal(migrated.settings.theme, 'sepia');
    assert.equal(migrated.settings.timeFormat, '24h');
    assert.ok(migrated.collections.col1);
    assert.equal(migrated.usage['2026-09-08:col1'].accumulatedMs, 5000);
  });

  it('[SIMULATED PERSISTENCE TEST] ExtensionStorage persists grants and pending interventions across simulated worker eviction', async () => {
    // In-memory backend mock simulating browser.storage.local
    const mockDb: Record<string, any> = {};
    const mockBackend = {
      get: (key: string, cb: (res: any) => void) => cb({ [key]: mockDb[key] }),
      set: (obj: any, cb: () => void) => {
        Object.assign(mockDb, obj);
        cb();
      },
    };

    const now = 10_000;

    // WORKER INSTANCE A: Active worker writes pending intervention and temporary access grant
    const workerAStorage = new ExtensionStorage(mockBackend);
    await workerAStorage.updateState((draft: any) => {
      draft.runtime.pendingInterventions['99'] = {
        tabId: 99,
        targetUrl: 'https://reddit.com',
        nonce: 'secret_nonce_123',
        createdAt: now,
      };

      const grant: TemporaryAccessGrant = {
        id: 'grant_sim_1',
        tabId: 99,
        target: 'https://reddit.com',
        grantedAt: now,
        expiresAt: now + 60_000,
        nonce: 'secret_nonce_123',
        singleUse: true,
      };
      draft.runtime.temporaryAccessGrants['99'] = grant;
    });

    // SIMULATED WORKER CRASH / EVICTION:
    // workerA is garbage-collected or evicted by the browser. All memory variables vanish.

    // WORKER INSTANCE B: Fresh worker boots up in completely new memory space
    const workerBStorage = new ExtensionStorage(mockBackend);
    const restoredState = await workerBStorage.getState();

    // Verify pending intervention survived worker eviction
    assert.ok(restoredState.runtime.pendingInterventions['99']);
    assert.equal(restoredState.runtime.pendingInterventions['99'].nonce, 'secret_nonce_123');
    assert.equal(restoredState.runtime.pendingInterventions['99'].targetUrl, 'https://reddit.com');

    // Verify temporary access grant survived worker eviction and validates navigation
    const restoredGrant = restoredState.runtime.temporaryAccessGrants['99'];
    assert.ok(restoredGrant);
    assert.equal(restoredGrant.id, 'grant_sim_1');

    const isValid = isGrantValidForNavigation(
      restoredGrant,
      99,
      'https://reddit.com/r/programming',
      now + 5_000
    );
    assert.equal(isValid, true);
  });
});
