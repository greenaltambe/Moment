/**
 * Moment Test Runner
 * Executes unit and integration test suites using Node's native test runner.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

console.log('=== MOMENT TEST RUNNER ===');

const testsDir = path.resolve(process.cwd(), 'tests/unit');
const testFiles = fs.readdirSync(testsDir)
  .filter(f => f.endsWith('.test.ts'))
  .map(f => path.join('tests/unit', f));

console.log(`Discovered ${testFiles.length} test suite(s). Executing...\n`);

const runner = spawn('node', [
  '--experimental-strip-types',
  '--test',
  ...testFiles,
], {
  stdio: 'inherit',
});

runner.on('close', (code) => {
  if (code === 0) {
    console.log('\n[Test] PASSED: All test suites completed successfully.');
    process.exit(0);
  } else {
    console.error(`\n[Test] FAILED with exit code ${code}.`);
    process.exit(code || 1);
  }
});
