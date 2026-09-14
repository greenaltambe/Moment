/**
 * Moment Core: Resource-Dominant Lexicographic Specificity Tuple & Precedence
 * Pure domain model - zero browser dependencies.
 * Implements the ratified Phase 0.2 Specificity Model:
 * Specificity(R) = (K, P_segments, P_length, Q, H_type, H_depth, priority)
 */
/**
 * Calculates domain label count for a hostname.
 */
function countDomainLabels(host) {
    const clean = host.replace(/^\*\./, '').replace(/^\./, '');
    return clean.split('.').filter((lbl) => lbl.length > 0).length;
}
/**
 * Calculates the Resource-Dominant Specificity Tuple for a matched Target against a CanonicalUrl.
 */
export function calculateSpecificity(target, url) {
    let pattern = target.pattern.trim();
    if (pattern.startsWith('http://') || pattern.startsWith('https://')) {
        pattern = pattern.replace(/^https?:\/\//, '');
    }
    // Extract query
    let hasQuery = false;
    const qIdx = pattern.indexOf('?');
    if (qIdx !== -1) {
        hasQuery = true;
        pattern = pattern.slice(0, qIdx);
    }
    // Extract path
    let pathPart = '';
    const sIdx = pattern.indexOf('/');
    if (sIdx !== -1) {
        pathPart = pattern.slice(sIdx);
        pattern = pattern.slice(0, sIdx);
    }
    // Host part
    let hostPart = pattern.toLowerCase();
    const isExactHost = target.type === 'EXACT_HOST' || hostPart.startsWith('.');
    const hostDepth = countDomainLabels(hostPart);
    const hostType = isExactHost ? 2 : 1;
    // Evaluate K, P_segments, P_length
    let matchKind = 1;
    let pathSegments = 0;
    let pathLength = 0;
    if (target.type === 'EXACT_PAGE') {
        matchKind = 3;
        const effectivePath = pathPart || url.pathname;
        const segments = effectivePath.split('/').filter((s) => s.length > 0);
        pathSegments = segments.length;
        pathLength = effectivePath.length;
    }
    else if (target.type === 'PATH_PREFIX') {
        // Normalization: Canonicalize trailing slash on non-root paths (e.g. /a/ -> /a)
        let normPath = pathPart;
        if (normPath.length > 1 && normPath.endsWith('/')) {
            normPath = normPath.slice(0, -1);
        }
        if (normPath.length > 1 && normPath !== '/') {
            matchKind = 2;
            const segments = normPath.split('/').filter((s) => s.length > 0);
            pathSegments = segments.length;
            pathLength = normPath.length;
        }
        else {
            matchKind = 1;
            pathSegments = 0;
            pathLength = 0;
        }
    }
    else if (target.type === 'GLOB') {
        if (pathPart.length > 1 && pathPart !== '/*') {
            matchKind = 2;
            // If glob has trailing wildcard /* or *, remove it for segment count
            let segPath = pathPart;
            if (segPath.endsWith('/*')) {
                segPath = segPath.slice(0, -2);
            }
            else if (segPath.endsWith('*')) {
                segPath = segPath.slice(0, -1);
            }
            const segments = segPath.split('/').filter((s) => s.length > 0);
            pathSegments = segments.length;
            // pathLength excludes trailing wildcard (e.g. /shorts/* -> /shorts/ = 8)
            if (pathPart.endsWith('*')) {
                pathLength = pathPart.slice(0, -1).length;
            }
            else {
                pathLength = pathPart.length;
            }
        }
        else if (pathPart === '/*') {
            matchKind = 1; // Root glob is host-level
            pathSegments = 0;
            pathLength = 0;
        }
        else {
            matchKind = 1;
            pathSegments = 0;
            pathLength = 0;
        }
    }
    else {
        // WEBSITE
        let normPath = pathPart;
        if (normPath.length > 1 && normPath.endsWith('/')) {
            normPath = normPath.slice(0, -1);
        }
        if (normPath.length > 1 && normPath !== '/') {
            matchKind = 2;
            const segments = normPath.split('/').filter((s) => s.length > 0);
            pathSegments = segments.length;
            pathLength = normPath.length;
        }
        else {
            matchKind = 1;
            pathSegments = 0;
            pathLength = 0;
        }
    }
    // Clamped priority
    const rawPriority = typeof target.priority === 'number' ? target.priority : 0;
    const clampedPriority = Math.max(-100, Math.min(100, Math.floor(rawPriority)));
    return {
        matchKind,
        pathSegments,
        pathLength,
        querySpecificity: hasQuery ? 1 : 0,
        hostType,
        hostDepth,
        priority: clampedPriority,
    };
}
/**
 * Compares two SpecificityTuples in lexicographic order.
 * Returns:
 *   > 0 if a outranks b (a is more specific)
 *   < 0 if b outranks a (b is more specific)
 *   0 if a and b have identical specificity
 */
export function compareSpecificity(a, b) {
    if (a.matchKind !== b.matchKind) {
        return a.matchKind - b.matchKind;
    }
    if (a.pathSegments !== b.pathSegments) {
        return a.pathSegments - b.pathSegments;
    }
    if (a.pathLength !== b.pathLength) {
        return a.pathLength - b.pathLength;
    }
    if (a.querySpecificity !== b.querySpecificity) {
        return a.querySpecificity - b.querySpecificity;
    }
    if (a.hostType !== b.hostType) {
        return a.hostType - b.hostType;
    }
    if (a.hostDepth !== b.hostDepth) {
        return a.hostDepth - b.hostDepth;
    }
    if (a.priority !== b.priority) {
        return a.priority - b.priority;
    }
    return 0;
}
