/**
 * Moment Storage Migrations
 * Ensures backwards compatibility and safe deterministic upgrade of state envelopes.
 */

import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_STORAGE_STATE,
  DEFAULT_USER_SETTINGS,
  MomentStorageEnvelope,
  UserSettings,
} from './schema.js';
import { sanitizeAccentId } from '../shared/accent.js';
import { Collection } from '../core/models/collection.js';

function isObject(val: unknown): val is Record<string, any> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function sanitizeSettings(rawSettings: unknown): UserSettings {
  if (!isObject(rawSettings)) {
    return { ...DEFAULT_USER_SETTINGS };
  }
  const theme = ['system', 'light', 'dark', 'sepia'].includes(rawSettings.theme)
    ? rawSettings.theme
    : DEFAULT_USER_SETTINGS.theme;
  const accentLight = sanitizeAccentId(rawSettings.accentLight);
  const accentDark = sanitizeAccentId(rawSettings.accentDark);
  const timeFormat = ['12h', '24h'].includes(rawSettings.timeFormat)
    ? rawSettings.timeFormat
    : DEFAULT_USER_SETTINGS.timeFormat;
  const reducedMotion = typeof rawSettings.reducedMotion === 'boolean'
    ? rawSettings.reducedMotion
    : DEFAULT_USER_SETTINGS.reducedMotion;
  const allowPrivateBrowsing = typeof rawSettings.allowPrivateBrowsing === 'boolean'
    ? rawSettings.allowPrivateBrowsing
    : DEFAULT_USER_SETTINGS.allowPrivateBrowsing;
  const temporaryUnlockScope = ['THIS_TAB_ONLY', 'ALL_TABS_UNTIL_EXPIRATION'].includes(rawSettings.temporaryUnlockScope)
    ? rawSettings.temporaryUnlockScope
    : DEFAULT_USER_SETTINGS.temporaryUnlockScope;

  return { theme, accentLight, accentDark, timeFormat, reducedMotion, allowPrivateBrowsing, temporaryUnlockScope };
}

/**
 * @param {unknown} rawCollections
 * @returns {Record<string, any>}
 */
function sanitizeCollections(rawCollections: unknown): Record<string, Collection> {
  if (!isObject(rawCollections)) {
    return {};
  }
  const result: Record<string, Collection> = {};
  for (const [colId, rawCol] of Object.entries(rawCollections)) {
    if (!isObject(rawCol)) continue;
    if (typeof rawCol.name !== 'string' || typeof rawCol.id !== 'string') continue;

    const targets = Array.isArray(rawCol.targets)
      ? rawCol.targets.filter(
          (t) => isObject(t) && typeof t.pattern === 'string' && typeof t.type === 'string'
        )
      : [];

    result[colId] = {
      id: rawCol.id,
      name: rawCol.name,
      color: typeof rawCol.color === 'string' ? rawCol.color : '#2e7d32',
      icon: typeof rawCol.icon === 'string' ? rawCol.icon : 'shield',
      enabled: rawCol.enabled !== false,
      createdAt: typeof rawCol.createdAt === 'number' ? rawCol.createdAt : Date.now(),
      updatedAt: typeof rawCol.updatedAt === 'number' ? rawCol.updatedAt : Date.now(),
      dailyLimitMs:
        typeof rawCol.dailyLimitMs === 'number' && Number.isFinite(rawCol.dailyLimitMs)
          ? rawCol.dailyLimitMs
          : null,
      targets,
      boundary: isObject(rawCol.boundary)
        ? (rawCol.boundary as any)
        : {
            schedule: { enabled: false, intervals: [] },
            limits: { dailyMinutes: null, sessionMinutes: null },
            pause: { type: 'BREATHE', durationSeconds: 10, requireIntentionText: false },
            action: { type: 'BLOCK_PAGE', redirectUrl: null },
            strictMode: false,
          },
      customBlockMessage:
        typeof rawCol.customBlockMessage === 'string' && rawCol.customBlockMessage.trim().length > 0
          ? rawCol.customBlockMessage.trim().slice(0, 250)
          : null,
      openingMessageMode: ['NONE', 'CUSTOM', 'RANDOM', 'MOMENT_LIBRARY'].includes(rawCol.openingMessageMode)
        ? rawCol.openingMessageMode
        : 'NONE',
      messageIntensity: ['MILD', 'SARCASTIC', 'SPICY', 'BRUTAL'].includes(rawCol.messageIntensity)
        ? rawCol.messageIntensity
        : 'MILD',
      openingMessages: Array.isArray(rawCol.openingMessages)
        ? rawCol.openingMessages
            .filter((m: any) => typeof m === 'string' && m.trim().length > 0)
            .map((m: string) => m.trim().slice(0, 250))
            .slice(0, 10)
        : [],
      whenAccessExpires: rawCol.whenAccessExpires === 'NEXT_NAV' ? 'NEXT_NAV' : 'IMMEDIATE',
    };
  }
  return result;
}

/**
 * @param {unknown} rawUsage
 * @returns {Record<string, any>}
 */
