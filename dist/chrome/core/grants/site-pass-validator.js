/**
 * Moment Core: Authoritative Site Pass (Post-Intervention Cooldown) Validator
 * Pure domain model - zero browser dependencies.
 * Implements tab-scoped, site-scoped temporary browsing authorizations under WEBSITE semantics.
 */
import { parseCanonicalUrl } from '../matching/url.js';
import { matchTarget } from '../matching/matcher.js';
import { DEFAULT_SITE_PASS_DURATION_MS, MAX_SITE_PASS_DURATION_MS } from '../../shared/constants.js';
/**
 * Derives the canonical site scope from a target URL and optional matched rule.
 * Normalizes leading 'www.' so apex and 'www.' subdomains share the same site cooldown.
 */
export function resolveSiteScope(targetUrl, matchedRule) {
    if (matchedRule && matchedRule.type === 'WEBSITE' && matchedRule.pattern) {
        let site = matchedRule.pattern.toLowerCase().trim();
        if (site.startsWith('http://'))
            site = site.slice(7);
        else if (site.startsWith('https://'))
            site = site.slice(8);
        site = site.replace(/\/+$/, '');
        if (site.startsWith('www.'))
            site = site.slice(4);
        if (site.length > 0)
            return site;
    }
    const canonical = parseCanonicalUrl(targetUrl);
    if (!canonical)
        return '';
    let host = canonical.hostname.toLowerCase().trim();
    if (host.startsWith('www.')) {
        host = host.slice(4);
    }
    return host;
}
/**
 * Resolves and clamps the site pass duration to safe boundaries.
 */
export function resolveSitePassDuration(requestedDuration) {
    if (typeof requestedDuration !== 'number') {
        return DEFAULT_SITE_PASS_DURATION_MS;
    }
    if (!Number.isFinite(requestedDuration) || Number.isNaN(requestedDuration)) {
        return DEFAULT_SITE_PASS_DURATION_MS;
    }
    if (requestedDuration <= 0) {
        return DEFAULT_SITE_PASS_DURATION_MS;
    }
    const floored = Math.floor(requestedDuration);
    if (floored > MAX_SITE_PASS_DURATION_MS) {
        return MAX_SITE_PASS_DURATION_MS;
    }
    return floored;
}
/**
 * Validates whether a requested navigation URL is authorized by an active SitePass in that tab.
 *
 * Rules:
 * - Tab ID must match strictly (multi-tab isolation).
 * - Timestamps must be valid: grantedAt <= now < expiresAt.
 * - Duration cannot exceed MAX_SITE_PASS_DURATION_MS.
 * - Protocol must be standard web scheme (http: or https:).
 * - Scope matches according to canonical WEBSITE target semantics (apex, www, subdomains, all subpaths).
 * - Lookalikes (example.com.evil.com, evil-example.com, example.net) are strictly rejected.
 * - Zero browser dependencies, safe fail-closed.
 */
export function isSitePassValidForNavigation(pass, tabId, requestedUrl, now = Date.now()) {
    if (!pass)
        return false;
    if (typeof pass.tabId !== 'number' || pass.tabId !== tabId)
        return false;
    if (!pass.site || typeof pass.site !== 'string')
        return false;
    if (typeof pass.grantedAt !== 'number' || typeof pass.expiresAt !== 'number')
        return false;
    if (pass.grantedAt >= pass.expiresAt)
        return false;
    if (now >= pass.expiresAt)
        return false;
    if (now < pass.grantedAt)
        return false;
    if (pass.expiresAt - pass.grantedAt > MAX_SITE_PASS_DURATION_MS)
        return false;
    const canonicalUrl = parseCanonicalUrl(requestedUrl);
    if (!canonicalUrl)
        return false;
    if (canonicalUrl.protocol !== 'http:' && canonicalUrl.protocol !== 'https:') {
        return false;
    }
    const cleanSite = pass.site.trim().toLowerCase();
    if (cleanSite.length === 0)
        return false;
    const syntheticTarget = {
        id: pass.id,
        pattern: cleanSite,
        type: 'WEBSITE',
        isException: false,
        createdAt: pass.grantedAt,
    };
    return matchTarget(syntheticTarget, canonicalUrl);
}
