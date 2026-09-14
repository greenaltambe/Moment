/**
 * Moment Typecheck Runner
 * Runs TypeScript type checking against the project source.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function resolveTypeScript() {
  try {
    return require('typescript');
  } catch {
    try {
      return require('/usr/share/code/resources/app/extensions/node_modules/typescript/lib/typescript.js');
    } catch {
      console.error('[Error] TypeScript not found. Please install dependencies with: npm install');
      process.exit(1);
    }
  }
}

const ts = resolveTypeScript();

console.log(`[Typecheck] Running TypeScript v${ts.version}...`);

const configPath = path.resolve(process.cwd(), 'tsconfig.json');
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);

if (configFile.error) {
  console.error('Error reading tsconfig.json:', configFile.error.messageText);
  process.exit(1);
}

const parsedConfig = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  path.dirname(configPath)
);

const program = ts.createProgram({
  rootNames: parsedConfig.fileNames,
  options: {
    ...parsedConfig.options,
    noEmit: true,
  },
});

const diagnostics = ts.getPreEmitDiagnostics(program);

if (diagnostics.length > 0) {
  console.error(`\n[Typecheck] FAILED: ${diagnostics.length} diagnostic error(s) found:\n`);
  for (const diag of diagnostics) {
    if (diag.file) {
      const { line, character } = ts.getLineAndCharacterOfPosition(diag.file, diag.start);
      const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
      console.error(`${diag.file.fileName} (${line + 1},${character + 1}): ${message}`);
    } else {
      console.error(ts.flattenDiagnosticMessageText(diag.messageText, '\n'));
    }
  }
  process.exit(1);
} else {
  console.log('[Typecheck] PASSED: All source and test files typecheck cleanly.');
  process.exit(0);
}
