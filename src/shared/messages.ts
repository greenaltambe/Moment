/**
 * Moment Typed Message Protocol
 * Provides explicit request/response typing and runtime payload validation
 * for UI <-> Background communication.
 */

import { TargetRuleType, Target } from '../core/models/target.js';
import { Collection, OpeningMessageMode, WhenAccessExpires } from '../core/models/collection.js';
import { BoundaryPolicy } from '../core/models/boundary.js';
import { UserSettings } from '../storage/schema.js';

export type MessageType =
  | 'GET_STATE'
  | 'GET_CURRENT_TAB'
  | 'GET_INTERVENTION'
  | 'UPDATE_INTERVENTION_STATUS'
  | 'COMPLETE_INTERVENTION'
  | 'CANCEL_INTERVENTION'
  | 'GET_CAPABILITIES'
  | 'RESET_ALL_GRANTS_TEST'
  | 'GET_TAB_USAGE'
  | 'GET_COLLECTION_USAGE'
  | 'GET_CURRENT_SITE_STATE'
  | 'GET_COLLECTIONS'
  | 'CREATE_COLLECTION'
  | 'UPDATE_COLLECTION'
  | 'DELETE_COLLECTION'
  | 'CREATE_RULE'
  | 'UPDATE_RULE'
  | 'DELETE_RULE'
  | 'GET_SETTINGS'
  | 'UPDATE_SETTINGS'
  | 'EXPORT_DATA'
  | 'IMPORT_DATA'
  | 'REQUEST_INTENT_PASS'
  | 'GET_INTENT_PASS_STATUS'
  | 'END_INTENT_PASS'
  | 'START_FOCUS_MODE'
  | 'GET_FOCUS_MODE_STATUS'
  | 'END_FOCUS_MODE';

export interface BaseMessage {
  readonly type: MessageType;
}

export interface GetStateMessage extends BaseMessage {
  readonly type: 'GET_STATE';
}

export interface GetCurrentTabMessage extends BaseMessage {
  readonly type: 'GET_CURRENT_TAB';
}

export interface GetInterventionMessage extends BaseMessage {
  readonly type: 'GET_INTERVENTION';
  readonly tabId: number;
  readonly nonce: string;
}

export interface UpdateInterventionStatusMessage extends BaseMessage {
  readonly type: 'UPDATE_INTERVENTION_STATUS';
  readonly tabId: number;
  readonly nonce: string;
  readonly status: 'IN_PROGRESS';
}

export interface CompleteInterventionMessage extends BaseMessage {
  readonly type: 'COMPLETE_INTERVENTION';
  readonly tabId: number;
  readonly targetUrl: string;
  readonly nonce: string;
  readonly durationMs?: number;
  readonly intentionText?: string;
}

export interface CancelInterventionMessage extends BaseMessage {
  readonly type: 'CANCEL_INTERVENTION';
  readonly tabId: number;
  readonly nonce: string;
}

export interface RequestIntentPassMessage extends BaseMessage {
  readonly type: 'REQUEST_INTENT_PASS';
  readonly tabId?: number;
  readonly durationMs: number;
}

export interface GetIntentPassStatusMessage extends BaseMessage {
  readonly type: 'GET_INTENT_PASS_STATUS';
  readonly tabId?: number;
}

export interface EndIntentPassMessage extends BaseMessage {
  readonly type: 'END_INTENT_PASS';
  readonly tabId?: number;
}

export interface StartFocusModeMessage extends BaseMessage {
  readonly type: 'START_FOCUS_MODE';
  readonly durationMs: number;
  readonly collectionIds: readonly string[];
}

export interface GetFocusModeStatusMessage extends BaseMessage {
  readonly type: 'GET_FOCUS_MODE_STATUS';
}

export interface EndFocusModeMessage extends BaseMessage {
  readonly type: 'END_FOCUS_MODE';
}

export interface GetCapabilitiesMessage extends BaseMessage {
  readonly type: 'GET_CAPABILITIES';
}

export interface ResetAllGrantsTestMessage extends BaseMessage {
  readonly type: 'RESET_ALL_GRANTS_TEST';
}

export interface GetTabUsageMessage extends BaseMessage {
  readonly type: 'GET_TAB_USAGE';
  readonly tabId?: number;
}

export interface GetCollectionUsageMessage extends BaseMessage {
  readonly type: 'GET_COLLECTION_USAGE';
  readonly collectionId: string;
}

export interface GetCurrentSiteStateMessage extends BaseMessage {
  readonly type: 'GET_CURRENT_SITE_STATE';
  readonly tabId?: number;
}

export interface GetCollectionsMessage extends BaseMessage {
  readonly type: 'GET_COLLECTIONS';
}

export interface CreateCollectionMessage extends BaseMessage {
  readonly type: 'CREATE_COLLECTION';
  readonly name: string;
  readonly color?: string;
  readonly icon?: string;
  readonly dailyLimitMs?: number | null;
  readonly boundary?: BoundaryPolicy;
  readonly customBlockMessage?: string | null;
  readonly openingMessageMode?: OpeningMessageMode;
  readonly openingMessages?: readonly string[];
  readonly whenAccessExpires?: WhenAccessExpires;
}

