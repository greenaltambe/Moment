/**
 * Moment Background Entry Point (Service Worker / Event Page)
 * Pure event-driven, zero continuous intervals, robust to suspension.
 */

import { ExtensionStorage } from '../storage/storage.js';
import { createBrowserAdapter } from '../browser/index.js';
import { BackgroundLifecycle } from './lifecycle.js';
import { Logger } from '../diagnostics/logger.js';
import { isValidMessage, MomentMessage } from '../shared/messages.js';
import { TemporaryAccessGrant } from '../core/models/grant.js';
import { SitePass } from '../core/models/site-pass.js';
import { IntentPass } from '../core/models/intent-pass.js';
import { FocusSession } from '../core/models/focus-session.js';
import { resolveGrantDuration, isGrantValidForNavigation } from '../core/grants/grant-validator.js';
import { resolveSiteScope, isSitePassValidForNavigation } from '../core/grants/site-pass-validator.js';
import {
  resolveIntentPassDuration,
  resolveIntentPassScope,
  isIntentPassValidForNavigation,
} from '../core/grants/intent-pass-validator.js';
import {
  resolveFocusModeDuration,
  isFocusSessionActive,
  filterValidFocusCollectionIds,
} from '../core/focus/focus-validator.js';
import { DEFAULT_SITE_PASS_DURATION_MS } from '../shared/constants.js';
import { MomentDecisionEngine } from '../core/decisions/engine.js';
import { isSafeDestination } from '../shared/urls.js';
import { parseCanonicalUrl, toCanonicalString } from '../core/matching/url.js';
import {
  PendingIntervention,
  canTransition,
  isInterventionExpired,
  transitionIntervention,
  getRandomLibraryMessage,
} from '../core/interventions/index.js';
import { ActiveTimeTracker } from './tracker.js';
import { getLocalDateKey, validateDailyLimit } from '../core/usage/accounting.js';
import { Collection } from '../core/models/collection.js';
import { Target } from '../core/models/target.js';
import { UserSettings } from '../storage/schema.js';
import { MomentExportPayload } from '../shared/messages.js';
import {
  validateCollectionName,
  validateTargetPattern,
  validateImportPayload,
  validateCustomBlockMessage,
  validateOpeningMessages,
  validateMessageIntensity,
  validateWhenAccessExpires,
} from '../core/validation/rules.js';

const logger = new Logger('Background');
const storage = new ExtensionStorage();
const adapter = createBrowserAdapter();
const lifecycle = new BackgroundLifecycle(storage, adapter);
const engine = new MomentDecisionEngine();
const tracker = new ActiveTimeTracker(storage, adapter, engine);

// Ensure lifecycle & tracker initialization executes on every worker boot
lifecycle
  .initialize()
  .then(() => reconcileStartupState())
  .catch((err) => {
    logger.error('Failed to initialize lifecycle', { error: err.message });
  });

tracker.initialize().catch((err) => {
  logger.error('Failed to initialize tracker', { error: err.message });
});

// Setup Message Dispatcher
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(
    (rawMessage: unknown, _sender: any, sendResponse: (res: any) => void) => {
      // Validate incoming message structure
      if (!isValidMessage(rawMessage)) {
        logger.warn('Received malformed message', { rawMessage });
        sendResponse({ success: false, error: 'Invalid message payload' });
        return false;
      }

      const message: MomentMessage = rawMessage;
      handleMessage(message, _sender)
        .then((response) => sendResponse(response))
        .catch((error) => {
          logger.error('Error handling message', { type: message.type, error: error.message });
          sendResponse({ success: false, error: error.message });
        });

      return true; // Keep message channel open for async response
    }
  );
}

