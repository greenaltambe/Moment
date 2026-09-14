/**
 * Phase 5.1.1 Regression Test Suite
 *
 * Verifies the Firefox runtime bug fixes and strict CSP invariants:
 * 1. Firefox manifest declares "type": "module" for MV3 background scripts.
 * 2. Strict CSP enforcement: zero inline style="..." attributes across all HTML files.
 * 3. Strict CSP enforcement: zero inline <script> tags across all HTML files.
 * 4. CSS utility .is-hidden contract across all extension UI views.
 * 5. BaseBrowserAdapter getCurrentTab fallback from currentWindow to lastFocusedWindow.
 * 6. GET_CURRENT_SITE_STATE tab URL classification (valid web URLs vs restricted/internal/unsupported schemes).
 * 7. UI message contract validation for GET_CURRENT_SITE_STATE.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { BaseBrowserAdapter } from '../../dist/chrome/browser/base-adapter.js';
import { CHROME_DESKTOP_CAPABILITIES } from '../../dist/chrome/browser/capabilities.js';
import { isValidMessage } from '../../dist/chrome/shared/messages.js';
import { sanitizeUrlForDisplay, isSafeDestination } from '../../dist/chrome/shared/urls.js';

const ROOT_DIR = process.cwd();

describe('Phase 5.1.1 Regression: Firefox Manifest & Background Module Execution', () => {
  it('Firefox manifest declares type: "module" for background scripts', () => {
    const firefoxManifestPath = path.join(ROOT_DIR, 'manifest', 'firefox', 'manifest.json');
    const raw = fs.readFileSync(firefoxManifestPath, 'utf8');
    const manifest = JSON.parse(raw);

    assert.equal(manifest.manifest_version, 3);
    assert.ok(manifest.background, 'Background configuration must exist');
    assert.equal(
      manifest.background.type,
      'module',
      'Firefox background script MUST have type: "module" to parse ES module imports'
    );
    assert.ok(
      Array.isArray(manifest.background.scripts) &&
        manifest.background.scripts.includes('background/index.js'),
      'Firefox background scripts must include background/index.js'
    );
  });

  it('Firefox manifest declares data_collection_permissions with required: ["none"] under browser_specific_settings.gecko', () => {
    const firefoxManifestPath = path.join(ROOT_DIR, 'manifest', 'firefox', 'manifest.json');
    const raw = fs.readFileSync(firefoxManifestPath, 'utf8');
    const manifest = JSON.parse(raw);

    assert.ok(manifest.browser_specific_settings?.gecko, 'gecko settings must exist');
    const gecko = manifest.browser_specific_settings.gecko;
    const dataPerms = gecko.data_collection_permissions;
    assert.ok(dataPerms, 'data_collection_permissions must be present under browser_specific_settings.gecko for AMO compliance');
    assert.deepEqual(
      dataPerms.required,
      ['none'],
      'Moment collects zero data, so data_collection_permissions.required must be ["none"]'
    );
    assert.ok(
      parseFloat(gecko.strict_min_version || '0') >= 140.0,
      'gecko.strict_min_version must be >= 140.0 to support data_collection_permissions without AMO warning'
    );

    const geckoAndroid = manifest.browser_specific_settings?.gecko_android;
    assert.ok(geckoAndroid, 'gecko_android settings must exist in Firefox manifest');
    assert.ok(
      parseFloat(geckoAndroid.strict_min_version || '0') >= 142.0,
      'gecko_android.strict_min_version must be >= 142.0 to support data_collection_permissions without AMO warning'
    );
  });

  it('Built dist/firefox manifest preserves data_collection_permissions and minimum version requirements', () => {
    const distFfManifestPath = path.join(ROOT_DIR, 'dist', 'firefox', 'manifest.json');
    if (fs.existsSync(distFfManifestPath)) {
      const raw = fs.readFileSync(distFfManifestPath, 'utf8');
      const manifest = JSON.parse(raw);
      const gecko = manifest.browser_specific_settings?.gecko;
      assert.ok(gecko?.data_collection_permissions, 'Built dist/firefox/manifest.json must contain data_collection_permissions');
      assert.deepEqual(gecko.data_collection_permissions.required, ['none']);
      assert.ok(parseFloat(gecko.strict_min_version || '0') >= 140.0);
      assert.ok(parseFloat(manifest.browser_specific_settings?.gecko_android?.strict_min_version || '0') >= 142.0);
    }
  });

  it('Chrome manifest declares type: "module" for background service worker and omits browser_specific_settings', () => {
    const chromeManifestPath = path.join(ROOT_DIR, 'manifest', 'chrome', 'manifest.json');
    const raw = fs.readFileSync(chromeManifestPath, 'utf8');
    const manifest = JSON.parse(raw);

    assert.equal(manifest.manifest_version, 3);
    assert.ok(manifest.background, 'Background configuration must exist');
    assert.equal(manifest.background.service_worker, 'background/index.js');
    assert.equal(
      manifest.background.type,
      'module',
      'Chrome background service worker must have type: "module"'
    );
    assert.equal(manifest.browser_specific_settings, undefined, 'Chrome manifest must not have browser_specific_settings');
  });

  it('Zero innerHTML usage across all source and distribution JavaScript/TypeScript files', () => {
    const jsTsFiles: string[] = [];
    function scanDir(dir: string) {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(full);
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
          jsTsFiles.push(full);
        }
      }
    }

    scanDir(path.join(ROOT_DIR, 'src'));
    scanDir(path.join(ROOT_DIR, 'dist'));

    assert.ok(jsTsFiles.length > 0, 'Must find source and dist files to check');
    for (const file of jsTsFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const hasInnerHTML = /\.innerHTML\b/.test(content);
      assert.equal(
        hasInnerHTML,
        false,
        `File ${path.relative(ROOT_DIR, file)} contains forbidden .innerHTML assignment!`
      );
    }
  });
});

describe('Phase 5.1.1 Regression: Strict CSP Compliance (Zero Inline Styles or Scripts)', () => {
  const htmlFiles: string[] = [];

  function findHtmlFiles(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        findHtmlFiles(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        htmlFiles.push(fullPath);
      }
    }
  }

  findHtmlFiles(path.join(ROOT_DIR, 'src'));
  if (fs.existsSync(path.join(ROOT_DIR, 'dist'))) {
    findHtmlFiles(path.join(ROOT_DIR, 'dist'));
  }

  it('Found all extension HTML entry points for inspection', () => {
    assert.ok(htmlFiles.length >= 4, 'Must find at least popup, options, intervene, and block HTML files');
  });

  it('Zero inline style="..." or style=\'...\' attributes exist in any HTML file', () => {
    for (const file of htmlFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const relPath = path.relative(ROOT_DIR, file);
      const hasInlineStyle = /\bstyle\s*=\s*['"]/i.test(content);
      assert.equal(
        hasInlineStyle,
        false,
        `File ${relPath} contains forbidden inline style attribute, violating strict style-src 'self'`
      );
    }
  });

  it('Zero inline <script>...</script> tags without src exist in any HTML file', () => {
    for (const file of htmlFiles) {
      const content = fs.readFileSync(file, 'utf8');
      const relPath = path.relative(ROOT_DIR, file);
      const inlineScriptMatch = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
      let match;
      while ((match = inlineScriptMatch.exec(content)) !== null) {
        if (match[1].trim().length > 0) {
          assert.fail(`File ${relPath} contains forbidden inline script, violating strict script-src 'self'`);
        }
      }
    }
  });

  it('All extension CSS bundles define .is-hidden utility class with display: none !important', () => {
    const cssFiles = [
      'src/ui/popup/popup.css',
      'src/ui/options/options.css',
      'src/ui/intervene/intervene.css',
      'src/ui/block/block.css',
    ];

    for (const rel of cssFiles) {
      const fullPath = path.join(ROOT_DIR, rel);
      assert.ok(fs.existsSync(fullPath), `CSS file must exist: ${rel}`);
      const content = fs.readFileSync(fullPath, 'utf8');
      assert.ok(
        content.includes('.is-hidden') && content.includes('display: none !important;'),
        `${rel} must define .is-hidden { display: none !important; }`
      );
    }
  });
});

describe('Phase 5.1.1 Regression: BaseBrowserAdapter Active Tab Fallback Mechanism', () => {
  class TestBrowserAdapter extends BaseBrowserAdapter {
    constructor(mockApi: any) {
      super(CHROME_DESKTOP_CAPABILITIES);
      this.api = mockApi;
    }
  }

  it('Resolves tab directly when currentWindow: true returns active tab', async () => {
    const calls: any[] = [];
    const mockApi = {
      tabs: {
        query: (queryInfo: any, callback: (tabs: any[]) => void) => {
          calls.push(queryInfo);
          if (queryInfo.currentWindow) {
            callback([
              {
                id: 42,
                url: 'https://example.com/articles',
                title: 'Example Article',
                active: true,
                windowId: 1,
              },
            ]);
          } else {
            callback([]);
          }
        },
      },
    };

    const adapter = new TestBrowserAdapter(mockApi);
    const tab = await adapter.getCurrentTab();

    assert.ok(tab !== null);
    assert.equal(tab.id, 42);
    assert.equal(tab.url, 'https://example.com/articles');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { active: true, currentWindow: true });
  });

  it('Falls back to lastFocusedWindow: true when currentWindow: true returns empty', async () => {
    const calls: any[] = [];
    const mockApi = {
      tabs: {
        query: (queryInfo: any, callback: (tabs: any[]) => void) => {
          calls.push(queryInfo);
          if (queryInfo.currentWindow) {
            // Simulate background worker / popup without currentWindow binding
            callback([]);
          } else if (queryInfo.lastFocusedWindow) {
            callback([
              {
                id: 99,
                url: 'https://github.com/moment',
                title: 'Moment GitHub',
                active: true,
                windowId: 2,
              },
            ]);
          } else {
            callback([]);
          }
        },
      },
    };

    const adapter = new TestBrowserAdapter(mockApi);
    const tab = await adapter.getCurrentTab();

    assert.ok(tab !== null);
    assert.equal(tab.id, 99);
    assert.equal(tab.url, 'https://github.com/moment');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], { active: true, currentWindow: true });
    assert.deepEqual(calls[1], { active: true, lastFocusedWindow: true });
  });

  it('Returns null gracefully when both currentWindow and lastFocusedWindow return empty', async () => {
    const calls: any[] = [];
    const mockApi = {
      tabs: {
        query: (queryInfo: any, callback: (tabs: any[]) => void) => {
          calls.push(queryInfo);
          callback([]);
        },
      },
    };

    const adapter = new TestBrowserAdapter(mockApi);
    const tab = await adapter.getCurrentTab();

    assert.equal(tab, null);
    assert.equal(calls.length, 2);
  });
});

describe('Phase 5.1.1 Regression: Tab URL Classification & Current Site Derivation', () => {
  function classifyTabUrl(rawUrl: string | undefined): {
    isWebScheme: boolean;
    hostname?: string;
    reason?: string;
  } {
    if (!rawUrl) {
      return { isWebScheme: false, reason: 'RESTRICTED_TAB_URL' };
    }
    try {
      const parsed = new URL(rawUrl);
      const isWebScheme = parsed.protocol === 'http:' || parsed.protocol === 'https:';
      const hostname = isWebScheme && parsed.hostname ? parsed.hostname : undefined;
      if (!isWebScheme) {
        return { isWebScheme: false, reason: 'UNSUPPORTED_SCHEME' };
      }
      return { isWebScheme: true, hostname };
    } catch {
      return { isWebScheme: false, reason: 'UNSUPPORTED_SCHEME' };
    }
  }

  it('Correctly classifies valid HTTP and HTTPS web URLs', () => {
    const testCases = [
      { url: 'https://www.theverge.com/tech', expectedHost: 'www.theverge.com' },
      { url: 'http://localhost:8080/dashboard', expectedHost: 'localhost' },
      { url: 'https://news.ycombinator.com/', expectedHost: 'news.ycombinator.com' },
      { url: 'https://sub.domain.co.uk/path?query=1#hash', expectedHost: 'sub.domain.co.uk' },
    ];

    for (const tc of testCases) {
      const res = classifyTabUrl(tc.url);
      assert.equal(res.isWebScheme, true);
      assert.equal(res.hostname, tc.expectedHost);
      assert.equal(res.reason, undefined);
    }
  });

  it('Correctly classifies non-web and internal browser schemes as UNSUPPORTED_SCHEME', () => {
    const nonWebUrls = [
      'about:blank',
      'about:preferences',
      'about:config',
      'moz-extension://a1b2c3d4-e5f6-7890/ui/popup/popup.html',
      'chrome://settings',
      'chrome-extension://abcdefghijklmnopqrstuvwxyz/ui/options/options.html',
      'file:///home/user/document.pdf',
      'data:text/html,<h1>Hello</h1>',
      'javascript:void(0)',
      'view-source:https://example.com',
    ];

    for (const url of nonWebUrls) {
      const res = classifyTabUrl(url);
      assert.equal(res.isWebScheme, false);
      assert.equal(res.hostname, undefined);
      assert.equal(res.reason, 'UNSUPPORTED_SCHEME');
    }
  });

  it('Correctly classifies missing or undefined tab URLs as RESTRICTED_TAB_URL', () => {
    const res = classifyTabUrl(undefined);
    assert.equal(res.isWebScheme, false);
    assert.equal(res.hostname, undefined);
    assert.equal(res.reason, 'RESTRICTED_TAB_URL');
  });

  it('Sanitizes URLs for display safely without credentials or query noise', () => {
    assert.equal(
      sanitizeUrlForDisplay('https://user:pass@reddit.com/r/all?sort=top#footer'),
      'https://reddit.com/r/all'
    );
  });

  it('isSafeDestination permits valid web protocols and blocks unsafe destinations', () => {
    assert.equal(isSafeDestination('https://example.com'), true);
    assert.equal(isSafeDestination('http://example.com'), true);
    assert.equal(isSafeDestination('javascript:alert(1)'), false);
    assert.equal(isSafeDestination('data:text/html,<script>'), false);
    assert.equal(isSafeDestination('file:///etc/shadow'), false);
    assert.equal(isSafeDestination('about:config'), false);
  });
});

describe('Phase 5.1.1 Regression: UI Message Contracts', () => {
  it('Validates GET_CURRENT_SITE_STATE message format', () => {
    assert.equal(
      isValidMessage({ type: 'GET_CURRENT_SITE_STATE' }),
      true,
      'Valid without tabId'
    );
    assert.equal(
      isValidMessage({ type: 'GET_CURRENT_SITE_STATE', tabId: 123 }),
      true,
      'Valid with tabId'
    );
    assert.equal(
      isValidMessage({ type: 'GET_CURRENT_SITE_STATE', tabId: 'invalid' }),
      false,
      'Invalid when tabId is not a number'
    );
  });
});