export interface UpdateCollectionMessage extends BaseMessage {
  readonly type: 'UPDATE_COLLECTION';
  readonly collectionId: string;
  readonly updates: Partial<Omit<Collection, 'id' | 'createdAt'>>;
}

export interface DeleteCollectionMessage extends BaseMessage {
  readonly type: 'DELETE_COLLECTION';
  readonly collectionId: string;
}

export interface CreateRuleMessage extends BaseMessage {
  readonly type: 'CREATE_RULE';
  readonly collectionId: string;
  readonly pattern: string;
  readonly ruleType: TargetRuleType;
  readonly isException?: boolean;
}

export interface UpdateRuleMessage extends BaseMessage {
  readonly type: 'UPDATE_RULE';
  readonly collectionId: string;
  readonly ruleId: string;
  readonly updates: Partial<Omit<Target, 'id' | 'createdAt'>>;
}

export interface DeleteRuleMessage extends BaseMessage {
  readonly type: 'DELETE_RULE';
  readonly collectionId: string;
  readonly ruleId: string;
}

export interface GetSettingsMessage extends BaseMessage {
  readonly type: 'GET_SETTINGS';
}

export interface UpdateSettingsMessage extends BaseMessage {
  readonly type: 'UPDATE_SETTINGS';
  readonly settings: Partial<UserSettings>;
}

export interface ExportDataMessage extends BaseMessage {
  readonly type: 'EXPORT_DATA';
}

export interface ImportDataMessage extends BaseMessage {
  readonly type: 'IMPORT_DATA';
  readonly data: unknown;
  readonly mode?: 'merge' | 'replace';
}

export interface TabUsageSummary {
  readonly tabId: number;
  readonly url?: string;
  readonly hostname?: string;
  readonly collectionId: string | null;
  readonly collectionName: string | null;
  readonly dailyLimitMs: number | null;
  readonly usedMs: number;
  readonly remainingMs: number | null;
  readonly isExhausted: boolean;
  readonly formattedUsed: string;
  readonly formattedLimit: string | null;
  readonly formattedRemaining: string | null;
}

export interface CollectionUsageSummary {
  readonly collectionId: string;
  readonly collectionName: string;
  readonly dailyLimitMs: number | null;
  readonly usedMs: number;
  readonly remainingMs: number | null;
  readonly isExhausted: boolean;
  readonly formattedUsed: string;
  readonly formattedLimit: string | null;
  readonly formattedRemaining: string | null;
}

export interface CurrentSiteState {
  readonly tabId: number;
  readonly url?: string;
  readonly hostname?: string;
  readonly isConfigured: boolean;
  readonly collection: {
    readonly id: string;
    readonly name: string;
    readonly color: string;
    readonly icon: string;
  } | null;
  readonly rule: {
    readonly id: string;
    readonly pattern: string;
    readonly type: TargetRuleType;
    readonly isException: boolean;
  } | null;
  readonly decision: {
    readonly action: 'ALLOW' | 'INTERVENE' | 'BLOCK';
    readonly reason: string;
    readonly explanation: string;
    readonly isLimitExhausted?: boolean;
  };
  readonly usage: TabUsageSummary;
  readonly intentPass?: {
    readonly id: string;
    readonly expiresAt: number;
    readonly remainingSeconds: number;
    readonly durationMs: number;
    readonly scope: {
      readonly type: TargetRuleType;
      readonly pattern: string;
    };
  } | null;
  readonly focusSession?: {
    readonly id: string;
    readonly expiresAt: number;
    readonly remainingSeconds: number;
    readonly durationMs: number;
    readonly selectedCollectionIds: readonly string[];
    readonly collectionNames: readonly string[];
  } | null;
}

export interface MomentExportPayload {
  readonly schemaVersion: number;
  readonly exportedAt: number;
  readonly collections: Record<string, Collection>;
  readonly settings: UserSettings;
}

export type MomentMessage =
  | GetStateMessage
  | GetCurrentTabMessage
  | GetInterventionMessage
  | UpdateInterventionStatusMessage
  | CompleteInterventionMessage
  | CancelInterventionMessage
  | GetCapabilitiesMessage
  | ResetAllGrantsTestMessage
  | GetTabUsageMessage
  | GetCollectionUsageMessage
  | GetCurrentSiteStateMessage
  | GetCollectionsMessage
  | CreateCollectionMessage
  | UpdateCollectionMessage
  | DeleteCollectionMessage
  | CreateRuleMessage
  | UpdateRuleMessage
  | DeleteRuleMessage
  | GetSettingsMessage
  | UpdateSettingsMessage
  | ExportDataMessage
  | ImportDataMessage
  | RequestIntentPassMessage
  | GetIntentPassStatusMessage
  | EndIntentPassMessage
  | StartFocusModeMessage
  | GetFocusModeStatusMessage
  | EndFocusModeMessage;