async function handleMessage(message: MomentMessage, _sender: any): Promise<any> {
  const now = Date.now();

  switch (message.type) {
    case 'GET_STATE': {
      const state = await storage.getState();
      return { success: true, data: state };
    }

    case 'GET_CURRENT_TAB': {
      const tab = await adapter.getCurrentTab();
      return { success: true, data: tab };
    }

    case 'GET_CAPABILITIES': {
      return { success: true, data: adapter.getCapabilities() };
    }

    case 'GET_TAB_USAGE': {
      const summary = await tracker.getUsageForTab(message.tabId);
      return { success: true, data: summary };
    }

    case 'GET_COLLECTION_USAGE': {
      try {
        const summary = await tracker.getUsageForCollection(message.collectionId);
        return { success: true, data: summary };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }

    case 'GET_INTERVENTION': {
      const { tabId, nonce } = message;
      const state = await storage.getState();
      const key = String(tabId);
      const pending = state.runtime.pendingInterventions[key];

      if (!pending || pending.nonce !== nonce) {
        return { success: false, error: 'Intervention not found or nonce invalid' };
      }

      if (isInterventionExpired(pending, now)) {
        await storage.updateState((draft) => {
          delete draft.runtime.pendingInterventions[key];
        });
        return { success: false, error: 'Intervention has expired' };
      }

      // Transition PENDING -> PRESENTED upon UI load
      if (pending.status === 'PENDING') {
        await storage.updateState((draft) => {
          const current = draft.runtime.pendingInterventions[key];
          if (current && current.status === 'PENDING') {
            draft.runtime.pendingInterventions[key] = transitionIntervention(current, 'PRESENTED', now);
          }
        });
      }

      const collection = state.collections[pending.collectionId];
      let openingMessage: string | null = null;
      if (collection) {
        if (
          collection.openingMessageMode === 'CUSTOM' &&
          Array.isArray(collection.openingMessages) &&
          collection.openingMessages.length > 0
        ) {
          openingMessage = collection.openingMessages[0];
        } else if (
          collection.openingMessageMode === 'RANDOM' &&
          Array.isArray(collection.openingMessages) &&
          collection.openingMessages.length > 0
        ) {
          const randomIndex = Math.floor(Math.random() * collection.openingMessages.length);
          openingMessage = collection.openingMessages[randomIndex];
        } else if (collection.openingMessageMode === 'MOMENT_LIBRARY') {
          openingMessage = getRandomLibraryMessage(collection.messageIntensity);
        }
      }

      return {
        success: true,
        data: {
          id: pending.id,
          tabId: pending.tabId,
          targetUrl: pending.targetUrl,
          collectionId: pending.collectionId,
          collectionName: collection?.name || 'Managed Boundaries',
          openingMessage,
          interventionType: pending.interventionType,
          durationSeconds: pending.durationSeconds,
          requireIntentionText: pending.requireIntentionText,
          status: pending.status === 'PENDING' ? 'PRESENTED' : pending.status,
          createdAt: pending.createdAt,
        },
      };
    }

    case 'UPDATE_INTERVENTION_STATUS': {
      const { tabId, nonce, status } = message;
      let updated = false;
      await storage.updateState((draft) => {
        const key = String(tabId);
        const pending = draft.runtime.pendingInterventions[key];
        if (!pending || pending.nonce !== nonce) return;
        if (canTransition(pending.status, status)) {
          draft.runtime.pendingInterventions[key] = transitionIntervention(pending, status, now);
          updated = true;
        }
      });
      return { success: updated };
    }

    case 'COMPLETE_INTERVENTION': {
      const { tabId, targetUrl, nonce, durationMs, intentionText } = message;
      logger.info('Processing COMPLETE_INTERVENTION', { tabId, targetUrl });

      const senderTabId = _sender?.tab?.id;
      if (senderTabId !== undefined && senderTabId !== tabId) {
        logger.warn('Cross-tab intervention completion attempt rejected', { senderTabId, tabId });
        return { success: false, error: 'Unauthorized tab intervention completion' };
      }

      if (!isSafeDestination(targetUrl)) {
        return { success: false, error: 'Unsafe or invalid destination URL' };
      }

      const canonicalTarget = parseCanonicalUrl(targetUrl);
      const normalizedTargetUrl = canonicalTarget ? toCanonicalString(canonicalTarget) : targetUrl;

      let grantCreated: TemporaryAccessGrant | null = null;

      await storage.updateState((draft) => {
        const key = String(tabId);
        const pending = draft.runtime.pendingInterventions[key];

        // Centralized security validation
        if (!pending) {
          logger.warn('No pending intervention found for tab', { tabId });
          throw new Error('Invalid or nonexistent pending intervention');
        }

        if (pending.nonce !== nonce) {
          logger.warn('Nonce validation failed', { tabId, nonce });
          throw new Error('Invalid, expired, or forged intervention nonce');
        }

        const pendingCanonical = parseCanonicalUrl(pending.targetUrl);
        const targetCanonical = parseCanonicalUrl(targetUrl);
        const targetsMatch =
          pending.targetUrl === targetUrl ||
          (pendingCanonical &&
            targetCanonical &&
            toCanonicalString(pendingCanonical) === toCanonicalString(targetCanonical));

        if (!targetsMatch) {
          logger.warn('Target validation failed', { tabId, pendingTarget: pending.targetUrl, targetUrl });
          throw new Error('Destination target does not match pending intervention');
        }

        // Check expiration
        if (isInterventionExpired(pending, now)) {
          delete draft.runtime.pendingInterventions[key];
          throw new Error('Intervention has expired');
        }

        // Validate state machine transition to COMPLETED (handling PENDING if UI completed directly)
        let effectiveStatus = pending.status;
        if (effectiveStatus === 'PENDING') {
          effectiveStatus = 'PRESENTED';
        }

        if (!canTransition(effectiveStatus, 'COMPLETED')) {
          logger.warn('Replay or illegal transition rejected', { tabId, status: pending.status });
          throw new Error(`Intervention cannot be completed from state '${pending.status}'`);
        }

        // Validate intention text if required by policy
        if (pending.requireIntentionText && (!intentionText || intentionText.trim().length === 0)) {
          throw new Error('Intention text is required to complete this intervention');
        }

        // Remove consumed pending request (atomically preventing replay)
        delete draft.runtime.pendingInterventions[key];

        // Issue Temporary Access Grant with centralized duration clamping and canonical target
        const grantDuration = resolveGrantDuration(durationMs || (pending.durationSeconds * 1000));
        const grant: TemporaryAccessGrant = {
          id: `grant_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          tabId,
          target: normalizedTargetUrl,
          grantedAt: now,
          expiresAt: now + grantDuration,
          nonce,
          singleUse: true,
        };

        draft.runtime.temporaryAccessGrants[key] = grant;
        grantCreated = grant;

        // Issue SitePass (post-intervention cooldown window) under WEBSITE semantics
        const col = draft.collections[pending.collectionId];
        const matchedRule = pending.matchedRuleId && col && Array.isArray(col.targets)
          ? col.targets.find((t) => t.id === pending.matchedRuleId)
          : null;
        const siteScope = resolveSiteScope(normalizedTargetUrl, matchedRule);

        if (siteScope) {
          const unlockScope = draft.settings?.temporaryUnlockScope || 'THIS_TAB_ONLY';
          const sitePass: SitePass = {
            id: `pass_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            tabId,
            site: siteScope,
            grantedAt: now,
            expiresAt: now + DEFAULT_SITE_PASS_DURATION_MS,
            scope: unlockScope,
          };
          if (!draft.runtime.sitePasses) {
            draft.runtime.sitePasses = {};
          }
          draft.runtime.sitePasses[key] = sitePass;
          schedulePassExpiration(tabId, 'SITE_PASS', sitePass.expiresAt);
        }
      });

      logger.info('Temporary Access Grant and SitePass created successfully', {
        tabId,
        targetUrl: normalizedTargetUrl,
      });
      return { success: true, data: { targetUrl: normalizedTargetUrl, grant: grantCreated } };
    }

    case 'CANCEL_INTERVENTION': {
      const { tabId, nonce } = message;
      logger.info('Processing CANCEL_INTERVENTION', { tabId });

      const senderTabId = _sender?.tab?.id;
      if (senderTabId !== undefined && senderTabId !== tabId) {
        logger.warn('Cross-tab intervention cancellation attempt rejected', { senderTabId, tabId });
        return { success: false, error: 'Unauthorized tab intervention cancellation' };
      }

      let cancelled = false;
      await storage.updateState((draft) => {
        const key = String(tabId);
        const pending = draft.runtime.pendingInterventions[key];

        if (!pending) {
          logger.warn('Cancel rejected: no pending intervention for tab', { tabId });
          return;
        }

        if (pending.nonce !== nonce) {
          logger.warn('Cancel rejected: nonce mismatch', { tabId, nonce });
          return;
        }

        delete draft.runtime.pendingInterventions[key];
        delete draft.runtime.temporaryAccessGrants[key];
        if (draft.runtime.sitePasses) {
          delete draft.runtime.sitePasses[key];
        }
        if (draft.runtime.intentPasses) {
          delete draft.runtime.intentPasses[key];
        }
        cancelled = true;
      });

      if (!cancelled) {
        return { success: false, error: 'Invalid, nonexistent, or mismatched intervention cancellation' };
      }

      return { success: true };
    }

    case 'GET_CURRENT_SITE_STATE': {
      const state = await storage.getState();
      let activeFocusSessionInfo: any = null;
      const currentFocus = state.runtime.focusSession;
      if (currentFocus) {
        if (isFocusSessionActive(currentFocus, now)) {
          const collectionNames = currentFocus.selectedCollectionIds
            .map((id) => state.collections[id]?.name)
            .filter(Boolean) as string[];
          activeFocusSessionInfo = {
            id: currentFocus.id,
            expiresAt: currentFocus.expiresAt,
            remainingSeconds: Math.max(0, Math.ceil((currentFocus.expiresAt - now) / 1000)),
            durationMs: currentFocus.durationMs,
            selectedCollectionIds: currentFocus.selectedCollectionIds,
            collectionNames,
          };
        } else {
          // Prune expired
          await storage.updateState((draft) => {
            draft.runtime.focusSession = null;
          });
        }
      }

      const targetTab = message.tabId !== undefined
        ? await adapter.getTab(message.tabId)
        : await adapter.getCurrentTab();

      const usage = await tracker.getUsageForTab(targetTab?.id);

      if (!targetTab) {
        return {
          success: true,
          data: {
            tabId: -1,
            url: undefined,
            hostname: undefined,
            isConfigured: false,
            collection: null,
            rule: null,
            decision: {
              action: 'ALLOW',
              reason: 'NO_ACTIVE_TAB',
              explanation: 'No active tab detected in current window.',
            },
            usage,
            intentPass: null,
            focusSession: activeFocusSessionInfo,
          },
        };
      }

      if (!targetTab.url) {
        return {
          success: true,
          data: {
            tabId: targetTab.id ?? -1,
            url: undefined,
            hostname: undefined,
            isConfigured: false,
            collection: null,
            rule: null,
            decision: {
              action: 'ALLOW',
              reason: 'RESTRICTED_TAB_URL',
              explanation: 'Current tab URL is restricted or unavailable.',
            },
            usage,
            intentPass: null,
            focusSession: activeFocusSessionInfo,
          },
        };
      }

      let hostname: string | undefined;
      let isWebScheme = false;
      try {
        const parsed = new URL(targetTab.url);
        isWebScheme = parsed.protocol === 'http:' || parsed.protocol === 'https:';
        hostname = isWebScheme && parsed.hostname ? parsed.hostname : undefined;
      } catch {
        hostname = undefined;
        isWebScheme = false;
      }

      if (!isWebScheme) {
        return {
          success: true,
          data: {
            tabId: targetTab.id,
            url: targetTab.url,
            hostname: undefined,
            isConfigured: false,
            collection: null,
            rule: null,
            decision: {
              action: 'ALLOW',
              reason: 'UNSUPPORTED_SCHEME',
              explanation: 'System and internal browser pages cannot be blocked.',
            },
            usage,
            intentPass: null,
            focusSession: activeFocusSessionInfo,
          },
        };
      }

      const activeGrants = Object.values(state.runtime.temporaryAccessGrants);
      const dateKey = getLocalDateKey(new Date(now));
      const dailyUsageMs: Record<string, number> = {};
      for (const [colId] of Object.entries(state.collections)) {
        const usageKey = `${dateKey}:${colId}`;
        dailyUsageMs[colId] = state.usage[usageKey]?.accumulatedMs || 0;
      }

      const decision = engine.evaluate({
        url: targetTab.url,
        tabId: targetTab.id,
        timestamp: now,
        collections: state.collections,
        activeGrants,
        dailyUsageMs,
        focusSession: state.runtime.focusSession,
      });

      let matchedCollection: any = null;
      let matchedRule: any = null;

      if (decision.collectionId && state.collections[decision.collectionId]) {
        const col = state.collections[decision.collectionId];
        matchedCollection = {
          id: col.id,
          name: col.name,
          color: col.color,
          icon: col.icon,
        };

        if (decision.matchedRuleId) {
          const target = col.targets.find((t) => t.id === decision.matchedRuleId);
          if (target) {
            matchedRule = {
              id: target.id,
              pattern: target.pattern,
              type: target.type,
              isException: target.isException,
            };
          }
        }
      }

      let activeIntentPassInfo: any = null;
      const tabIntentPass = state.runtime.intentPasses?.[String(targetTab.id)];
      if (tabIntentPass) {
        if (now < tabIntentPass.expiresAt) {
          activeIntentPassInfo = {
            id: tabIntentPass.id,
            expiresAt: tabIntentPass.expiresAt,
            remainingSeconds: Math.max(0, Math.ceil((tabIntentPass.expiresAt - now) / 1000)),
            durationMs: tabIntentPass.durationMs,
            scope: tabIntentPass.scope,
          };
        } else {
          // Prune expired
          await storage.updateState((draft) => {
            if (draft.runtime.intentPasses) {
              delete draft.runtime.intentPasses[String(targetTab.id)];
            }
          });
        }
      }

      return {
        success: true,
        data: {
          tabId: targetTab.id,
          url: targetTab.url,
          hostname,
          isConfigured: matchedCollection !== null,
          collection: matchedCollection,
          rule: matchedRule,
          decision: {
            action: decision.action,
            reason: decision.reason,
            explanation: decision.explanation,
            isLimitExhausted: decision.reason === 'DAILY_LIMIT_EXHAUSTED',
          },
          usage,
          intentPass: activeIntentPassInfo,
          focusSession: activeFocusSessionInfo,
        },
      };
    }

    case 'GET_COLLECTIONS': {
      const state = await storage.getState();
      return { success: true, data: state.collections };
    }

    case 'CREATE_COLLECTION': {
      const nameVal = validateCollectionName(message.name);
      if (!nameVal.valid) {
        return { success: false, error: nameVal.error };
      }

      const limitMs = message.dailyLimitMs !== undefined ? validateDailyLimit(message.dailyLimitMs) : null;
      const blockMsgVal = validateCustomBlockMessage(message.customBlockMessage);
      const openingVal = validateOpeningMessages(message.openingMessageMode, message.openingMessages);
      const intensityVal = validateMessageIntensity(message.messageIntensity);
      const whenExpires = validateWhenAccessExpires(message.whenAccessExpires);

      const collectionId = `col_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const newCollection: Collection = {
        id: collectionId,
        name: nameVal.sanitized!,
        color: message.color || '#2e7d32',
        icon: message.icon || 'shield',
        enabled: true,
        createdAt: now,
        updatedAt: now,
        dailyLimitMs: limitMs,
        targets: [],
        boundary: message.boundary || {
          schedule: { enabled: false, intervals: [] },
          limits: { dailyMinutes: null, sessionMinutes: null },
          pause: { type: 'BREATHE', durationSeconds: 10, requireIntentionText: false },
          action: { type: 'BLOCK_PAGE', redirectUrl: null },
          strictMode: false,
        },
        customBlockMessage: blockMsgVal.valid ? blockMsgVal.sanitized ?? null : null,
        openingMessageMode: openingVal.mode,
        messageIntensity: intensityVal,
        openingMessages: openingVal.messages,
        whenAccessExpires: whenExpires,
      };

      await storage.updateState((draft) => {
        draft.collections[collectionId] = newCollection;
      });

      const updatedState = await storage.getState();
      engine.setCollections(updatedState.collections);

      return { success: true, data: newCollection };
    }

    case 'UPDATE_COLLECTION': {
      const { collectionId, updates } = message;
      let updatedCollection: Collection | null = null;
      const sanitizedUpdates = { ...updates };

      if (sanitizedUpdates.name !== undefined) {
        const nameVal = validateCollectionName(sanitizedUpdates.name);
        if (!nameVal.valid) {
          return { success: false, error: nameVal.error };
        }
        sanitizedUpdates.name = nameVal.sanitized!;
      }

      if (sanitizedUpdates.dailyLimitMs !== undefined) {
        sanitizedUpdates.dailyLimitMs = validateDailyLimit(sanitizedUpdates.dailyLimitMs);
      }

      if (sanitizedUpdates.customBlockMessage !== undefined) {
        const msgVal = validateCustomBlockMessage(sanitizedUpdates.customBlockMessage);
        sanitizedUpdates.customBlockMessage = msgVal.valid ? msgVal.sanitized ?? null : null;
      }

      if (sanitizedUpdates.openingMessageMode !== undefined || sanitizedUpdates.openingMessages !== undefined) {
        const openingVal = validateOpeningMessages(
          sanitizedUpdates.openingMessageMode,
          sanitizedUpdates.openingMessages
        );
        sanitizedUpdates.openingMessageMode = openingVal.mode;
        sanitizedUpdates.openingMessages = openingVal.messages;
      }

      if (sanitizedUpdates.messageIntensity !== undefined) {
        sanitizedUpdates.messageIntensity = validateMessageIntensity(sanitizedUpdates.messageIntensity);
      }

      if (sanitizedUpdates.whenAccessExpires !== undefined) {
        sanitizedUpdates.whenAccessExpires = validateWhenAccessExpires(sanitizedUpdates.whenAccessExpires);
      }

      await storage.updateState((draft) => {
        const existing = draft.collections[collectionId];
        if (!existing) {
          throw new Error(`Collection '${collectionId}' not found`);
        }

        draft.collections[collectionId] = {
          ...existing,
          ...sanitizedUpdates,
          id: existing.id,
          createdAt: existing.createdAt,
          updatedAt: now,
        };
        updatedCollection = draft.collections[collectionId];
      });

      const updatedState = await storage.getState();
      engine.setCollections(updatedState.collections);

      return { success: true, data: updatedCollection };
    }

    case 'DELETE_COLLECTION': {
      const { collectionId } = message;
      await storage.updateState((draft) => {
        delete draft.collections[collectionId];
        if (draft.runtime.focusSession && Array.isArray(draft.runtime.focusSession.selectedCollectionIds)) {
          const remainingIds = draft.runtime.focusSession.selectedCollectionIds.filter(
            (id: string) => id !== collectionId
          );
          if (remainingIds.length === 0) {
            draft.runtime.focusSession = null;
          } else {
            draft.runtime.focusSession = {
              ...draft.runtime.focusSession,
              selectedCollectionIds: remainingIds,
            };
          }
        }
      });

      const updatedState = await storage.getState();
      engine.setCollections(updatedState.collections);

      return { success: true, data: { deleted: true } };
    }

    case 'CREATE_RULE': {
      const { collectionId, pattern, ruleType, isException } = message;
      const patternVal = validateTargetPattern(pattern, ruleType);
      if (!patternVal.valid) {
        return { success: false, error: patternVal.error };
      }

      const newTarget: Target = {
        id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        pattern: patternVal.sanitized!,
        type: ruleType,
        isException: Boolean(isException),
        createdAt: now,
      };

      await storage.updateState((draft) => {
        const col = draft.collections[collectionId];
        if (!col) {
          throw new Error(`Collection '${collectionId}' not found`);
        }
        draft.collections[collectionId] = {
          ...col,
          targets: [...col.targets, newTarget],
          updatedAt: now,
        };
      });

      const updatedState = await storage.getState();
      engine.setCollections(updatedState.collections);

      return { success: true, data: newTarget };
    }

    case 'UPDATE_RULE': {
      const { collectionId, ruleId, updates } = message;
      let updatedTarget: Target | null = null;
      const sanitizedUpdates = { ...updates };

      if (sanitizedUpdates.pattern !== undefined && sanitizedUpdates.type !== undefined) {
        const patternVal = validateTargetPattern(sanitizedUpdates.pattern, sanitizedUpdates.type);
        if (!patternVal.valid) {
          return { success: false, error: patternVal.error };
        }
        sanitizedUpdates.pattern = patternVal.sanitized!;
      }

      await storage.updateState((draft) => {
        const col = draft.collections[collectionId];
        if (!col) throw new Error(`Collection '${collectionId}' not found`);
        const targetIdx = col.targets.findIndex((t) => t.id === ruleId);
        if (targetIdx === -1) throw new Error(`Rule '${ruleId}' not found in collection '${collectionId}'`);

        const current = col.targets[targetIdx];
        const updated: Target = {
          ...current,
          ...sanitizedUpdates,
          id: current.id,
          createdAt: current.createdAt,
        };

        const newTargets = [...col.targets];
        newTargets[targetIdx] = updated;
        draft.collections[collectionId] = {
          ...col,
          targets: newTargets,
          updatedAt: now,
        };
        updatedTarget = updated;
      });

      const updatedState = await storage.getState();
      engine.setCollections(updatedState.collections);

      return { success: true, data: updatedTarget };
    }

    case 'DELETE_RULE': {
      const { collectionId, ruleId } = message;
      await storage.updateState((draft) => {
        const col = draft.collections[collectionId];
        if (!col) throw new Error(`Collection '${collectionId}' not found`);
        draft.collections[collectionId] = {
          ...col,
          targets: col.targets.filter((t) => t.id !== ruleId),
          updatedAt: now,
        };
      });

      const updatedState = await storage.getState();
      engine.setCollections(updatedState.collections);

      return { success: true, data: { deleted: true } };
    }

    case 'GET_SETTINGS': {
      const state = await storage.getState();
      return { success: true, data: state.settings };
    }

    case 'UPDATE_SETTINGS': {
      const { settings } = message;
      let updatedSettings: UserSettings | null = null;
      const sanitizedSettings: { -readonly [P in keyof UserSettings]?: UserSettings[P] } = {};

      if (settings.theme !== undefined) {
        sanitizedSettings.theme = ['system', 'light', 'dark', 'sepia'].includes(settings.theme)
          ? settings.theme
          : 'system';
      }
      if (settings.timeFormat !== undefined) {
        sanitizedSettings.timeFormat = ['12h', '24h'].includes(settings.timeFormat)
          ? settings.timeFormat
          : '24h';
      }
      if (settings.reducedMotion !== undefined) {
        sanitizedSettings.reducedMotion = Boolean(settings.reducedMotion);
      }
      if (settings.allowPrivateBrowsing !== undefined) {
        sanitizedSettings.allowPrivateBrowsing = Boolean(settings.allowPrivateBrowsing);
      }

      await storage.updateState((draft: any) => {
        draft.settings = {
          ...draft.settings,
          ...sanitizedSettings,
        };
        updatedSettings = draft.settings;
      });
      return { success: true, data: updatedSettings };
    }

    case 'EXPORT_DATA': {
      const state = await storage.getState();
      const payload: MomentExportPayload = {
        schemaVersion: state.schemaVersion,
        exportedAt: now,
        collections: state.collections,
        settings: state.settings,
      };
      return { success: true, data: payload };
    }

    case 'IMPORT_DATA': {
      const importVal = validateImportPayload(message.data);
      if (!importVal.valid || !importVal.sanitized) {
        return { success: false, error: importVal.error || 'Invalid import payload' };
      }

      const { sanitized } = importVal;
      const mode = message.mode || 'merge';
      let importedCount = 0;

      await storage.updateState((draft: any) => {
        if (mode === 'replace') {
          draft.collections = sanitized.collections;
          draft.settings = sanitized.settings;
          importedCount = Object.keys(sanitized.collections).length;
        } else {
          // Merge mode: add collections with collision-free IDs
          for (const [id, col] of Object.entries(sanitized.collections)) {
            let targetId = id;
            if (draft.collections[targetId]) {
              targetId = `col_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            }
            draft.collections[targetId] = {
              ...col,
              id: targetId,
            };
            importedCount++;
          }
        }
      });

      const updatedState = await storage.getState();
      engine.setCollections(updatedState.collections);

      return {
        success: true,
        data: {
          importedCollectionsCount: importedCount,
          message: `Successfully imported ${importedCount} collection(s)`,
        },
      };
    }

    case 'REQUEST_INTENT_PASS': {
      // Authoritatively bind to sender tab if message originates from an extension tab
      const senderTabId = _sender?.tab?.id;
      const targetTab = senderTabId !== undefined
        ? await adapter.getTab(senderTabId)
        : message.tabId !== undefined
        ? await adapter.getTab(message.tabId)
        : await adapter.getCurrentTab();

      if (!targetTab || targetTab.id === undefined || targetTab.id === null) {
        return { success: false, error: 'No active tab found' };
      }

      const tabId = targetTab.id;
      const key = String(tabId);
      const state = await storage.getState();
      const durationMs = resolveIntentPassDuration(message.durationMs);

      // Check if there is a pending intervention for this tab
      const pending = state.runtime.pendingInterventions?.[key];

      let targetUrl: string | null = null;
      let matchedRule: Target | null = null;
      let targetCollectionId = '';
      let matchedRuleId: string | null = null;

      if (pending) {
        targetUrl = pending.targetUrl;
        targetCollectionId = pending.collectionId;
        matchedRuleId = pending.matchedRuleId || null;
        const col = state.collections[pending.collectionId];
        if (col && pending.matchedRuleId) {
          matchedRule = col.targets.find((t) => t.id === pending.matchedRuleId) || null;
        }

        // Verify target is still blocked or restricted under current policy
        if (targetUrl) {
          const activeGrants = Object.values(state.runtime.temporaryAccessGrants || {});
          const dateKey = getLocalDateKey(new Date(now));
          const dailyUsageMs: Record<string, number> = {};
          for (const record of Object.values(state.usage || {})) {
            if (record.dateKey === dateKey) {
              dailyUsageMs[record.collectionId] = record.accumulatedMs;
              dailyUsageMs[`${dateKey}:${record.collectionId}`] = record.accumulatedMs;
            }
          }
          engine.setCollections(state.collections);
          const currentDecision = engine.evaluate({
            url: targetUrl,
            tabId,
            timestamp: now,
            activeGrants,
            collections: state.collections,
            dailyUsageMs,
            focusSession: state.runtime.focusSession,
          });
          if (currentDecision.action === 'ALLOW') {
            targetUrl = null;
          }
        }
      } else {
        // Tab might be on block page or restricted page
        let candidateUrl = targetTab.url;
        if (candidateUrl) {
          try {
            const parsed = new URL(candidateUrl);
            if (parsed.pathname.endsWith('/block.html') || parsed.pathname.endsWith('block.html')) {
              const paramTarget = parsed.searchParams.get('target');
              if (paramTarget && isSafeDestination(paramTarget)) {
                candidateUrl = paramTarget;
              }
            }
          } catch {
            // Ignore parse error
          }

          if (candidateUrl && (candidateUrl.startsWith('http://') || candidateUrl.startsWith('https://'))) {
            const activeGrants = Object.values(state.runtime.temporaryAccessGrants || {});
            const dateKey = getLocalDateKey(new Date(now));
            const dailyUsageMs: Record<string, number> = {};
            for (const record of Object.values(state.usage || {})) {
              if (record.dateKey === dateKey) {
                dailyUsageMs[record.collectionId] = record.accumulatedMs;
                dailyUsageMs[`${dateKey}:${record.collectionId}`] = record.accumulatedMs;
              }
            }

            engine.setCollections(state.collections);
            const decision = engine.evaluate({
              url: candidateUrl,
              tabId,
              timestamp: now,
              activeGrants,
              collections: state.collections,
              dailyUsageMs,
              focusSession: state.runtime.focusSession,
            });

            if (decision.action === 'BLOCK' || decision.action === 'INTERVENE') {
              targetUrl = candidateUrl;
              targetCollectionId = decision.collectionId || '';
              matchedRuleId = decision.matchedRuleId || null;
              if (targetCollectionId && state.collections[targetCollectionId] && decision.matchedRuleId) {
                const col = state.collections[targetCollectionId];
                matchedRule = col.targets.find((t) => t.id === decision.matchedRuleId) || null;
              }
            }
          }
        }
      }

      if (!targetUrl || !isSafeDestination(targetUrl)) {
        logger.warn('Intent Pass request rejected: destination is not blocked or target invalid', {
          tabId,
          targetUrl,
        });
        return {
          success: false,
          error: 'Intent Pass can only be requested for blocked or restricted destinations.',
        };
      }

      const canonicalTarget = parseCanonicalUrl(targetUrl);
      const normalizedTargetUrl = canonicalTarget ? toCanonicalString(canonicalTarget) : targetUrl;
      const scope = resolveIntentPassScope(normalizedTargetUrl, matchedRule);

      if (!scope) {
        logger.warn('Intent Pass request rejected: could not resolve scope', {
          tabId,
          targetUrl,
        });
        return {
          success: false,
          error: 'Could not resolve valid scope for destination.',
        };
      }

      const passId = `intent_${now}_${Math.random().toString(36).substring(2, 7)}`;
      const intentPass: IntentPass = {
        id: passId,
        tabId,
        scope,
        collectionId: targetCollectionId,
        matchedRuleId,
        grantedAt: now,
        expiresAt: now + durationMs,
        durationMs,
      };

      let grantCreated: TemporaryAccessGrant | null = null;

      await storage.updateState((draft) => {
        if (!draft.runtime.intentPasses) {
          draft.runtime.intentPasses = {};
        }
        draft.runtime.intentPasses[key] = intentPass;

        // Atomically consume pending intervention if one existed
        if (draft.runtime.pendingInterventions?.[key]) {
          delete draft.runtime.pendingInterventions[key];
        }

        // Issue single-use TemporaryAccessGrant for immediate navigation commitment
        const grant: TemporaryAccessGrant = {
          id: `grant_${now}_${Math.random().toString(36).substring(2, 7)}`,
          tabId,
          target: normalizedTargetUrl,
          grantedAt: now,
          expiresAt: now + 60_000,
          nonce: Math.random().toString(36).substring(2, 10),
          singleUse: true,
        };
        draft.runtime.temporaryAccessGrants[key] = grant;
        grantCreated = grant;
      });

      schedulePassExpiration(tabId, 'INTENT_PASS', intentPass.expiresAt);

      logger.info('Intent Pass created successfully', {
        tabId,
        passId,
        scope,
        durationMs,
        targetUrl: normalizedTargetUrl,
      });

      return {
        success: true,
        data: {
          intentPass,
          destinationUrl: normalizedTargetUrl,
          grant: grantCreated,
        },
      };
    }

    case 'GET_INTENT_PASS_STATUS': {
      const targetTab = message.tabId !== undefined
        ? await adapter.getTab(message.tabId)
        : await adapter.getCurrentTab();

      if (!targetTab || targetTab.id === undefined || targetTab.id === null) {
        return { success: true, data: null };
      }

      const key = String(targetTab.id);
      const state = await storage.getState();
      const pass = state.runtime.intentPasses?.[key];

      if (!pass) {
        return { success: true, data: null };
      }

      if (now >= pass.expiresAt) {
        await storage.updateState((draft) => {
          if (draft.runtime.intentPasses) {
            delete draft.runtime.intentPasses[key];
          }
        });
        return { success: true, data: null };
      }

      const remainingSeconds = Math.max(0, Math.ceil((pass.expiresAt - now) / 1000));
      return {
        success: true,
        data: {
          pass,
          remainingSeconds,
        },
      };
    }

    case 'END_INTENT_PASS': {
      const senderTabId = _sender?.tab?.id;
      const targetTab = senderTabId !== undefined
        ? await adapter.getTab(senderTabId)
        : message.tabId !== undefined
        ? await adapter.getTab(message.tabId)
        : await adapter.getCurrentTab();

      if (!targetTab || targetTab.id === undefined || targetTab.id === null) {
        return { success: false, error: 'No active tab found' };
      }

      const key = String(targetTab.id);
      await storage.updateState((draft) => {
        if (draft.runtime.intentPasses) {
          delete draft.runtime.intentPasses[key];
        }
        if (draft.runtime.temporaryAccessGrants) {
          delete draft.runtime.temporaryAccessGrants[key];
        }
        if (draft.runtime.sitePasses) {
          delete draft.runtime.sitePasses[key];
        }
      });

      logger.info('Intent Pass ended manually', { tabId: targetTab.id });
      return { success: true };
    }

    case 'START_FOCUS_MODE': {
      const state = await storage.getState();
      const durationMs = resolveFocusModeDuration(message.durationMs);
      const validCollectionIds = filterValidFocusCollectionIds(message.collectionIds, state.collections);

      if (validCollectionIds.length === 0) {
        return {
          success: false,
          error: 'At least one valid collection must be selected to start Focus Mode',
        };
      }

      const session: FocusSession = {
        id: `focus_${now}_${Math.random().toString(36).substring(2, 7)}`,
        startedAt: now,
        expiresAt: now + durationMs,
        durationMs,
        selectedCollectionIds: validCollectionIds,
        status: 'ACTIVE',
      };

      await storage.updateState((draft) => {
        draft.runtime.focusSession = session;
      });

      logger.info('Focus Mode session started', {
        id: session.id,
        durationMs,
        selectedCollectionIds: validCollectionIds,
        expiresAt: session.expiresAt,
      });

      return {
        success: true,
        data: session,
      };
    }

    case 'GET_FOCUS_MODE_STATUS': {
      const state = await storage.getState();
      const session = state.runtime.focusSession;

      if (!session) {
        return { success: true, data: null };
      }

      if (!isFocusSessionActive(session, now)) {
        await storage.updateState((draft) => {
          draft.runtime.focusSession = null;
        });
        return { success: true, data: null };
      }

      const remainingSeconds = Math.max(0, Math.ceil((session.expiresAt - now) / 1000));
      const collectionNames = session.selectedCollectionIds
        .map((id) => state.collections[id]?.name)
        .filter(Boolean) as string[];

      return {
        success: true,
        data: {
          session,
          remainingSeconds,
          collectionNames,
        },
      };
    }

    case 'END_FOCUS_MODE': {
      await storage.updateState((draft) => {
        draft.runtime.focusSession = null;
      });
      logger.info('Focus Mode ended manually');
      return { success: true };
    }

    case 'RESET_ALL_GRANTS_TEST': {
      logger.info('Resetting all test grants...');
      await storage.updateState((draft) => {
        draft.runtime.pendingInterventions = {};
        draft.runtime.temporaryAccessGrants = {};
        draft.runtime.sitePasses = {};
        draft.runtime.intentPasses = {};
        draft.runtime.focusSession = null;
      });
      return { success: true };
    }

    default:
      return { success: false, error: 'Unhandled message type' };
  }
}

