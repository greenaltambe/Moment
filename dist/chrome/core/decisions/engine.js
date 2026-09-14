/**
 * Moment Core: Authoritative Policy & Decision Engine
 * Pure domain model - zero browser dependencies.
 * Deterministic pipeline: URL -> Canonical -> Targets -> Boundaries -> Exceptions -> Precedence -> Decision.
 */
import { isFocusSessionActive } from '../focus/focus-validator.js';
import { isGrantValidForNavigation } from '../grants/grant-validator.js';
import { parseCanonicalUrl } from '../matching/url.js';
import { matchTarget } from '../matching/matcher.js';
import { isBoundaryActive } from '../policies/boundary-evaluator.js';
import { calculateSpecificity, compareSpecificity } from './specificity.js';
import { resolveCollectionLimitMs, calculateRemainingBudget, getLocalDateKey } from '../usage/index.js';
export class MomentDecisionEngine {
    configuredCollections = [];
    constructor(collections) {
        if (collections) {
            this.setCollections(collections);
        }
    }
    setCollections(collections) {
        if (Array.isArray(collections)) {
            this.configuredCollections = collections;
        }
        else if (collections && typeof collections === 'object') {
            this.configuredCollections = Object.values(collections);
        }
        else {
            this.configuredCollections = [];
        }
    }
    /**
     * Resolves the matching collection for a given URL under current boundary/schedule rules.
     * If the winning rule is an exception, returns null (not subject to collection restriction or usage limits).
     * If no boundary is active or no target matches, returns null.
     * Returns the winning collection if an active restriction rule matches.
     */
    resolveMatchingCollection(url, timestamp = Date.now(), collections, focusSession) {
        const canonicalUrl = parseCanonicalUrl(url);
        if (!canonicalUrl)
            return null;
        const collectionsToEvaluate = collections
            ? Array.isArray(collections)
                ? collections
                : Object.values(collections)
            : this.configuredCollections;
        const candidateMatches = [];
        for (const collection of collectionsToEvaluate) {
            if (!collection || typeof collection !== 'object')
                continue;
            if (collection.enabled === false)
                continue;
            if (!collection.targets || !Array.isArray(collection.targets))
                continue;
            const isNormallyActive = isBoundaryActive(collection.boundary, timestamp);
            const isFocusActive = Boolean(focusSession &&
                isFocusSessionActive(focusSession, timestamp) &&
                focusSession.selectedCollectionIds.includes(collection.id));
            const boundaryActive = isNormallyActive || isFocusActive;
            for (const target of collection.targets) {
                if (!target || !target.pattern || !target.type)
                    continue;
                if (matchTarget(target, canonicalUrl)) {
                    const specificity = calculateSpecificity(target, canonicalUrl);
                    candidateMatches.push({
                        target,
                        collection,
                        specificity,
                        boundaryActive,
                        focusModeActive: isFocusActive,
                    });
                }
            }
        }
        if (candidateMatches.length === 0)
            return null;
        const activeCandidates = candidateMatches.filter((c) => c.target.isException || c.boundaryActive);
        if (activeCandidates.length === 0)
            return null;
        activeCandidates.sort((a, b) => {
            const specDiff = compareSpecificity(a.specificity, b.specificity);
            if (specDiff !== 0)
                return -specDiff;
            if (a.target.isException !== b.target.isException) {
                return a.target.isException ? -1 : 1;
            }
            if (!a.target.isException && !b.target.isException) {
                const aSeverity = a.collection.boundary?.action?.type === 'BLOCK_PAGE' ? 2 : 1;
                const bSeverity = b.collection.boundary?.action?.type === 'BLOCK_PAGE' ? 2 : 1;
                if (aSeverity !== bSeverity)
                    return bSeverity - aSeverity;
            }
            if (a.target.createdAt !== b.target.createdAt) {
                return b.target.createdAt - a.target.createdAt;
            }
            return a.target.id.localeCompare(b.target.id);
        });
        const winner = activeCandidates[0];
        if (winner.target.isException) {
            return null;
        }
        return winner.collection;
    }
    evaluate(request) {
        const { url, tabId, timestamp, activeGrants, focusSession } = request;
        // STEP 1: Temporary Access Grant Check (Phase 1.1 Invariant)
        if (activeGrants && activeGrants.length > 0) {
            const matchingGrant = activeGrants.find((grant) => isGrantValidForNavigation(grant, tabId, url, timestamp));
            if (matchingGrant) {
                const remainingSeconds = Math.max(0, Math.round((matchingGrant.expiresAt - timestamp) / 1000));
                return {
                    action: 'ALLOW',
                    reason: 'ACTIVE_GRANT',
                    targetUrl: url,
                    matchedRuleId: matchingGrant.id,
                    collectionId: null,
                    explanation: `Access authorized via active Temporary Access Grant (expires in ${remainingSeconds}s).`,
                    timestamp,
                    trace: {
                        finalAction: 'ALLOW',
                        reason: 'ACTIVE_GRANT',
                        totalCandidateRulesMatched: 0,
                    },
                };
            }
        }
        // STEP 2: Canonicalize URL
        const canonicalUrl = parseCanonicalUrl(url);
        if (!canonicalUrl) {
            return {
                action: 'ALLOW',
                reason: 'NO_RULE_MATCH',
                targetUrl: url,
                matchedRuleId: null,
                collectionId: null,
                explanation: 'Invalid or non-web URL scheme; policy evaluation bypassed safely.',
                timestamp,
                trace: {
                    finalAction: 'ALLOW',
                    reason: 'NO_RULE_MATCH',
                    totalCandidateRulesMatched: 0,
                },
            };
        }
        // STEP 3: Resolve Available Collections
        const collectionsToEvaluate = request.collections
            ? Array.isArray(request.collections)
                ? request.collections
                : Object.values(request.collections)
            : this.configuredCollections;
        // STEP 4: Target Matching & Specificity Computation
        const candidateMatches = [];
        for (const collection of collectionsToEvaluate) {
            if (!collection || typeof collection !== 'object') {
                continue;
            }
            // Disabled collections do not participate
            if (collection.enabled === false) {
                continue;
            }
            if (!collection.targets || !Array.isArray(collection.targets)) {
                continue;
            }
            const isNormallyActive = isBoundaryActive(collection.boundary, timestamp);
            const isFocusActive = Boolean(focusSession &&
                isFocusSessionActive(focusSession, timestamp) &&
                focusSession.selectedCollectionIds.includes(collection.id));
            const boundaryActive = isNormallyActive || isFocusActive;
            for (const target of collection.targets) {
                if (!target || !target.pattern || !target.type) {
                    continue; // Malformed targets fail safely
                }
                if (matchTarget(target, canonicalUrl)) {
                    const specificity = calculateSpecificity(target, canonicalUrl);
                    candidateMatches.push({
                        target,
                        collection,
                        specificity,
                        boundaryActive,
                        focusModeActive: isFocusActive,
                    });
                }
            }
        }
        if (candidateMatches.length === 0) {
            return {
                action: 'ALLOW',
                reason: 'NO_RULE_MATCH',
                targetUrl: url,
                matchedRuleId: null,
                collectionId: null,
                explanation: 'No active boundary matches this navigation.',
                timestamp,
                trace: {
                    finalAction: 'ALLOW',
                    reason: 'NO_RULE_MATCH',
                    totalCandidateRulesMatched: 0,
                },
            };
        }
        // Filter candidate rules to active applicable policies:
        // - Exceptions are evaluated regardless of whether the boundary is on or off
        // - Restrictions participate only if their collection's boundary is active at timestamp
        const activeCandidates = candidateMatches.filter((c) => c.target.isException || c.boundaryActive);
        if (activeCandidates.length === 0) {
            // Matching restrictions exist, but their boundaries/schedules are currently inactive
            const firstInactive = candidateMatches[0];
            return {
                action: 'ALLOW',
                reason: 'SCHEDULE_INACTIVE',
                targetUrl: url,
                matchedRuleId: firstInactive.target.id,
                collectionId: firstInactive.collection.id,
                explanation: `Target matches collection '${firstInactive.collection.name}', but its schedule is currently inactive.`,
                timestamp,
                trace: {
                    finalAction: 'ALLOW',
                    reason: 'SCHEDULE_INACTIVE',
                    matchedTarget: firstInactive.target,
                    specificity: firstInactive.specificity,
                    collectionId: firstInactive.collection.id,
                    boundaryActive: false,
                    isException: false,
                    focusModeActive: Boolean(firstInactive.focusModeActive),
                    totalCandidateRulesMatched: candidateMatches.length,
                },
            };
        }
        // STEP 5: Deterministic Precedence Resolution (Lexicographic Specificity Tuple)
        activeCandidates.sort((a, b) => {
            // 1. Specificity Tuple comparison
            const specDiff = compareSpecificity(a.specificity, b.specificity);
            if (specDiff !== 0) {
                return -specDiff; // Higher specificity comes first
            }
            // 2. Exception beats Restriction on identical specificity
            if (a.target.isException !== b.target.isException) {
                return a.target.isException ? -1 : 1;
            }
            // 3. Policy Severity tie-breaker on restrictions
            if (!a.target.isException && !b.target.isException) {
                const aSeverity = a.collection.boundary?.action?.type === 'BLOCK_PAGE' ? 2 : 1;
                const bSeverity = b.collection.boundary?.action?.type === 'BLOCK_PAGE' ? 2 : 1;
                if (aSeverity !== bSeverity) {
                    return bSeverity - aSeverity;
                }
            }
            // 4. Stable tie-breaker: Creation timestamp (newer wins), then stable ID
            if (a.target.createdAt !== b.target.createdAt) {
                return b.target.createdAt - a.target.createdAt;
            }
            return a.target.id.localeCompare(b.target.id);
        });
        const winningCandidate = activeCandidates[0];
        const { target: winningTarget, collection: winningCollection, specificity: winningSpec } = winningCandidate;
        // STEP 6: Final Decision Construction
        if (winningTarget.isException) {
            return {
                action: 'ALLOW',
                reason: 'EXCEPTION_RULE',
                targetUrl: url,
                matchedRuleId: winningTarget.id,
                collectionId: winningCollection.id,
                explanation: `Access allowed via exception rule '${winningTarget.pattern}' in collection '${winningCollection.name}'.`,
                timestamp,
                trace: {
                    finalAction: 'ALLOW',
                    reason: 'EXCEPTION_RULE',
                    matchedTarget: winningTarget,
                    specificity: winningSpec,
                    collectionId: winningCollection.id,
                    boundaryActive: true,
                    isException: true,
                    totalCandidateRulesMatched: candidateMatches.length,
                },
            };
        }
        // Winning rule is a restriction with active boundary
        // Usage limits evaluation
        const limitMs = resolveCollectionLimitMs(winningCollection);
        if (limitMs !== null) {
            const dateKey = getLocalDateKey(new Date(timestamp));
            const usedMs = request.dailyUsageMs?.[winningCollection.id] ??
                request.dailyUsageMs?.[`${dateKey}:${winningCollection.id}`] ??
                0;
            const { isExhausted } = calculateRemainingBudget(usedMs, limitMs);
            if (isExhausted) {
                const pauseConfig = winningCollection.boundary?.pause;
                const isIntervention = pauseConfig && pauseConfig.type !== 'NONE';
                const finalAction = isIntervention ? 'INTERVENE' : 'BLOCK';
                return {
                    action: finalAction,
                    reason: 'DAILY_LIMIT_EXHAUSTED',
                    targetUrl: url,
                    matchedRuleId: winningTarget.id,
                    collectionId: winningCollection.id,
                    explanation: `Daily time budget exhausted for collection '${winningCollection.name}'.`,
                    timestamp,
                    trace: {
                        finalAction,
                        reason: 'DAILY_LIMIT_EXHAUSTED',
                        matchedTarget: winningTarget,
                        specificity: winningSpec,
                        collectionId: winningCollection.id,
                        boundaryActive: true,
                        focusModeActive: winningCandidate.focusModeActive,
                        isException: false,
                        totalCandidateRulesMatched: candidateMatches.length,
                    },
                };
            }
        }
        const pauseConfig = winningCollection.boundary?.pause;
        const isIntervention = pauseConfig && pauseConfig.type !== 'NONE';
        if (winningCandidate.focusModeActive) {
            const finalAction = isIntervention ? 'INTERVENE' : 'BLOCK';
            const explanation = isIntervention
                ? `Navigation requires intentional pause (${pauseConfig.durationSeconds}s) during Focus Mode for collection '${winningCollection.name}'.`
                : `Navigation blocked by Focus Mode for collection '${winningCollection.name}'.`;
            return {
                action: finalAction,
                reason: 'FOCUS_MODE',
                targetUrl: url,
                matchedRuleId: winningTarget.id,
                collectionId: winningCollection.id,
                explanation,
                timestamp,
                trace: {
                    finalAction,
                    reason: 'FOCUS_MODE',
                    matchedTarget: winningTarget,
                    specificity: winningSpec,
                    collectionId: winningCollection.id,
                    boundaryActive: true,
                    focusModeActive: true,
                    isException: false,
                    totalCandidateRulesMatched: candidateMatches.length,
                },
            };
        }
        if (isIntervention) {
            return {
                action: 'INTERVENE',
                reason: 'INTERVENTION_REQUIRED',
                targetUrl: url,
                matchedRuleId: winningTarget.id,
                collectionId: winningCollection.id,
                explanation: `Navigation requires intentional pause (${pauseConfig.durationSeconds}s) for collection '${winningCollection.name}'.`,
                timestamp,
                trace: {
                    finalAction: 'INTERVENE',
                    reason: 'INTERVENTION_REQUIRED',
                    matchedTarget: winningTarget,
                    specificity: winningSpec,
                    collectionId: winningCollection.id,
                    boundaryActive: true,
                    focusModeActive: false,
                    isException: false,
                    totalCandidateRulesMatched: candidateMatches.length,
                },
            };
        }
        return {
            action: 'BLOCK',
            reason: 'SCHEDULE_ACTIVE',
            targetUrl: url,
            matchedRuleId: winningTarget.id,
            collectionId: winningCollection.id,
            explanation: `Navigation blocked by active boundary for collection '${winningCollection.name}'.`,
            timestamp,
            trace: {
                finalAction: 'BLOCK',
                reason: 'SCHEDULE_ACTIVE',
                matchedTarget: winningTarget,
                specificity: winningSpec,
                collectionId: winningCollection.id,
                boundaryActive: true,
                focusModeActive: false,
                isException: false,
                totalCandidateRulesMatched: candidateMatches.length,
            },
        };
    }
}
/**
 * Backward compatibility alias for Phase 1 references.
 */
export const PlaceholderDecisionEngine = MomentDecisionEngine;