export interface MessageResponse<T = any> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
}

const VALID_TARGET_TYPES = new Set<TargetRuleType>([
  'WEBSITE',
  'EXACT_HOST',
  'PATH_PREFIX',
  'EXACT_PAGE',
  'GLOB',
]);

/**
 * Validates incoming message shapes at runtime to prevent injection of malformed data.
 */
export function isValidMessage(msg: any): msg is MomentMessage {
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
    return false;
  }

  switch (msg.type) {
    case 'GET_STATE':
    case 'GET_CURRENT_TAB':
    case 'GET_CAPABILITIES':
    case 'RESET_ALL_GRANTS_TEST':
    case 'GET_COLLECTIONS':
    case 'GET_SETTINGS':
    case 'EXPORT_DATA':
      return true;

    case 'GET_INTERVENTION':
      return (
        typeof msg.tabId === 'number' &&
        typeof msg.nonce === 'string' &&
        msg.nonce.length > 0
      );

    case 'UPDATE_INTERVENTION_STATUS':
      return (
        typeof msg.tabId === 'number' &&
        typeof msg.nonce === 'string' &&
        msg.nonce.length > 0 &&
        msg.status === 'IN_PROGRESS'
      );

    case 'COMPLETE_INTERVENTION':
      return (
        typeof msg.tabId === 'number' &&
        typeof msg.targetUrl === 'string' &&
        msg.targetUrl.length > 0 &&
        typeof msg.nonce === 'string' &&
        msg.nonce.length > 0 &&
        (msg.intentionText === undefined || typeof msg.intentionText === 'string')
      );

    case 'CANCEL_INTERVENTION':
      return (
        typeof msg.tabId === 'number' &&
        typeof msg.nonce === 'string' &&
        msg.nonce.length > 0
      );

    case 'GET_TAB_USAGE':
    case 'GET_CURRENT_SITE_STATE':
      return msg.tabId === undefined || typeof msg.tabId === 'number';

    case 'GET_COLLECTION_USAGE':
      return typeof msg.collectionId === 'string' && msg.collectionId.length > 0;

    case 'CREATE_COLLECTION':
      return (
        typeof msg.name === 'string' &&
        msg.name.trim().length > 0 &&
        (msg.color === undefined || typeof msg.color === 'string') &&
        (msg.icon === undefined || typeof msg.icon === 'string') &&
        (msg.dailyLimitMs === undefined ||
          msg.dailyLimitMs === null ||
          (typeof msg.dailyLimitMs === 'number' && Number.isFinite(msg.dailyLimitMs))) &&
        (msg.boundary === undefined || typeof msg.boundary === 'object')
      );

    case 'UPDATE_COLLECTION':
      return (
        typeof msg.collectionId === 'string' &&
        msg.collectionId.length > 0 &&
        typeof msg.updates === 'object' &&
        msg.updates !== null
      );

    case 'DELETE_COLLECTION':
      return typeof msg.collectionId === 'string' && msg.collectionId.length > 0;

    case 'CREATE_RULE':
      return (
        typeof msg.collectionId === 'string' &&
        msg.collectionId.length > 0 &&
        typeof msg.pattern === 'string' &&
        msg.pattern.trim().length > 0 &&
        VALID_TARGET_TYPES.has(msg.ruleType) &&
        (msg.isException === undefined || typeof msg.isException === 'boolean')
      );

    case 'UPDATE_RULE':
      return (
        typeof msg.collectionId === 'string' &&
        msg.collectionId.length > 0 &&
        typeof msg.ruleId === 'string' &&
        msg.ruleId.length > 0 &&
        typeof msg.updates === 'object' &&
        msg.updates !== null
      );

    case 'DELETE_RULE':
      return (
        typeof msg.collectionId === 'string' &&
        msg.collectionId.length > 0 &&
        typeof msg.ruleId === 'string' &&
        msg.ruleId.length > 0
      );

    case 'UPDATE_SETTINGS':
      return typeof msg.settings === 'object' && msg.settings !== null;

    case 'IMPORT_DATA':
      return (
        msg.data !== undefined &&
        msg.data !== null &&
        (msg.mode === undefined || msg.mode === 'merge' || msg.mode === 'replace')
      );

    case 'REQUEST_INTENT_PASS':
      return (
        (msg.tabId === undefined || typeof msg.tabId === 'number') &&
        typeof msg.durationMs === 'number' &&
        Number.isFinite(msg.durationMs)
      );

    case 'GET_INTENT_PASS_STATUS':
    case 'END_INTENT_PASS':
      return msg.tabId === undefined || typeof msg.tabId === 'number';

    case 'START_FOCUS_MODE':
      return (
        (msg.durationMs === undefined ||
          (typeof msg.durationMs === 'number' && Number.isFinite(msg.durationMs))) &&
        Array.isArray(msg.collectionIds)
      );

    case 'GET_FOCUS_MODE_STATUS':
    case 'END_FOCUS_MODE':
      return true;

    default:
      return false;
  }
}