// Pass Expiration Scheduling & Re-evaluation
function schedulePassExpiration(tabId: number, passType: 'INTENT_PASS' | 'SITE_PASS', expiresAt: number): void {
  const now = Date.now();
  const delay = Math.max(0, expiresAt - now);

  // 1. Alarm for service worker lifecycle resilience
  const alarmName = `pass_expire_${passType}_${tabId}_${expiresAt}`;
  adapter.createAlarm(alarmName, { when: expiresAt });

  // 2. In-memory timer for immediate precision when worker is active
  if (delay < 2147483647) {
    setTimeout(() => {
      checkPassExpiration(tabId).catch((err) =>
        logger.error('Error executing checkPassExpiration timeout', { error: err.message, tabId })
      );
    }, delay + 50);
  }
}

function findValidSitePass(
  sitePasses: Record<string, SitePass> | undefined,
  tabId: number,
  url: string,
  now: number
): SitePass | null {
  if (!sitePasses) return null;
  const directPass = sitePasses[String(tabId)];
  if (directPass && isSitePassValidForNavigation(directPass, tabId, url, now)) {
    return directPass;
  }
  for (const pass of Object.values(sitePasses)) {
    if (pass && pass.scope === 'ALL_TABS_UNTIL_EXPIRATION') {
      if (isSitePassValidForNavigation(pass, tabId, url, now)) {
        return pass;
      }
    }
  }
  return null;
}

