/**
 * Moment Storage Schema & State Envelope
 * Defines the versioned storage envelope and safe initial defaults.
 */
export const CURRENT_SCHEMA_VERSION = 3;
export const DEFAULT_USER_SETTINGS = {
    theme: 'system',
    timeFormat: '24h',
    reducedMotion: false,
    allowPrivateBrowsing: false,
};
export const DEFAULT_STORAGE_STATE = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    settings: DEFAULT_USER_SETTINGS,
    collections: {},
    usage: {},
    runtime: {
        pendingInterventions: {},
        temporaryAccessGrants: {},
        sitePasses: {},
        intentPasses: {},
        focusSession: null,
    },
};
