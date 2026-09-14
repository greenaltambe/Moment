const net = require('net');
const { spawn } = require('child_process');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== STARTING MOMENT INTERVENTION ROUTING TEST SUITE ===');

  const server = spawn('node', ['/home/greenaltambe/Projects/Moment/spike_harness/test_server.js']);
  await sleep(1000);

  const ff = spawn('firefox', [
    '--headless',
    '--no-remote',
    '--profile', '/tmp/ff_prof',
    '--marionette'
  ], {
    env: {
      ...process.env,
      MOZ_DISABLE_CONTENT_SANDBOX: '1',
      MOZ_HEADLESS: '1'
    }
  });

  await sleep(2500);

  const client = net.createConnection({ port: 2828 });
  let msgId = 1;
  const pending = new Map();

  function send(name, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      pending.set(id, { resolve, reject });
      const payload = JSON.stringify([0, id, name, params]);
      client.write(`${payload.length}:${payload}`);
    });
  }

  let buffer = '';
  client.on('data', data => {
    buffer += data.toString();
    while (true) {
      const idx = buffer.indexOf(':');
      if (idx === -1) break;
      const len = parseInt(buffer.substring(0, idx), 10);
      if (isNaN(len)) { buffer = ''; break; }
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
            if (err) reject(err); else resolve(result);
          }
        }
      } catch (e) {
        console.error('Parse error:', e);
      }
    }
  });

  await sleep(1000);
  await send('WebDriver:NewSession');
  await send('Addon:Install', { path: '/tmp/moment_spike.xpi', temporary: true });

  const results = {};

  function getElId(res) {
    return res.value['element-6066-11e4-a52e-4f735466cecf'] || res.value;
  }

  // --- TEST 1: Direct Address Bar Navigation ---
  console.log('\n[TEST 1] Direct Address Bar Navigation...');
  await send('WebDriver:Navigate', { url: 'http://127.0.0.1:8080/target' });
  await sleep(1200);
  let url = (await send('WebDriver:GetCurrentURL')).value;
  if (url.includes('intervene.html') && url.includes('target=http%3A%2F%2F127.0.0.1%3A8080%2Ftarget')) {
    results['TEST 1'] = 'PASS';
    console.log('Result: PASS (Routed to intervene.html, target preserved)');
  } else {
    results['TEST 1'] = 'FAIL';
    console.log('Result: FAIL, url:', url);
  }

  // --- TEST 10: Intervention Completion ---
  console.log('\n[TEST 10] Intervention Completion & Resume Navigation...');
  let btn = await send('WebDriver:FindElement', { using: 'id', value: 'btnComplete' });
  await send('WebDriver:ElementClick', { id: getElId(btn) });
  await sleep(1500);
  url = (await send('WebDriver:GetCurrentURL')).value;
  let title = (await send('WebDriver:GetTitle')).value;
  if (url === 'http://127.0.0.1:8080/target' && title.includes('Managed Target')) {
    results['TEST 10'] = 'PASS';
    console.log('Result: PASS (Reached destination without loop)');
  } else {
    results['TEST 10'] = 'FAIL';
    console.log('Result: FAIL, url:', url);
  }

  // --- TEST 2: In-Page Link Navigation ---
  console.log('\n[TEST 2] In-Page Link Click from Unmanaged Page...');
  await send('WebDriver:Navigate', { url: 'http://127.0.0.1:8080/unmanaged' });
  await sleep(1000);
  let link = await send('WebDriver:FindElement', { using: 'id', value: 'linkToTarget' });
  await send('WebDriver:ElementClick', { id: getElId(link) });
  await sleep(1200);
  url = (await send('WebDriver:GetCurrentURL')).value;
  if (url.includes('intervene.html')) {
    results['TEST 2'] = 'PASS';
    console.log('Result: PASS (Link click intercepted and routed to intervene.html)');
  } else {
    results['TEST 2'] = 'FAIL';
    console.log('Result: FAIL, url:', url);
  }

  // --- TEST 11: Cancellation / Turn Back ---
  console.log('\n[TEST 11] Cancellation (Turn Back)...');
  let cancelBtn = await send('WebDriver:FindElement', { using: 'id', value: 'btnCancel' });
  await send('WebDriver:ElementClick', { id: getElId(cancelBtn) });
  await sleep(1200);
  url = (await send('WebDriver:GetCurrentURL')).value;
  if (url === 'http://127.0.0.1:8080/unmanaged' || url === 'about:blank') {
    results['TEST 11'] = 'PASS';
    console.log('Result: PASS (Safely returned to unmanaged page/blank on cancel)');
  } else {
    results['TEST 11'] = 'FAIL';
    console.log('Result: FAIL, url:', url);
  }

  // --- TEST 4: HTTP 302 Redirect ---
  console.log('\n[TEST 4] HTTP 302 Redirect (/redirect -> /target)...');
  await send('WebDriver:Navigate', { url: 'http://127.0.0.1:8080/redirect' });
  await sleep(1200);
  url = (await send('WebDriver:GetCurrentURL')).value;
  if (url.includes('intervene.html') && url.includes('target=')) {
    results['TEST 4'] = 'PASS';
    console.log('Result: PASS (HTTP 302 redirect intercepted cleanly into intervention)');
  } else {
    results['TEST 4'] = 'FAIL';
    console.log('Result: FAIL, url:', url);
  }

  // --- TEST 5: History Back/Forward ---
  console.log('\n[TEST 5] History Back / Forward Trap Check...');
  await send('WebDriver:Navigate', { url: 'http://127.0.0.1:8080/unmanaged' });
  await sleep(800);
  await send('WebDriver:Navigate', { url: 'http://127.0.0.1:8080/target' });
  await sleep(1200);
  url = (await send('WebDriver:GetCurrentURL')).value;
  console.log('Current URL on intervention:', url);
  // Execute back
  await send('WebDriver:Back');
  await sleep(1200);
  url = (await send('WebDriver:GetCurrentURL')).value;
  console.log('URL after Back:', url);
  if (url === 'http://127.0.0.1:8080/unmanaged') {
    results['TEST 5'] = 'PASS';
    console.log('Result: PASS (Back cleanly returns to unmanaged page without loop trap)');
  } else {
    results['TEST 5'] = 'FAIL';
    console.log('Result: FAIL, url:', url);
  }

  // --- TEST 6: SPA PushState Navigation ---
  console.log('\n[TEST 6] SPA pushState Navigation Test...');
  await send('WebDriver:Navigate', { url: 'http://127.0.0.1:8080/spa' });
  await sleep(800);
  let pushBtn = await send('WebDriver:FindElement', { using: 'id', value: 'btnPushState' });
  await send('WebDriver:ElementClick', { id: getElId(pushBtn) });
  await sleep(800);
  url = (await send('WebDriver:GetCurrentURL')).value;
  console.log('URL after pushState:', url);
  if (url === 'http://127.0.0.1:8080/target') {
    // Top-level listener did not intercept client-side pushState!
    results['TEST 6'] = 'DOCUMENTED_LIMITATION_PASS';
    console.log('Result: DOCUMENTED_LIMITATION_PASS (SPA pushState not intercepted without content script, as specified for V1)');
  } else if (url.includes('intervene.html')) {
    results['TEST 6'] = 'PASS_INTERCEPTED';
    console.log('Result: PASS_INTERCEPTED');
  }

  // --- TEST 13: Malformed / Nonce Tampering ---
  console.log('\n[TEST 13] Malformed Nonce / Tampering Test...');
  await send('WebDriver:Navigate', { url: 'http://127.0.0.1:8080/target' });
  await sleep(1200);
  let interveneUrl = (await send('WebDriver:GetCurrentURL')).value;
  // Modify URL to forge a fake nonce
  let tamperedUrl = interveneUrl.replace(/nonce=[^&]+/, 'nonce=FORGED_NONCE_999');
  await send('WebDriver:Navigate', { url: tamperedUrl });
  await sleep(800);
  btn = await send('WebDriver:FindElement', { using: 'id', value: 'btnComplete' });
  await send('WebDriver:ElementClick', { id: getElId(btn) });
  await sleep(1000);
  let statusText = (await send('WebDriver:FindElement', { using: 'id', value: 'status' }));
  let text = (await send('WebDriver:GetElementText', { id: getElId(statusText) })).value;
  console.log('Status after tampering attempt:', text);
  if (text.includes('failed') || text.includes('Invalid or forged nonce')) {
    results['TEST 13'] = 'PASS';
    console.log('Result: PASS (Forged nonce rejected, destination access denied)');
  } else {
    results['TEST 13'] = 'FAIL';
    console.log('Result: FAIL, status text:', text);
  }

  // --- TEST 12: Expired Grant Test ---
  console.log('\n[TEST 12] Expired Grant Test...');
  // Complete a valid intervention first
  await send('WebDriver:Navigate', { url: 'http://127.0.0.1:8080/target' });
  await sleep(1200);
  btn = await send('WebDriver:FindElement', { using: 'id', value: 'btnComplete' });
  await send('WebDriver:ElementClick', { id: getElId(btn) });
  await sleep(1500);
  url = (await send('WebDriver:GetCurrentURL')).value;
  console.log('Destination reached:', url);

  // Now manually expire the grant via background command
  console.log('Expiring grant in background...');
  await send('WebDriver:ExecuteScript', {
    script: 'chrome.runtime.sendMessage({ action: "EXPIRE_GRANT_NOW", tabId: 1 });'
  });
  await sleep(500);

  // Re-navigate to target
  console.log('Re-navigating to target after expiration...');
  await send('WebDriver:Navigate', { url: 'http://127.0.0.1:8080/target' });
  await sleep(1200);
  url = (await send('WebDriver:GetCurrentURL')).value;
  console.log('URL after re-navigation:', url);
  if (url.includes('intervene.html')) {
    results['TEST 12'] = 'PASS';
    console.log('Result: PASS (Expired grant requires fresh intervention)');
  } else {
    results['TEST 12'] = 'FAIL';
    console.log('Result: FAIL, url:', url);
  }

  // --- TEST 14: Redirect Loop Check ---
  console.log('\n[TEST 14] Redirect Loop Check...');
  // Ensure that completing intervention repeatedly never creates an infinite loop
  await send('WebDriver:Navigate', { url: 'http://127.0.0.1:8080/target' });
  await sleep(1000);
  btn = await send('WebDriver:FindElement', { using: 'id', value: 'btnComplete' });
  await send('WebDriver:ElementClick', { id: getElId(btn) });
  await sleep(1500);
  url = (await send('WebDriver:GetCurrentURL')).value;
  if (url === 'http://127.0.0.1:8080/target') {
    results['TEST 14'] = 'PASS';
    console.log('Result: PASS (Stable destination reached, zero redirect loops)');
  } else {
    results['TEST 14'] = 'FAIL';
  }

  console.log('\n=== SUMMARY OF EMPIRICAL SPIKE RESULTS ON FIREFOX DESKTOP ===');
  console.table(results);

  client.destroy();
  ff.kill();
  server.kill();
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error in suite:', err);
  process.exit(1);
});