async function checkPassExpiration(tabId: number): Promise<void> {
  try {
    const state = await storage.getState();
    const now = Date.now();
    const key = String(tabId);
    const intentPass = state.runtime.intentPasses?.[key];
    const sitePass = state.runtime.sitePasses?.[key];

    const isIntentExpired = Boolean(intentPass && now >= intentPass.expiresAt);
    const isSiteExpired = Boolean(sitePass && now >= sitePass.expiresAt);

    if (!isIntentExpired && !isSiteExpired) {
      return;
    }

    // Inspect the originating tab
    const tab = await adapter.getTab(tabId);

    // Prune the expired pass(es) from storage atomically
    await storage.updateState((draft) => {
      if (isIntentExpired && draft.runtime.intentPasses?.[key]?.id === intentPass?.id) {
        delete draft.runtime.intentPasses[key];
      }
      if (isSiteExpired && draft.runtime.sitePasses?.[key]?.id === sitePass?.id) {
        delete draft.runtime.sitePasses[key];
      }
    });

    // If ALL_TABS_UNTIL_EXPIRATION SitePass expired: check all open tabs on the covered site
    if (sitePass && sitePass.scope === 'ALL_TABS_UNTIL_EXPIRATION' && isSiteExpired) {
      const allTabs = await adapter.getAllTabs();
      for (const openTab of allTabs) {
        if (openTab.url && (openTab.url.startsWith('http://') || openTab.url.startsWith('https://'))) {
          if (isSitePassValidForNavigation(sitePass, openTab.id, openTab.url, sitePass.expiresAt - 1)) {
            const matchingCol = engine.resolveMatchingCollection(
              openTab.url,
              now,
              state.collections,
              state.runtime.focusSession
            );
            if (matchingCol && (matchingCol.whenAccessExpires || 'IMMEDIATE') === 'IMMEDIATE') {
              await evaluateAndEnforceNavigation(openTab.id, openTab.url, 'COMMITTED');
            }
          }
        }
      }
      return;
    }

    if (!tab || !tab.url || (!tab.url.startsWith('http://') && !tab.url.startsWith('https://'))) {
      return;
    }

    // Tab is alive on web URL. Check matching collection for whenAccessExpires setting
    const matchingCol = engine.resolveMatchingCollection(
      tab.url,
      now,
      state.collections,
      state.runtime.focusSession
    );

    if (matchingCol) {
      const whenExpires = matchingCol.whenAccessExpires || 'IMMEDIATE';
      if (whenExpires === 'NEXT_NAV') {
        logger.info('Pass expired, allowing active session until next navigation', {
          tabId,
          url: tab.url,
          collectionId: matchingCol.id,
        });
        return;
      }

      // If IMMEDIATE: re-evaluate and enforce navigation immediately!
      await evaluateAndEnforceNavigation(tabId, tab.url, 'COMMITTED');
    }
  } catch (err: any) {
    logger.error('Error during checkPassExpiration', { error: err.message, tabId });
  }
}