function sanitizeUsage(rawUsage: unknown): Record<string, any> {
  if (!isObject(rawUsage)) {
    return {};
  }
  const result: Record<string, any> = {};
  for (const [key, record] of Object.entries(rawUsage)) {
    if (!isObject(record)) continue;
    if (typeof record.dateKey !== 'string' || typeof record.collectionId !== 'string') continue;
    result[key] = {
      dateKey: record.dateKey,
      collectionId: record.collectionId,
      accumulatedMs:
        typeof record.accumulatedMs === 'number' &&
        Number.isFinite(record.accumulatedMs) &&
        record.accumulatedMs >= 0
          ? record.accumulatedMs
          : 0,
      updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now(),
      ...(typeof record.extendedMs === 'number' && Number.isFinite(record.extendedMs) && record.extendedMs > 0
        ? { extendedMs: record.extendedMs }
        : {}),
      ...(typeof record.extensionCount === 'number' && Number.isFinite(record.extensionCount) && record.extensionCount > 0
        ? { extensionCount: Math.floor(record.extensionCount) }
        : {}),
    };
  }
  return result;
}

function sanitizeRuntime(rawRuntime: unknown): any {
  if (!isObject(rawRuntime)) {
    return {
      pendingInterventions: {},
      temporaryAccessGrants: {},
      sitePasses: {},
      intentPasses: {},
      focusSession: null,
    };
  }

  const focusSession =
    isObject(rawRuntime.focusSession) && typeof rawRuntime.focusSession.id === 'string'
      ? rawRuntime.focusSession
      : null;

  const sitePasses: Record<string, any> = {};
  if (isObject(rawRuntime.sitePasses)) {
    for (const [key, pass] of Object.entries(rawRuntime.sitePasses)) {
      if (!isObject(pass)) continue;
      sitePasses[key] = {
        ...pass,
        scope: pass.scope === 'ALL_TABS_UNTIL_EXPIRATION' ? 'ALL_TABS_UNTIL_EXPIRATION' : 'THIS_TAB_ONLY',
      };
    }
  }

  return {
    pendingInterventions: isObject(rawRuntime.pendingInterventions)
      ? rawRuntime.pendingInterventions
      : {},
    temporaryAccessGrants: isObject(rawRuntime.temporaryAccessGrants)
      ? rawRuntime.temporaryAccessGrants
      : {},
    sitePasses,
    intentPasses: isObject(rawRuntime.intentPasses) ? rawRuntime.intentPasses : {},
    tracking: isObject(rawRuntime.tracking) ? rawRuntime.tracking : undefined,
    focusSession,
  };
}

/**
 * @param {any} raw
 * @returns {any}
 */
export function migrateStorageState(raw: any): MomentStorageEnvelope {
  if (!isObject(raw)) {
    return { ...DEFAULT_STORAGE_STATE };
  }

  let state: any = { ...raw };
  let version = typeof state.schemaVersion === 'number' && Number.isInteger(state.schemaVersion)
    ? state.schemaVersion
    : 0;

  // Migration: Fresh initialization for corrupt or unversioned state
  if (version === 0) {
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      settings: sanitizeSettings(state.settings),
      collections: sanitizeCollections(state.collections),
      usage: sanitizeUsage(state.usage),
      runtime: {
        pendingInterventions: {},
        temporaryAccessGrants: {},
        sitePasses: {},
        intentPasses: {},
        focusSession: null,
      },
    };
  }

  // Migration: v1 -> v2 (Adds target priority support and ensures collection integrity)
  if (version === 1) {
    const upgradedCollections: Record<string, Collection> = {};
    const oldCollections = isObject(state.collections) ? state.collections : {};

    for (const [colId, col] of Object.entries(oldCollections)) {
      if (!isObject(col)) continue;
      const c = col as any;
      const upgradedTargets = Array.isArray(c.targets)
        ? c.targets.map((t: any) => ({
            ...t,
            priority: typeof t?.priority === 'number' ? t.priority : 0,
          }))
        : [];

      upgradedCollections[colId] = {
        ...c,
        targets: upgradedTargets,
      };
    }

    state = {
      ...state,
      schemaVersion: 2,
      collections: upgradedCollections,
    };
    version = 2;
  }

  // Migration: v2 -> v3 (Adds usage dictionary and tracking runtime state)
  if (version === 2) {
    state = {
      ...state,
      schemaVersion: 3,
      usage: isObject(state.usage) ? state.usage : {},
    };
    version = 3;
  }

  // Current version check
  if (version === CURRENT_SCHEMA_VERSION) {
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      settings: sanitizeSettings(state.settings),
      collections: sanitizeCollections(state.collections),
      usage: sanitizeUsage(state.usage),
      runtime: sanitizeRuntime(state.runtime),
    };
  }

  // Fallback safe reset preserving any valid existing user collections
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    settings: sanitizeSettings(state.settings),
    collections: sanitizeCollections(state.collections),
    usage: sanitizeUsage(state.usage),
    runtime: {
      pendingInterventions: {},
      temporaryAccessGrants: {},
      sitePasses: {},
      intentPasses: {},
      focusSession: null,
    },
  };
}
