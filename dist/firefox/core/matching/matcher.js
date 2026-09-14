/**
 * Moment Core: Target Matcher Engine
 * Pure domain model - zero browser dependencies.
 * Implements deterministic matching across TargetRuleTypes with boundary awareness.
 */
import { compileGlobMatcher } from './glob.js';
/**
 * Parses raw target pattern into normalized matching components.
 */
function parseTargetComponents(pattern) {
    if (!pattern || typeof pattern !== 'string')
        return null;
    let text = pattern.trim();
    if (text.length === 0)
        return null;
    let protocol = null;
    if (text.startsWith('http://')) {
        protocol = 'http:';
        text = text.slice(7);
    }
    else if (text.startsWith('https://')) {
        protocol = 'https:';
        text = text.slice(8);
    }
    // Extract query
    let search = null;
    const qIdx = text.indexOf('?');
    if (qIdx !== -1) {
        search = text.slice(qIdx);
        text = text.slice(0, qIdx);
    }
    // Extract path
    let pathname = '/';
    const sIdx = text.indexOf('/');
    if (sIdx !== -1) {
        pathname = text.slice(sIdx);
        text = text.slice(0, sIdx);
    }
    // Extract port from host
    let port = '';
    const colonIdx = text.indexOf(':');
    if (colonIdx !== -1) {
        port = text.slice(colonIdx + 1);
        text = text.slice(0, colonIdx);
    }
    let host = text.toLowerCase();
    let isExactHost = false;
    let isLeadingSubdomainOnly = false;
    if (host.startsWith('*.')) {
        isLeadingSubdomainOnly = true;
        host = host.slice(2);
    }
    else if (host.startsWith('.')) {
        isExactHost = true;
        host = host.slice(1);
    }
    if (host.length === 0)
        return null;
    return {
        protocol,
        host,
        isExactHost,
        isLeadingSubdomainOnly,
        port,
        pathname,
        search,
    };
}
/**
 * Evaluates host matching logic.
 */
function matchesHost(urlHost, targetHost, isExact, isLeadingSubdomainOnly) {
    if (isLeadingSubdomainOnly) {
        // *.domain.com: matches sub.domain.com, NOT domain.com
        return urlHost !== targetHost && urlHost.endsWith('.' + targetHost);
    }
    if (isExact) {
        return urlHost === targetHost;
    }
    // Standard domain match: domain.com matches domain.com and *.domain.com
    return urlHost === targetHost || urlHost.endsWith('.' + targetHost);
}
/**
 * Evaluates boundary-aware path prefix matching.
 * e.g. /feed matches /feed, /feed/, and /feed/sub, but NOT /feedback.
 */
function matchesPathPrefix(urlPath, targetPath) {
    if (targetPath === '/' || targetPath === '') {
        return true; // Root covers everything
    }
    const normTarget = targetPath.endsWith('/') ? targetPath.slice(0, -1) : targetPath;
    const normUrl = urlPath.endsWith('/') && urlPath !== '/' ? urlPath.slice(0, -1) : urlPath;
    if (normUrl === normTarget) {
        return true;
    }
    return urlPath.startsWith(normTarget + '/');
}
/**
 * Cache for compiled glob matchers to prevent recompilation during batch evaluation.
 */
const globMatcherCache = new Map();
/**
 * Determines whether a Target matches a CanonicalUrl.
 * Zero side effects, deterministic, safe fail-closed.
 */
export function matchTarget(target, url) {
    if (!target || !target.pattern || !url) {
        return false;
    }
    // Dispatch GLOB rules to specialized glob compiler
    if (target.type === 'GLOB') {
        let matcher = globMatcherCache.get(target.pattern);
        if (!matcher) {
            const compiled = compileGlobMatcher(target.pattern);
            if (!compiled)
                return false; // Malformed glob fails safely
            matcher = compiled;
            globMatcherCache.set(target.pattern, matcher);
        }
        return matcher(url);
    }
    const parsed = parseTargetComponents(target.pattern);
    if (!parsed) {
        return false; // Malformed pattern fails safely
    }
    // 1. Protocol check
    if (parsed.protocol !== null && url.protocol !== parsed.protocol) {
        return false;
    }
    // 2. Port check
    if (parsed.port.length > 0 && url.port !== parsed.port) {
        return false;
    }
    // 3. Host check
    const isExactHost = target.type === 'EXACT_HOST' || parsed.isExactHost;
    if (!matchesHost(url.hostname, parsed.host, isExactHost, parsed.isLeadingSubdomainOnly)) {
        return false;
    }
    // 4. Type-specific path & query checks
    switch (target.type) {
        case 'WEBSITE':
        case 'EXACT_HOST': {
            // Covers all paths on the matching host unless a subpath was explicitly defined
            if (parsed.pathname !== '/' && parsed.pathname !== '') {
                return matchesPathPrefix(url.pathname, parsed.pathname);
            }
            return true;
        }
        case 'PATH_PREFIX': {
            return matchesPathPrefix(url.pathname, parsed.pathname);
        }
        case 'EXACT_PAGE': {
            // Must match exact pathname
            const normTarget = parsed.pathname.endsWith('/') && parsed.pathname !== '/'
                ? parsed.pathname.slice(0, -1)
                : parsed.pathname;
            const normUrl = url.pathname.endsWith('/') && url.pathname !== '/'
                ? url.pathname.slice(0, -1)
                : url.pathname;
            if (normUrl !== normTarget) {
                return false;
            }
            // If target specifies query, query must match exactly
            if (parsed.search !== null) {
                return url.search === parsed.search;
            }
            return true;
        }
        default:
            return false;
    }
}