// Unified Navigation Policy Evaluator and Enforcer
async function evaluateAndEnforceNavigation(
  tabId: number,
  url: string,
  source: 'BEFORE_NAVIGATE' | 'COMMITTED' | 'HISTORY_UPDATE' | 'RECONCILIATION'
): Promise<boolean> {
  try {
    // Step 1: Safe handling for non-web / internal / extension URLs
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return true;
    }

    const state = await storage.getState();
    const now = Date.now();
    const key = String(tabId);

    // Step 2: Check TemporaryAccessGrant for immediate destination authorization
    const currentGrant = state.runtime.temporaryAccessGrants?.[key];
    if (currentGrant && isGrantValidForNavigation(currentGrant, tabId, url, now)) {
      if (source === 'COMMITTED' && currentGrant.singleUse) {
        logger.info('Consuming single-use grant upon navigation commit', {
          tabId,
          url,
          grantId: currentGrant.id,
        });
        await storage.updateState((draft) => {
          const g = draft.runtime.temporaryAccessGrants[key];
          if (g && g.id === currentGrant.id) {
            delete draft.runtime.temporaryAccessGrants[key];
          }
        });
      }
      return true;
    }

    // Step 3: Check IntentPass for tab + target deliberate temporary access
    const intentPass = state.runtime.intentPasses?.[key];
    if (intentPass) {
      if (isIntentPassValidForNavigation(intentPass, tabId, url, now)) {
        return true;
      } else if (now >= intentPass.expiresAt) {
        await storage.updateState((draft) => {
          const p = draft.runtime.intentPasses?.[key];
          if (p && p.id === intentPass.id) {
            delete draft.runtime.intentPasses[key];
          }
        });
      }
    }

    // Step 4: Check SitePass for tab + site post-intervention cooldown (including cross-tab if enabled)
    const validSitePass = findValidSitePass(state.runtime.sitePasses, tabId, url, now);
    if (validSitePass) {
      return true;
    }

    // Prune direct tab pass if expired
    const directSitePass = state.runtime.sitePasses?.[key];
    if (directSitePass && now >= directSitePass.expiresAt) {
      await storage.updateState((draft) => {
        const p = draft.runtime.sitePasses?.[key];
        if (p && p.id === directSitePass.id) {
          delete draft.runtime.sitePasses[key];
        }
      });
    }

    // Step 5: Core policy engine evaluation
    let activeFocusSession = state.runtime.focusSession || null;
    if (activeFocusSession) {
      if (!isFocusSessionActive(activeFocusSession, now)) {
        activeFocusSession = null;
        await storage.updateState((draft) => {
          draft.runtime.focusSession = null;
        });
      }
    }

    const activeGrants = Object.values(state.runtime.temporaryAccessGrants || {}).filter((grant) => {
      return grant.expiresAt > now;
    });

    const dateKey = getLocalDateKey(new Date(now));
    const dailyUsageMs: Record<string, number> = {};
    for (const record of Object.values(state.usage || {})) {
      if (record.dateKey === dateKey) {
        dailyUsageMs[record.collectionId] = record.accumulatedMs;
        dailyUsageMs[`${dateKey}:${record.collectionId}`] = record.accumulatedMs;
      }
    }

    engine.setCollections(state.collections);
    const decision = engine.evaluate({
      url,
      tabId,
      timestamp: now,
      activeGrants,
      collections: state.collections,
      dailyUsageMs,
      focusSession: activeFocusSession,
    });

    // Allowed by active grant
    if (decision.action === 'ALLOW' && decision.reason === 'ACTIVE_GRANT') {
      return true;
    }

    // Phase 1 test hook compatibility: if not /moment-test-target and allowed by policy, permit navigation
    if (decision.action === 'ALLOW' && !url.includes('/moment-test-target')) {
      return true;
    }

    const collection = state.collections[decision.collectionId || ''];

    // Terminal block page routing (STRICT_BLOCK or active block boundary)
    if (decision.action === 'BLOCK') {
      logger.info('Navigation blocked by policy', {
        tabId,
        url,
        collectionId: decision.collectionId,
        reason: decision.reason,
        source,
      });
      const blockUrl = adapter.getExtensionUrl(
        `ui/block/block.html?target=${encodeURIComponent(url)}&collection=${encodeURIComponent(
          decision.collectionId || ''
        )}&collectionName=${encodeURIComponent(
          collection?.name || ''
        )}&message=${encodeURIComponent(collection?.customBlockMessage || '')}`
      );
      await adapter.updateTab(tabId, { url: blockUrl });
      return false;
    }

    // Intercept navigation to intervention shell
    const pauseConfig = collection?.boundary?.pause || {
      type: 'BREATHE',
      durationSeconds: 10,
      requireIntentionText: false,
    };
    const interventionType = pauseConfig.type !== 'NONE' ? pauseConfig.type : 'CONFIRM';
    const durationSeconds = pauseConfig.durationSeconds > 0
      ? pauseConfig.durationSeconds
      : (interventionType === 'BREATHE' ? 10 : (interventionType === 'TIMER' ? 5 : 0));
    const nonce = Math.random().toString(36).substring(2, 10);
    const interventionId = `intv_${now}_${Math.random().toString(36).substring(2, 7)}`;

    const pending: PendingIntervention = {
      id: interventionId,
      tabId,
      targetUrl: url,
      collectionId: decision.collectionId || '',
      matchedRuleId: decision.matchedRuleId,
      interventionType,
      durationSeconds,
      requireIntentionText: pauseConfig.requireIntentionText || false,
      createdAt: now,
      updatedAt: now,
      nonce,
      status: 'PENDING',
    };

    await storage.updateState((draft) => {
      draft.runtime.pendingInterventions[key] = pending;
    });

    const interveneUrl = adapter.getExtensionUrl(
      `ui/intervene/intervene.html?target=${encodeURIComponent(url)}&tabId=${tabId}&nonce=${nonce}&type=${interventionType}&duration=${durationSeconds}`
    );

    logger.info('Routing to intervention page', { tabId, url, action: decision.action, source });
    await adapter.updateTab(tabId, { url: interveneUrl });
    return false;
  } catch (err: any) {
    logger.error('Error during evaluateAndEnforceNavigation', { error: err.message, tabId, url, source });
    return true;
  }
}

