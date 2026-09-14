/**
 * Moment Storage Schema & State Envelope
 * Defines the versioned storage envelope and safe initial defaults.
 */

import { Collection } from '../core/models/collection.js';
import { TemporaryAccessGrant } from '../core/models/grant.js';
import { SitePass } from '../core/models/site-pass.js';
import { IntentPass } from '../core/models/intent-pass.js';
import { FocusSession } from '../core/models/focus-session.js';
import { PendingIntervention } from '../core/interventions/types.js';
import { DailyUsageRecord, ActiveTrackingState } from '../core/usage/types.js';

export const CURRENT_SCHEMA_VERSION = 3;

export interface UserSettings {
  readonly theme: 'system' | 'light' | 'dark' | 'sepia';
  readonly timeFormat: '12h' | '24h';
  readonly reducedMotion: boolean;
  readonly allowPrivateBrowsing: boolean;
  readonly temporaryUnlockScope: 'THIS_TAB_ONLY' | 'ALL_TABS_UNTIL_EXPIRATION';
}

export type PendingInterventionState = PendingIntervention;

export interface RuntimeState {
  pendingInterventions: Record<string, PendingInterventionState>;
  temporaryAccessGrants: Record<string, TemporaryAccessGrant>;
  sitePasses: Record<string, SitePass>;
  intentPasses: Record<string, IntentPass>;
  tracking?: ActiveTrackingState;
  focusSession?: FocusSession | null;
}

export interface MomentStorageEnvelope {
  readonly schemaVersion: number;
  readonly settings: UserSettings;
  readonly collections: Record<string, Collection>;
  readonly usage: Record<string, DailyUsageRecord>;
  readonly runtime: RuntimeState;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  theme: 'system',
  timeFormat: '24h',
  reducedMotion: false,
  allowPrivateBrowsing: false,
  temporaryUnlockScope: 'THIS_TAB_ONLY',
};

export const DEFAULT_STORAGE_STATE: MomentStorageEnvelope = {
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
