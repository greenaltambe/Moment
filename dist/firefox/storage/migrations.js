/**
 * Moment Storage Migrations
 * Ensures backwards compatibility and safe deterministic upgrade of state envelopes.
 */
import { CURRENT_SCHEMA_VERSION, DEFAULT_STORAGE_STATE, DEFAULT_USER_SETTINGS, } from './schema.js';
function isObject(val) {
    return typeof val === 'object' && val !== null && !Array.isArray(val);
}
function sanitizeSettings(rawSettings) {
    if (!isObject(rawSettings)) {
        return { ...DEFAULT_USER_SETTINGS };
    }
    const theme = ['system', 'light', 'dark', 'sepia'].includes(rawSettings.theme)
        ? rawSettings.theme
        : DEFAULT_USER_SETTINGS.theme;
    const timeFormat = ['12h', '24h'].includes(rawSettings.timeFormat)
        ? rawSettings.timeFormat
        : DEFAULT_USER_SETTINGS.timeFormat;
    const reducedMotion = typeof rawSettings.reducedMotion === 'boolean'
        ? rawSettings.reducedMotion
        : DEFAULT_USER_SETTINGS.reducedMotion;
    const allowPrivateBrowsing = typeof rawSettings.allowPrivateBrowsing === 'boolean'
        ? rawSettings.allowPrivateBrowsing
        : DEFAULT_USER_SETTINGS.allowPrivateBrowsing;
    return { theme, timeFormat, reducedMotion, allowPrivateBrowsing };
}
/**
 * @param {unknown} rawCollections
 * @returns {Record<string, any>}
 */
function sanitizeCollections(rawCollections) {
    if (!isObject(rawCollections)) {
        return {};
    }
    const result = {};
    for (const [colId, rawCol] of Object.entries(rawCollections)) {
        if (!isObject(rawCol))
            continue;
        if (typeof rawCol.name !== 'string' || typeof rawCol.id !== 'string')
            continue;
        const targets = Array.isArray(rawCol.targets)
            ? rawCol.targets.filter((t) => isObject(t) && typeof t.pattern === 'string' && typeof t.type === 'string')
            : [];
        result[colId] = {
            id: rawCol.id,
            name: rawCol.name,
            color: typeof rawCol.color === 'string' ? rawCol.color : '#2e7d32',
            icon: typeof rawCol.icon === 'string' ? rawCol.icon : 'shield',
            enabled: rawCol.enabled !== false,
            createdAt: typeof rawCol.createdAt === 'number' ? rawCol.createdAt : Date.now(),
            updatedAt: typeof rawCol.updatedAt === 'number' ? rawCol.updatedAt : Date.now(),
            dailyLimitMs: typeof rawCol.dailyLimitMs === 'number' && Number.isFinite(rawCol.dailyLimitMs)
                ? rawCol.dailyLimitMs
                : null,
            targets,
            boundary: isObject(rawCol.boundary)
                ? rawCol.boundary
                : {
                    schedule: { enabled: false, intervals: [] },
                    limits: { dailyMinutes: null, sessionMinutes: null },
                    pause: { type: 'BREATHE', durationSeconds: 10, requireIntentionText: false },
                    action: { type: 'BLOCK_PAGE', redirectUrl: null },
                    strictMode: false,
                },
            customBlockMessage: typeof rawCol.customBlockMessage === 'string' && rawCol.customBlockMessage.trim().length > 0
                ? rawCol.customBlockMessage.trim().slice(0, 250)
                : null,
            openingMessageMode: ['NONE', 'CUSTOM', 'RANDOM'].includes(rawCol.openingMessageMode)
                ? rawCol.openingMessageMode
                : 'NONE',
            openingMessages: Array.isArray(rawCol.openingMessages)
                ? rawCol.openingMessages
                    .filter((m) => typeof m === 'string' && m.trim().length > 0)
                    .map((m) => m.trim().slice(0, 250))
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
function sanitizeUsage(rawUsage) {
    if (!isObject(rawUsage)) {
        return {};
    }
    const result = {};
    for (const [key, record] of Object.entries(rawUsage)) {
        if (!isObject(record))
            continue;
        if (typeof record.dateKey !== 'string' || typeof record.collectionId !== 'string')
            continue;
        result[key] = {
            dateKey: record.dateKey,
            collectionId: record.collectionId,
            accumulatedMs: typeof record.accumulatedMs === 'number' &&
                Number.isFinite(record.accumulatedMs) &&
                record.accumulatedMs >= 0
                ? record.accumulatedMs
                : 0,
            updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now(),
        };
    }
    return result;
}
function sanitizeRuntime(rawRuntime) {
    if (!isObject(rawRuntime)) {
        return {
            pendingInterventions: {},
            temporaryAccessGrants: {},
            sitePasses: {},
            intentPasses: {},
            focusSession: null,
        };
    }
    const focusSession = isObject(rawRuntime.focusSession) && typeof rawRuntime.focusSession.id === 'string'
        ? rawRuntime.focusSession
        : null;
    return {
        pendingInterventions: isObject(rawRuntime.pendingInterventions)
            ? rawRuntime.pendingInterventions
            : {},
        temporaryAccessGrants: isObject(rawRuntime.temporaryAccessGrants)
            ? rawRuntime.temporaryAccessGrants
            : {},
        sitePasses: isObject(rawRuntime.sitePasses) ? rawRuntime.sitePasses : {},
        intentPasses: isObject(rawRuntime.intentPasses) ? rawRuntime.intentPasses : {},
        tracking: isObject(rawRuntime.tracking) ? rawRuntime.tracking : undefined,
        focusSession,
    };
}
/**
 * @param {any} raw
 * @returns {any}
 */
export function migrateStorageState(raw) {
    if (!isObject(raw)) {
        return { ...DEFAULT_STORAGE_STATE };
    }
    let state = { ...raw };
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
        const upgradedCollections = {};
        const oldCollections = isObject(state.collections) ? state.collections : {};
        for (const [colId, col] of Object.entries(oldCollections)) {
            if (!isObject(col))
                continue;
            const c = col;
            const upgradedTargets = Array.isArray(c.targets)
                ? c.targets.map((t) => ({
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