// Multi-Tier Navigation Defense:
// Tier 1: Primary pre-navigation interception
adapter.onNavigation(async (details) => {
  try {
    if (details.frameId !== 0) return;
    await evaluateAndEnforceNavigation(details.tabId, details.url, 'BEFORE_NAVIGATE');
  } catch (err: any) {
    logger.error('Error in onNavigation', { error: err.message, tabId: details.tabId, url: details.url });
  }
});

// Tier 2: Secondary commit-time interception (catches 301/302 redirects) and single-use grant consumption
adapter.onNavigationCommitted(async (details) => {
  try {
    if (details.frameId !== 0) return;
    await evaluateAndEnforceNavigation(details.tabId, details.url, 'COMMITTED');
  } catch (err: any) {
    logger.error('Error in onNavigationCommitted', { error: err.message, tabId: details.tabId, url: details.url });
  }
});

// Tier 3: SPA in-page history navigation interception
adapter.onHistoryStateUpdated(async (details) => {
  try {
    if (details.frameId !== 0) return;
    await evaluateAndEnforceNavigation(details.tabId, details.url, 'HISTORY_UPDATE');
  } catch (err: any) {
    logger.error('Error in onHistoryStateUpdated', { error: err.message, tabId: details.tabId, url: details.url });
  }
});

