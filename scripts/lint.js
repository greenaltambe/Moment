/**
 * Moment Architectural Invariant Linter
 * Enforces constitutional rules across the source code.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'src');

console.log('=== MOMENT ARCHITECTURAL LINTER ===');

let errorCount = 0;

function reportError(file, message) {
  console.error(`[LINT_FAIL] ${path.relative(ROOT_DIR, file)}: ${message}`);
  errorCount++;
}

// 1. Invariant: Core MUST NOT import browser APIs or browser adapters
function checkCoreIsolation(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      checkCoreIsolation(fullPath);
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
      const content = fs.readFileSync(fullPath, 'utf8');

      // Check forbidden imports
      if (/from\s+['"][^'"]*browser[^'"]*['"]/.test(content)) {
        reportError(fullPath, 'Core module imports from browser adapter layer!');
      }

      // Check forbidden browser API globals
      if (/\bchrome\./.test(content) || /\bbrowser\./.test(content)) {
        reportError(fullPath, 'Core module contains direct reference to chrome.* or browser.* API!');
      }
    }
  }
}

checkCoreIsolation(path.join(SRC_DIR, 'core'));

// 2. Invariant: Strict CSP for UI Pages (no inline scripts, no eval)
function checkUiSecurity(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      checkUiSecurity(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      const content = fs.readFileSync(fullPath, 'utf8');

      // Inline script detection: <script> not having src=
      const inlineScriptMatch = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
      let match;
      while ((match = inlineScriptMatch.exec(content)) !== null) {
        if (match[1].trim().length > 0) {
          reportError(fullPath, 'HTML page contains inline script! Violates strict CSP.');
        }
      }

      // Inline style attribute detection: style="..." or style='...' (violates strict CSP style-src 'self')
      if (/\bstyle\s*=\s*['"]/i.test(content)) {
        reportError(fullPath, 'HTML page contains inline style attribute! Violates strict CSP (style-src \'self\').');
      }
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (/\beval\(/.test(content) || /\bnew\s+Function\(/.test(content)) {
        reportError(fullPath, 'Use of eval() or new Function() is strictly forbidden.');
      }
    }
  }
}

checkUiSecurity(SRC_DIR);

// 3. Invariant: Intervention navigation must strictly use location.replace (never location.href/assign/open)
function checkLocationReplaceInvariant() {
  const interveneFile = path.join(SRC_DIR, 'ui', 'intervene', 'intervene.ts');
  if (fs.existsSync(interveneFile)) {
    const content = fs.readFileSync(interveneFile, 'utf8');
    if (!content.includes('window.location.replace(')) {
      reportError(interveneFile, 'Intervention controller must use window.location.replace to avoid Back-button trap!');
    }
    if (/window\.location\.href\s*=/.test(content)) {
      reportError(interveneFile, 'Forbidden window.location.href assignment detected in intervention controller!');
    }
    if (/window\.location\.assign\(/.test(content)) {
      reportError(interveneFile, 'Forbidden window.location.assign() detected in intervention controller!');
    }
    if (/window\.open\(/.test(content)) {
      reportError(interveneFile, 'Forbidden window.open() detected in intervention controller!');
    }
  }
}

checkLocationReplaceInvariant();

// 4. Invariant: AMO Compliance — Firefox manifest data collection & version compatibility
function checkFirefoxManifestDataCollectionInvariant() {
  const ffManifestPath = path.join(ROOT_DIR, 'manifest', 'firefox', 'manifest.json');
  if (fs.existsSync(ffManifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(ffManifestPath, 'utf8'));
      const geckoSettings = manifest.browser_specific_settings?.gecko;
      if (!geckoSettings) {
        reportError(ffManifestPath, 'Missing browser_specific_settings.gecko');
        return;
      }
      const dataPerms = geckoSettings.data_collection_permissions;
      if (!dataPerms) {
        reportError(ffManifestPath, 'Missing data_collection_permissions property in browser_specific_settings.gecko (required by AMO)');
        return;
      }
      if (!Array.isArray(dataPerms.required) || !dataPerms.required.includes('none') || dataPerms.required.length !== 1) {
        reportError(ffManifestPath, 'data_collection_permissions.required must be ["none"] to reflect zero-telemetry invariant');
      }

      // Check strict_min_version compatibility for data_collection_permissions
      const geckoMin = parseFloat(geckoSettings.strict_min_version || '0');
      if (geckoMin < 140.0) {
        reportError(ffManifestPath, `gecko.strict_min_version must be >= 140.0 (got ${geckoSettings.strict_min_version}) for data_collection_permissions compatibility`);
      }

      const androidSettings = manifest.browser_specific_settings?.gecko_android;
      if (!androidSettings || parseFloat(androidSettings.strict_min_version || '0') < 142.0) {
        reportError(ffManifestPath, 'gecko_android.strict_min_version must be >= 142.0 for data_collection_permissions compatibility');
      }
    } catch (e) {
      reportError(ffManifestPath, `Failed to parse Firefox manifest: ${e.message}`);
    }
  }
}

checkFirefoxManifestDataCollectionInvariant();

// 5. Invariant: AMO Security Compliance — Zero innerHTML usage across all source files
function checkZeroInnerHTMLInvariant(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      checkZeroInnerHTMLInvariant(fullPath);
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (/\.innerHTML\b/.test(content)) {
        reportError(fullPath, 'Forbidden use of .innerHTML! Use document.createElement, textContent, or replaceChildren.');
      }
    }
  }
}

checkZeroInnerHTMLInvariant(SRC_DIR);

if (errorCount > 0) {
  console.error(`\n[LINT] FAILED with ${errorCount} error(s).`);
  process.exit(1);
} else {
  console.log('[LINT] PASSED: All architectural invariants verified (Core isolation, Strict CSP, No eval, Location.replace, AMO data_collection_permissions, Zero innerHTML).');
  process.exit(0);
}
