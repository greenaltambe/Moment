import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCanonicalUrl, toCanonicalString } from '../../dist/chrome/core/matching/url.js';

describe('Moment Canonical URL Model & Normalization', () => {
  it('Parses valid HTTPS URL with standard components', () => {
    const url = parseCanonicalUrl('https://example.com/feed/items?page=1#heading');
    assert.ok(url);
    assert.equal(url!.protocol, 'https:');
    assert.equal(url!.hostname, 'example.com');
    assert.equal(url!.port, '');
    assert.equal(url!.pathname, '/feed/items');
    assert.deepEqual(url!.pathSegments, ['feed', 'items']);
    assert.equal(url!.search, '?page=1');
    assert.equal(url!.searchParams.get('page'), '1');
    assert.equal(url!.hash, '#heading');
  });

  it('Normalizes hostname to lowercase while preserving subdomains, www, and m', () => {
    const u1 = parseCanonicalUrl('HTTPS://WWW.EXAMPLE.COM/PATH');
    assert.ok(u1);
    assert.equal(u1!.hostname, 'www.example.com');

    const u2 = parseCanonicalUrl('https://m.reddit.com/r/all');
    assert.ok(u2);
    assert.equal(u2!.hostname, 'm.reddit.com');

    const u3 = parseCanonicalUrl('https://Sub.Domain.Example.com/');
    assert.ok(u3);
    assert.equal(u3!.hostname, 'sub.domain.example.com');
  });

  it('Distinguishes HTTP from HTTPS protocols strictly', () => {
    const httpUrl = parseCanonicalUrl('http://example.com/page');
    const httpsUrl = parseCanonicalUrl('https://example.com/page');
    assert.ok(httpUrl);
    assert.ok(httpsUrl);
    assert.ok(httpUrl!.protocol !== httpsUrl!.protocol);
    assert.equal(httpUrl!.protocol, 'http:');
    assert.equal(httpsUrl!.protocol, 'https:');
  });

  it('Normalizes default ports to empty string', () => {
    const httpDefault = parseCanonicalUrl('http://example.com:80/home');
    assert.ok(httpDefault);
    assert.equal(httpDefault!.port, '');

    const httpsDefault = parseCanonicalUrl('https://example.com:443/home');
    assert.ok(httpsDefault);
    assert.equal(httpsDefault!.port, '');
  });

  it('Preserves explicit non-default ports', () => {
    const explicit = parseCanonicalUrl('https://example.com:8443/api');
    assert.ok(explicit);
    assert.equal(explicit!.port, '8443');

    const canonicalStr = toCanonicalString(explicit!);
    assert.equal(canonicalStr, 'https://example.com:8443/api');
  });

  it('Normalizes path relative traversal without throwing', () => {
    const url = parseCanonicalUrl('https://example.com/a/b/../c');
    assert.ok(url);
    assert.equal(url!.pathname, '/a/c');
    assert.deepEqual(url!.pathSegments, ['a', 'c']);
  });

  it('Rejects non-web protocols safely (never throws)', () => {
    assert.equal(parseCanonicalUrl('javascript:alert(1)'), null);
    assert.equal(parseCanonicalUrl('data:text/html,bad'), null);
    assert.equal(parseCanonicalUrl('file:///etc/passwd'), null);
    assert.equal(parseCanonicalUrl('chrome://settings'), null);
    assert.equal(parseCanonicalUrl('moz-extension://uuid/page.html'), null);
  });

  it('Rejects malformed URL strings safely', () => {
    assert.equal(parseCanonicalUrl(''), null);
    assert.equal(parseCanonicalUrl('   '), null);
    assert.equal(parseCanonicalUrl('not-a-valid-url'), null);
    assert.equal(parseCanonicalUrl(null), null);
    assert.equal(parseCanonicalUrl(undefined), null);
    assert.equal(parseCanonicalUrl(12345 as any), null);
  });
});