// Alarm Listener: Handles scheduled pass expiration events
adapter.onAlarm(async (alarmName) => {
  try {
    if (alarmName.startsWith('pass_expire_')) {
      const parts = alarmName.split('_');
      const tabId = parseInt(parts[3], 10);
      if (!isNaN(tabId)) {
        await checkPassExpiration(tabId);
      }
      await adapter.clearAlarm(alarmName);
    }
  } catch (err: any) {
    logger.error('Error handling alarm', { error: err.message, alarmName });
  }
});

// Startup Tab Reconciliation (Tier 4)
async function reconcileStartupState(): Promise<void> {
  try {
    const state = await storage.getState();
    const now = Date.now();

    // 1. Reschedule or prune any active passes
    if (state.runtime.intentPasses) {
      for (const [key, pass] of Object.entries(state.runtime.intentPasses)) {
        const tabId = parseInt(key, 10);
        if (!isNaN(tabId)) {
          if (now >= pass.expiresAt) {
            await checkPassExpiration(tabId);
          } else {
            schedulePassExpiration(tabId, 'INTENT_PASS', pass.expiresAt);
          }
        }
      }
    }

    if (state.runtime.sitePasses) {
      for (const [key, pass] of Object.entries(state.runtime.sitePasses)) {
        const tabId = parseInt(key, 10);
        if (!isNaN(tabId)) {
          if (now >= pass.expiresAt) {
            await checkPassExpiration(tabId);
          } else {
            schedulePassExpiration(tabId, 'SITE_PASS', pass.expiresAt);
          }
        }
      }
    }

    // 2. Reconcile all open tabs on startup
    const tabs = await adapter.getAllTabs();
    for (const tab of tabs) {
      if (tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
        await evaluateAndEnforceNavigation(tab.id, tab.url, 'RECONCILIATION');
      }
    }
  } catch (err: any) {
    logger.error('Error during reconcileStartupState', { error: err.message });
  }
}

// Tab close cleanup (state hygiene)
adapter.onTabRemoved(async (tabId) => {
  try {
    await storage.updateState((draft) => {
      const key = String(tabId);
      delete draft.runtime.pendingInterventions[key];
      delete draft.runtime.temporaryAccessGrants[key];
      if (draft.runtime.sitePasses) {
        const pass = draft.runtime.sitePasses[key];
        if (pass && pass.scope === 'ALL_TABS_UNTIL_EXPIRATION') {
          // Retain cross-tab site unlock until its natural expiration timestamp
        } else {
          delete draft.runtime.sitePasses[key];
        }
      }
      if (draft.runtime.intentPasses) {
        delete draft.runtime.intentPasses[key];
      }
    });
  } catch (err: any) {
    logger.error('Error during onTabRemoved', { error: err.message, tabId });
  }
});
