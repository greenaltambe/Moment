/**
 * Moment Core: Authoritative Intent Pass Validator & Scope Resolver
 * Pure domain model - zero browser dependencies.
 * Validates user-facing, deliberate temporary access authorizations.
 */
import { parseCanonicalUrl } from '../matching/url.js';
import { matchTarget } from '../matching/matcher.js';
import { ALLOWED_INTENT_PASS_DURATIONS_MS, DEFAULT_INTENT_PASS_DURATION_MS, MAX_INTENT_PASS_DURATION_MS, } from '../../shared/constants.js';
/**
 * Validates and clamps client-requested Intent Pass duration to authorized discrete values.
 */
export function resolveIntentPassDuration(requestedDuration) {
    if (typeof requestedDuration !== 'number') {
        return DEFAULT_INTENT_PASS_DURATION_MS;
    }
    if (!Number.isFinite(requestedDuration) || Number.isNaN(requestedDuration)) {
        return DEFAULT_INTENT_PASS_DURATION_MS;
    }
    if (requestedDuration <= 0) {
        return DEFAULT_INTENT_PASS_DURATION_MS;
    }
    const floored = Math.floor(requestedDuration);
    // Exact match with configured allowed durations (5m, 15m, 30m)
    if (ALLOWED_INTENT_PASS_DURATIONS_MS.includes(floored)) {
        return floored;
    }
    // Strict maximum clamp
    if (floored > MAX_INTENT_PASS_DURATION_MS) {
        return MAX_INTENT_PASS_DURATION_MS;
    }
    // Fallback clamping for lower bound
    if (floored < ALLOWED_INTENT_PASS_DURATIONS_MS[0]) {
        return ALLOWED_INTENT_PASS_DURATIONS_MS[0];
    }
    // Snap to nearest discrete allowed duration (5m, 15m, 30m)
    let closest = DEFAULT_INTENT_PASS_DURATION_MS;
    let minDiff = Infinity;
    for (const allowed of ALLOWED_INTENT_PASS_DURATIONS_MS) {
        const diff = Math.abs(floored - allowed);
        if (diff < minDiff) {
            minDiff = diff;
            closest = allowed;
        }
    }
    return closest;
}
/**
 * Derives the precise IntentPassScope from a target URL and optional matched rule.
 *
 * CRITICAL INVARIANT (Section 25):
 * Does NOT blindly convert narrower rules into WEBSITE passes.
 * - WEBSITE: preserves apex, www, and subdomain coverage.
 * - EXACT_HOST: covers only the exact host, rejecting subdomains.
 * - PATH_PREFIX: covers only the authorized host + path prefix boundary.
 * - EXACT_PAGE: covers only the exact page and query.
 * - GLOB: covers only URLs matched by that glob pattern.
 */
export function resolveIntentPassScope(targetUrl, matchedRule) {
    if (matchedRule && matchedRule.type && matchedRule.pattern) {
        const rawPattern = matchedRule.pattern.trim();
        switch (matchedRule.type) {
            case 'WEBSITE': {
                let pattern = rawPattern.toLowerCase();
                if (pattern.startsWith('http://'))
                    pattern = pattern.slice(7);
                else if (pattern.startsWith('https://'))
                    pattern = pattern.slice(8);
                pattern = pattern.replace(/\/+$/, '');
                if (pattern.startsWith('www.'))
                    pattern = pattern.slice(4);
                return { type: 'WEBSITE', pattern };
            }
            case 'EXACT_HOST': {
                let pattern = rawPattern.toLowerCase();
                if (pattern.startsWith('http://'))
                    pattern = pattern.slice(7);
                else if (pattern.startsWith('https://'))
                    pattern = pattern.slice(8);
                pattern = pattern.replace(/\/+$/, '');
                return { type: 'EXACT_HOST', pattern };
            }
            case 'PATH_PREFIX': {
                let pattern = rawPattern;
                if (pattern.startsWith('http://'))
                    pattern = pattern.slice(7);
                else if (pattern.startsWith('https://'))
                    pattern = pattern.slice(8);
                return { type: 'PATH_PREFIX', pattern };
            }
            case 'EXACT_PAGE': {
                return { type: 'EXACT_PAGE', pattern: rawPattern };
            }
            case 'GLOB': {
                return { type: 'GLOB', pattern: rawPattern };
            }
            default:
                break;
        }
    }
    // Fallback: derive canonical website scope from destination URL
    const canonical = parseCanonicalUrl(targetUrl);
    if (!canonical)
        return null;
    let host = canonical.hostname.toLowerCase().trim();
    if (host.startsWith('www.')) {
        host = host.slice(4);
    }
    return { type: 'WEBSITE', pattern: host };
}
/**
 * Authoritatively validates whether an IntentPass authorizes a given tab and navigation event.
 *
 * Rules:
 * - Tab ID must match strictly (multi-tab isolation).
 * - Timestamps must be valid: grantedAt <= now < expiresAt.
 * - Duration cannot exceed MAX_INTENT_PASS_DURATION_MS.
 * - Protocol must be standard web scheme (http: or https:).
 * - Match evaluated via pure domain matchTarget against pass.scope.
 * - Rejects malformed state, lookalikes, expired passes, wrong tabs, and non-web schemes.
 */
export function isIntentPassValidForNavigation(pass, tabId, requestedUrl, now = Date.now()) {
    if (!pass)
        return false;
    if (typeof pass.tabId !== 'number' || pass.tabId !== tabId)
        return false;
    if (!pass.scope || typeof pass.scope !== 'object')
        return false;
    if (!pass.scope.pattern || typeof pass.scope.pattern !== 'string')
        return false;
    if (!pass.scope.type || typeof pass.scope.type !== 'string')
        return false;
    if (typeof pass.grantedAt !== 'number' || typeof pass.expiresAt !== 'number')
        return false;
    if (pass.grantedAt >= pass.expiresAt)
        return false;
    if (now >= pass.expiresAt)
        return false;
    if (now < pass.grantedAt)
        return false;
    if (pass.expiresAt - pass.grantedAt > MAX_INTENT_PASS_DURATION_MS)
        return false;
    const canonicalUrl = parseCanonicalUrl(requestedUrl);
    if (!canonicalUrl)
        return false;
    if (canonicalUrl.protocol !== 'http:' && canonicalUrl.protocol !== 'https:') {
        return false;
    }
    const syntheticTarget = {
        id: pass.id,
        pattern: pass.scope.pattern,
        type: pass.scope.type,
        isException: false,
        createdAt: pass.grantedAt,
    };
    return matchTarget(syntheticTarget, canonicalUrl);
}
