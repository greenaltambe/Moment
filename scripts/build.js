/**
 * Moment Multi-Browser Build Script
 * Transpiles TypeScript source and builds distribution packages for Chrome and Firefox.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('/usr/share/code/resources/app/extensions/node_modules/typescript/lib/typescript.js');

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'src');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const TARGETS = ['chrome', 'firefox'];

console.log('=== MOMENT BUILD SYSTEM (Phase 1) ===');

// 1. Clean and prepare dist directories
for (const target of TARGETS) {
  const targetDir = path.join(DIST_DIR, target);
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(targetDir, { recursive: true });
}

// 2. Transpile and copy files recursively
function processDirectory(currentSrcDir, relativeSubPath = '') {
  const entries = fs.readdirSync(currentSrcDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullSrcPath = path.join(currentSrcDir, entry.name);
    const entryRelativePath = path.join(relativeSubPath, entry.name);

    if (entry.isDirectory()) {
      for (const target of TARGETS) {
        fs.mkdirSync(path.join(DIST_DIR, target, entryRelativePath), { recursive: true });
      }
      processDirectory(fullSrcPath, entryRelativePath);
    } else if (entry.isFile()) {
      if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        // Transpile TypeScript to JavaScript
        const sourceCode = fs.readFileSync(fullSrcPath, 'utf8');
        const transpiled = ts.transpileModule(sourceCode, {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            removeComments: false,
          },
          fileName: entry.name,
        });

        const jsName = entry.name.replace(/\.ts$/, '.js');
        const jsRelativePath = path.join(relativeSubPath, jsName);

        for (const target of TARGETS) {
          const outPath = path.join(DIST_DIR, target, jsRelativePath);
          fs.writeFileSync(outPath, transpiled.outputText, 'utf8');
        }
      } else if (!entry.name.endsWith('.d.ts')) {
        // Copy asset (HTML, CSS, JSON) as-is
        for (const target of TARGETS) {
          const outPath = path.join(DIST_DIR, target, entryRelativePath);
          fs.copyFileSync(fullSrcPath, outPath);
        }
      }
    }
  }
}

processDirectory(SRC_DIR);

// 3. Copy Target Manifests
for (const target of TARGETS) {
  const manifestSrc = path.join(ROOT_DIR, 'manifest', target, 'manifest.json');
  const manifestDest = path.join(DIST_DIR, target, 'manifest.json');

  if (fs.existsSync(manifestSrc)) {
    fs.copyFileSync(manifestSrc, manifestDest);
    console.log(`[Build] Applied ${target} manifest.json`);
  } else {
    console.error(`[Build] ERROR: Missing manifest for ${target} at ${manifestSrc}`);
    process.exit(1);
  }
}

console.log('\n[Build] SUCCESS: Distribution bundles created:');
console.log(`  • Chrome MV3:  ${path.join(DIST_DIR, 'chrome')}`);
console.log(`  • Firefox MV3: ${path.join(DIST_DIR, 'firefox')}`);
