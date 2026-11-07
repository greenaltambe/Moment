/**
 * Moment Core: Canonical URL Model & Normalization
 * Pure domain model - zero browser dependencies.
 * Uses WHATWG URL parsing with strict canonicalization.
 */

export interface CanonicalUrl {
  readonly raw: string;
  readonly protocol: 'http:' | 'https:';
  readonly hostname: string; // Lowercased, preserving subdomains and www/m
  readonly port: string; // Normalized explicit non-default port, or empty string
  readonly pathname: string; // Starts with '/', normalized without /../
  readonly pathSegments: readonly string[]; // Array of non-empty path segments
  readonly search: string; // Full query string with '?' or empty string
  readonly searchParams: ReadonlyMap<string, string>;
  readonly hash: string; // Fragment (does not participate in policy matching)
}

/**
 * Parses and canonicalizes a raw URL string for policy evaluation.
 *
 * Rules:
 * - Only standard 'http:' and 'https:' protocols are permitted.
 * - Hostnames are normalized to lowercase and trailing root dots are removed.
 * - Subdomains ('www.', 'm.', 'mobile.') are strictly preserved.
 * - Default ports (80 for HTTP, 443 for HTTPS) are normalized to empty string.
 * - Explicit non-default ports (e.g. 8080) are preserved.
 * - Returns null for invalid URLs or non-web schemes (never throws).
 */
export function parseCanonicalUrl(rawUrl: string | null | undefined): CanonicalUrl | null {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }

  // Enforce permitted protocols
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  const protocol = parsed.protocol as 'http:' | 'https:';
  // Strip trailing root dots: 'example.com.' is the same site as 'example.com' but the
  // WHATWG parser keeps the dot, which would otherwise let users bypass every host rule.
  const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, '');
  if (hostname.length === 0) {
    return null;
  }

  // Normalize default ports
  let port = parsed.port;
  if ((protocol === 'http:' && port === '80') || (protocol === 'https:' && port === '443')) {
    port = '';
  }

  // Path normalization
  let pathname = parsed.pathname || '/';
  if (!pathname.startsWith('/')) {
    pathname = '/' + pathname;
  }

  const pathSegments = pathname
    .split('/')
    .filter((seg) => seg.length > 0);

  // Parse search parameters into an immutable map
  const searchParams = new Map<string, string>();
  parsed.searchParams.forEach((val, key) => {
    searchParams.set(key, val);
  });

  return {
    raw: rawUrl,
    protocol,
    hostname,
    port,
    pathname,
    pathSegments,
    search: parsed.search,
    searchParams,
    hash: parsed.hash,
  };
}

/**
 * Reconstructs a canonical string representation from a CanonicalUrl.
 */
export function toCanonicalString(url: CanonicalUrl, includeQuery: boolean = true): string {
  const portPart = url.port ? `:${url.port}` : '';
  const base = `${url.protocol}//${url.hostname}${portPart}${url.pathname}`;
  if (includeQuery && url.search) {
    return base + url.search;
  }
  return base;
}
