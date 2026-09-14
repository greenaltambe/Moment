/**
 * Moment Core: Safe & Bounded Glob Parser & Matcher
 * Pure domain model - zero browser dependencies.
 * Implements the ratified Phase 0.2 Minimal Wildcard Grammar.
 */
const MAX_PATTERN_LENGTH = 256;
const MAX_PATH_WILDCARDS = 2;
/**
 * Validates a glob pattern against the ratified Phase 0.2 grammar.
 */
export function validateGlobPattern(rawPattern) {
    if (!rawPattern || typeof rawPattern !== 'string') {
        return { valid: false, error: 'Pattern must be a non-empty string' };
    }
    const pattern = rawPattern.trim();
    if (pattern.length === 0) {
        return { valid: false, error: 'Pattern cannot be empty' };
    }
    if (pattern.length > MAX_PATTERN_LENGTH) {
        return { valid: false, error: `Pattern exceeds maximum length of ${MAX_PATTERN_LENGTH} characters` };
    }
    // Check query part
    const queryIndex = pattern.indexOf('?');
    if (queryIndex !== -1) {
        const queryPart = pattern.slice(queryIndex + 1);
        // V1 Invariant: Wildcards are strictly forbidden in query strings
        if (queryPart.includes('*')) {
            return { valid: false, error: 'Wildcards are not permitted in query strings in V1' };
        }
    }
    // Extract host part (before first '/' or '?')
    let rest = pattern;
    if (rest.startsWith('http://') || rest.startsWith('https://')) {
        rest = rest.replace(/^https?:\/\//, '');
    }
    const slashIndex = rest.indexOf('/');
    const questionIndex = rest.indexOf('?');
    let endOfHost = rest.length;
    if (slashIndex !== -1 && questionIndex !== -1) {
        endOfHost = Math.min(slashIndex, questionIndex);
    }
    else if (slashIndex !== -1) {
        endOfHost = slashIndex;
    }
    else if (questionIndex !== -1) {
        endOfHost = questionIndex;
    }
    const hostPart = rest.slice(0, endOfHost).toLowerCase();
    if (hostPart.length === 0) {
        return { valid: false, error: 'Pattern must specify a valid host' };
    }
    // Host wildcard validation
    if (hostPart.includes('*')) {
        if (!hostPart.startsWith('*.')) {
            return { valid: false, error: 'Wildcards in host are only permitted as leading prefix (e.g. *.example.com)' };
        }
        const domainAfterWildcard = hostPart.slice(2);
        if (domainAfterWildcard.includes('*')) {
            return { valid: false, error: 'Multiple wildcards in host are forbidden' };
        }
        if (!domainAfterWildcard.includes('.') || domainAfterWildcard.endsWith('.')) {
            return { valid: false, error: 'TLD wildcards are forbidden (e.g. google.*)' };
        }
    }
    // Path wildcard count
    if (slashIndex !== -1) {
        const pathPart = queryIndex !== -1 ? rest.slice(slashIndex, queryIndex) : rest.slice(slashIndex);
        // Count unescaped asterisks in path
        const unescapedAsterisks = (pathPart.match(/(?<!\\)\*/g) || []).length;
        if (unescapedAsterisks > MAX_PATH_WILDCARDS) {
            return { valid: false, error: `Path contains ${unescapedAsterisks} wildcards (maximum allowed: ${MAX_PATH_WILDCARDS})` };
        }
    }
    return { valid: true };
}
/**
 * Parses a validated glob pattern into structural components.
 */
export function parseGlobPattern(rawPattern) {
    const validation = validateGlobPattern(rawPattern);
    if (!validation.valid) {
        return null;
    }
    let text = rawPattern.trim();
    let protocol = null;
    if (text.startsWith('http://')) {
        protocol = 'http:';
        text = text.slice(7);
    }
    else if (text.startsWith('https://')) {
        protocol = 'https:';
        text = text.slice(8);
    }
    // Query part
    let queryPattern = null;
    const qIdx = text.indexOf('?');
    if (qIdx !== -1) {
        queryPattern = text.slice(qIdx); // includes '?'
        text = text.slice(0, qIdx);
    }
    // Path part
    let pathPattern = null;
    const sIdx = text.indexOf('/');
    if (sIdx !== -1) {
        pathPattern = text.slice(sIdx);
        text = text.slice(0, sIdx);
    }
    // Host part
    let host = text.toLowerCase();
    let isLeadingHostWildcard = false;
    let isExactHost = false;
    if (host.startsWith('*.')) {
        isLeadingHostWildcard = true;
        host = host.slice(2);
    }
    else if (host.startsWith('.')) {
        isExactHost = true;
        host = host.slice(1);
    }
    const unescapedWildcards = pathPattern ? (pathPattern.match(/(?<!\\)\*/g) || []).length : 0;
    return {
        rawPattern,
        protocol,
        hostPattern: host,
        isLeadingHostWildcard,
        isExactHost,
        pathPattern,
        queryPattern,
        pathWildcardCount: unescapedWildcards,
    };
}
/**
 * Escapes regex special characters except unescaped asterisk placeholders.
 */
function escapeRegexLiteral(str) {
    return str.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * Compiles a path pattern into a safe RegExp matcher.
 * Handles escaped literal \* properly.
 */
function compilePathRegex(pattern) {
    // Normalize trailing slash if pattern is root wildcard
    const tokenPlaceholder = '___MOMENT_WILDCARD___';
    const escapedLiteralAsterisk = '___LITERAL_ASTERISK___';
    // Protect escaped \* first
    const protectedPattern = pattern
        .replace(/\\\*/g, escapedLiteralAsterisk)
        .replace(/\*/g, tokenPlaceholder);
    const parts = protectedPattern.split(tokenPlaceholder);
    const escapedParts = parts.map((p) => escapeRegexLiteral(p).replace(new RegExp(escapedLiteralAsterisk, 'g'), '\\*'));
    // Join with safe non-greedy or greedy matching across any characters
    return new RegExp(`^${escapedParts.join('.*')}$`);
}
/**
 * Compiles a validated glob pattern into a deterministic matcher function.
 */
export function compileGlobMatcher(rawPattern) {
    const parsed = parseGlobPattern(rawPattern);
    if (!parsed) {
        return null;
    }
    const { protocol, hostPattern, isLeadingHostWildcard, isExactHost, pathPattern, queryPattern } = parsed;
    let pathRegex = null;
    if (pathPattern !== null) {
        pathRegex = compilePathRegex(pathPattern);
    }
    return function matchesGlob(url) {
        // 1. Protocol check
        if (protocol !== null && url.protocol !== protocol) {
            return false;
        }
        // 2. Host check
        const urlHost = url.hostname;
        if (isLeadingHostWildcard) {
            // *.example.com: matches sub.example.com and a.b.example.com, but NOT apex example.com
            if (urlHost === hostPattern || !urlHost.endsWith('.' + hostPattern)) {
                return false;
            }
        }
        else if (isExactHost) {
            // .example.com: matches only exact host example.com
            if (urlHost !== hostPattern) {
                return false;
            }
        }
        else {
            // example.com: matches example.com and any subdomains (*.example.com)
            if (urlHost !== hostPattern && !urlHost.endsWith('.' + hostPattern)) {
                return false;
            }
        }
        // 3. Path check
        if (pathPattern !== null && pathRegex !== null) {
            if (!pathRegex.test(url.pathname)) {
                return false;
            }
        }
        // 4. Query check
        if (queryPattern !== null) {
            if (url.search !== queryPattern) {
                return false;
            }
        }
        return true;
    };
}
