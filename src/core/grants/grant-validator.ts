/**
 * Moment Core: Centralized Temporary Access Grant Validator
 * Single authoritative source of truth for Temporary Access Grant validation.
 * Zero browser dependencies — 100% pure domain logic.
 */

import { TemporaryAccessGrant } from '../models/grant.js';
import { DEFAULT_GRANT_DURATION_MS, MAX_GRANT_DURATION_MS } from '../../shared/constants.js';

/**
 * Validates whether a requested navigation URL is authorized by a Temporary Access Grant target.
 *
 * Rules:
 * - Structural URL parsing via URL API (never raw substring matching).
 * - Only http: and https: protocols are valid navigation targets.
 * - If grantTarget is a URL/URL prefix:
 *   - Protocol must match exactly (HTTP and HTTPS are distinct).
 *   - Port must match exactly.
 *   - Hostname must match exactly (subdomains, suffix lookalikes, and prefix lookalikes are REJECTED).
 *   - Path must match exact boundary: root '/' covers all subpaths; specific paths must match or extend with a '/' boundary.
 * - If grantTarget is a bare hostname:
 *   - Hostname must match exactly (case-insensitive). Subdomains are REJECTED.
 * - Rejects malformed URLs, query-parameter injections, hash-fragment injections, and credential manipulations.
 */
export function isTargetAuthorized(grantTarget: string, requestedUrl: string): boolean {
  if (!grantTarget || !requestedUrl || typeof grantTarget !== 'string' || typeof requestedUrl !== 'string') {
    return false;
  }

  let reqParsed: URL;
  try {
    reqParsed = new URL(requestedUrl);
  } catch {
    return false;
  }

  // Restrict to standard web schemes
  if (reqParsed.protocol !== 'http:' && reqParsed.protocol !== 'https:') {
    return false;
  }

  // Case 1: grantTarget specifies an explicit protocol scheme (full URL or origin)
  if (grantTarget.startsWith('http://') || grantTarget.startsWith('https://')) {
    let grantParsed: URL;
    try {
      grantParsed = new URL(grantTarget);
    } catch {
      return false;
    }

    // Protocol must match exactly
    if (reqParsed.protocol !== grantParsed.protocol) {
      return false;
    }

    // Port must match exactly (URL parses default ports as empty string)
    if (reqParsed.port !== grantParsed.port) {
      return false;
    }

    // Hostname must match exactly
    if (reqParsed.hostname.toLowerCase() !== grantParsed.hostname.toLowerCase()) {
      return false;
    }

    // Path boundary match
    const grantPath = grantParsed.pathname;
    if (grantPath === '' || grantPath === '/') {
      return true; // Authorizes all paths on this origin
    }

    const normalizedGrantPath = grantPath.endsWith('/') ? grantPath.slice(0, -1) : grantPath;
    const reqPath = reqParsed.pathname;

    // Exact match or sub-path with boundary delimiter
    return reqPath === normalizedGrantPath || reqPath.startsWith(normalizedGrantPath + '/');
  }

  // Case 2: grantTarget is a bare hostname (e.g. "example.com" or "distracting.site")
  const trimmedTarget = grantTarget.trim().toLowerCase();

  // Reject bare targets containing URL delimiters (must use full URL format for paths/ports)
  if (
    trimmedTarget.includes('/') ||
    trimmedTarget.includes(':') ||
    trimmedTarget.includes('?') ||
    trimmedTarget.includes('#') ||
    trimmedTarget.includes('@')
  ) {
    return false;
  }

  // Exact hostname match (subdomains are not automatically authorized by bare domain)
  return reqParsed.hostname.toLowerCase() === trimmedTarget;
}

/**
 * Validates and clamps client/UI requested grant duration to safe boundaries.
 *
 * Rules:
 * - Omitted, non-number, NaN, Infinity, or negative/zero values fall back to DEFAULT_GRANT_DURATION_MS.
 * - Clamps any value exceeding MAX_GRANT_DURATION_MS to MAX_GRANT_DURATION_MS.
 * - Guarantees 0 < resolvedDuration <= MAX_GRANT_DURATION_MS.
 */
export function resolveGrantDuration(requestedDuration?: unknown): number {
  if (typeof requestedDuration !== 'number') {
    return DEFAULT_GRANT_DURATION_MS;
  }

  if (!Number.isFinite(requestedDuration) || Number.isNaN(requestedDuration)) {
    return DEFAULT_GRANT_DURATION_MS;
  }

  if (requestedDuration <= 0) {
    return DEFAULT_GRANT_DURATION_MS;
  }

  const floored = Math.floor(requestedDuration);
  if (floored > MAX_GRANT_DURATION_MS) {
    return MAX_GRANT_DURATION_MS;
  }

  return floored;
}

/**
 * Validates whether a Temporary Access Grant authorizes a given tab and navigation event.
 */
export function isGrantValidForNavigation(
  grant: TemporaryAccessGrant | undefined | null,
  tabId: number,
  requestedUrl: string,
  now: number = Date.now()
): boolean {
  if (!grant) return false;
  if (grant.tabId !== tabId) return false;
  if (typeof grant.grantedAt !== 'number' || typeof grant.expiresAt !== 'number') return false;
  if (grant.grantedAt >= grant.expiresAt) return false;
  if (now >= grant.expiresAt) return false;
  if (now < grant.grantedAt) return false;
  if (grant.expiresAt - grant.grantedAt > MAX_GRANT_DURATION_MS) return false;

  return isTargetAuthorized(grant.target, requestedUrl);
}
