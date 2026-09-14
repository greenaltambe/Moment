/**
 * Moment URL Sanitization & Display Utilities
 */

export function sanitizeUrlForDisplay(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    // Display hostname and clean path, omit auth and fragments
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return 'Invalid destination';
  }
}

export function isSafeDestination(targetUrl: string): boolean {
  try {
    const parsed = new URL(targetUrl);
    // Only allow http and https protocols for navigation
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
