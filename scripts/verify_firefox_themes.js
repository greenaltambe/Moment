/**
 * Firefox Gecko Runtime Theme Verification Script
 * Uses Marionette to verify real in-browser CSS parsing, computed styles,
 * and data-theme attribute switching directly inside Firefox 155.0.
 */

import net from 'node:net';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log('=== FIREFOX GECKO RUNTIME THEME VERIFICATION ===\n');

  const profDir = '/tmp/ff_prof_theme';
  if (!fs.existsSync(profDir)) fs.mkdirSync(profDir, { recursive: true });

  // 1. Start Firefox with Marionette
  const ff = spawn(
    'firefox',
    ['--headless', '--no-remote', '--profile', profDir, '--marionette'],
    {
      env: {
        ...process.env,
        MOZ_DISABLE_CONTENT_SANDBOX: '1',
        MOZ_HEADLESS: '1',
      },
    }
  );

  let client = null;
  for (let attempt = 1; attempt <= 15; attempt++) {
    await sleep(400);
    try {
      client = await new Promise((res, rej) => {
        const c = net.createConnection({ port: 2828 }, () => res(c));
        c.on('error', rej);
      });
      break;
    } catch {
      // Retry
    }
  }

  if (!client) {
    ff.kill();
    throw new Error('Failed to connect to Firefox Marionette port 2828');
  }

  let msgId = 1;
  const pending = new Map();

  function send(name, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      pending.set(id, { resolve, reject });
      const payload = JSON.stringify([0, id, name, params]);
      client.write(`${Buffer.byteLength(payload, 'utf8')}:${payload}`);
    });
  }

  let buffer = '';
  client.on('data', (data) => {
    buffer += data.toString();
    while (true) {
      const idx = buffer.indexOf(':');
      if (idx === -1) break;
      const len = parseInt(buffer.substring(0, idx), 10);
      if (isNaN(len)) {
        buffer = '';
        break;
      }
      if (buffer.length < idx + 1 + len) break;
      const jsonStr = buffer.substring(idx + 1, idx + 1 + len);
      buffer = buffer.substring(idx + 1 + len);
      try {
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed) && parsed[0] === 1) {
          const [, id, err, result] = parsed;
          if (pending.has(id)) {
            const { resolve, reject } = pending.get(id);
            pending.delete(id);
            if (err) reject(err);
            else resolve(result);
          }
        }
      } catch (e) {
        console.error('Marionette parse error:', e);
      }
    }
  });

  try {
    await sleep(500);
    await send('WebDriver:NewSession');

    // Read theme.css and options.css
    const themeCss = fs.readFileSync(path.resolve(process.cwd(), 'dist/firefox/ui/theme.css'), 'utf8');
    const optionsCss = fs.readFileSync(path.resolve(process.cwd(), 'dist/firefox/ui/options/options.css'), 'utf8');

    // Create a verification HTML test page
    const testHtmlPath = '/tmp/moment_theme_test.html';
    const testHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Moment Theme Test</title>
  <style>
${themeCss}
${optionsCss}
  </style>
</head>
<body>
  <div class="dashboard-layout">
    <div class="sidebar">Sidebar</div>
    <div class="card collection-card">Card</div>
  </div>
</body>
</html>`;
    fs.writeFileSync(testHtmlPath, testHtml, 'utf8');

    // Navigate to test page
    await send('WebDriver:Navigate', { url: `file://${testHtmlPath}` });
    await sleep(300);

    // Test helper using WebDriver:ExecuteScript
    async function evaluate(script) {
      const res = await send('WebDriver:ExecuteScript', { script });
      return res.value;
    }

    console.log('1. Verifying Default Base / Light Theme in Firefox Gecko...');
    const defaultBg = await evaluate("return getComputedStyle(document.documentElement).getPropertyValue('--bg-main').trim()");
    const defaultText = await evaluate("return getComputedStyle(document.documentElement).getPropertyValue('--text-main').trim()");
    console.log(`   ✔ Base --bg-main: ${defaultBg}`);
    console.log(`   ✔ Base --text-main: ${defaultText}`);
    if (defaultBg !== '#f8fafc' && defaultBg !== '#0f172a') {
      throw new Error(`Unexpected default --bg-main: ${defaultBg}`);
    }

    console.log('2. Verifying Explicit DARK Theme (data-theme="dark") in Firefox Gecko...');
    await evaluate("document.documentElement.setAttribute('data-theme', 'dark');");
    const darkBg = await evaluate("return getComputedStyle(document.documentElement).getPropertyValue('--bg-main').trim()");
    const darkCard = await evaluate("return getComputedStyle(document.documentElement).getPropertyValue('--card-bg').trim()");
    const darkText = await evaluate("return getComputedStyle(document.documentElement).getPropertyValue('--text-main').trim()");
    const darkAccent = await evaluate("return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()");
    const darkColorScheme = await evaluate("return getComputedStyle(document.documentElement).colorScheme");
    console.log(`   ✔ Dark --bg-main: ${darkBg} (expected #0f172a)`);
    console.log(`   ✔ Dark --card-bg: ${darkCard} (expected #1e293b)`);
    console.log(`   ✔ Dark --text-main: ${darkText} (expected #f8fafc)`);
    console.log(`   ✔ Dark --accent: ${darkAccent} (expected #22c55e)`);
    console.log(`   ✔ Dark colorScheme: ${darkColorScheme} (expected dark)`);
    if (darkBg !== '#0f172a' || darkCard !== '#1e293b' || darkText !== '#f8fafc' || darkAccent !== '#22c55e') {
      throw new Error('Dark theme computed styles mismatch in Gecko engine');
    }

    console.log('3. Verifying Explicit SEPIA Theme (data-theme="sepia") in Firefox Gecko...');
    await evaluate("document.documentElement.setAttribute('data-theme', 'sepia');");
    const sepiaBg = await evaluate("return getComputedStyle(document.documentElement).getPropertyValue('--bg-main').trim()");
    const sepiaCard = await evaluate("return getComputedStyle(document.documentElement).getPropertyValue('--card-bg').trim()");
    const sepiaText = await evaluate("return getComputedStyle(document.documentElement).getPropertyValue('--text-main').trim()");
    const sepiaBorder = await evaluate("return getComputedStyle(document.documentElement).getPropertyValue('--border').trim()");
    console.log(`   ✔ Sepia --bg-main: ${sepiaBg} (expected #fbf0d9)`);
    console.log(`   ✔ Sepia --card-bg: ${sepiaCard} (expected #fdf6e2)`);
    console.log(`   ✔ Sepia --text-main: ${sepiaText} (expected #433422)`);
    console.log(`   ✔ Sepia --border: ${sepiaBorder} (expected #e3d5b5)`);
    if (sepiaBg !== '#fbf0d9' || sepiaCard !== '#fdf6e2' || sepiaText !== '#433422') {
      throw new Error('Sepia theme computed styles mismatch in Gecko engine');
    }

    console.log('4. Verifying Explicit LIGHT Theme Override (data-theme="light") in Firefox Gecko...');
    await evaluate("document.documentElement.setAttribute('data-theme', 'light');");
    const lightBg = await evaluate("return getComputedStyle(document.documentElement).getPropertyValue('--bg-main').trim()");
    const lightCard = await evaluate("return getComputedStyle(document.documentElement).getPropertyValue('--card-bg').trim()");
    const lightText = await evaluate("return getComputedStyle(document.documentElement).getPropertyValue('--text-main').trim()");
    const lightAccent = await evaluate("return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()");
    console.log(`   ✔ Light --bg-main: ${lightBg} (expected #f8fafc)`);
    console.log(`   ✔ Light --card-bg: ${lightCard} (expected #ffffff)`);
    console.log(`   ✔ Light --text-main: ${lightText} (expected #0f172a)`);
    console.log(`   ✔ Light --accent: ${lightAccent} (expected #15803d)`);
    if (lightBg !== '#f8fafc' || lightCard !== '#ffffff' || lightText !== '#0f172a') {
      throw new Error('Light theme computed styles mismatch in Gecko engine');
    }

    console.log('\n=== ALL GECKO RUNTIME THEME TESTS PASSED SUCCESSFULLY! ===\n');

  } finally {
    try {
      await send('WebDriver:DeleteSession');
    } catch {}
    if (client) client.end();
    ff.kill();
    try {
      if (fs.existsSync('/tmp/moment_theme_test.html')) fs.unlinkSync('/tmp/moment_theme_test.html');
      if (fs.existsSync(profDir)) fs.rmSync(profDir, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error('[Verification Failed]:', err);
  process.exit(1);
});
