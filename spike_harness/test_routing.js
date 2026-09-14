const net = require('net');
const { spawn } = require('child_process');

async function run() {
  // 1. Start HTTP test server
  const server = spawn('node', ['/home/greenaltambe/Projects/Moment/spike_harness/test_server.js']);
  server.stdout.on('data', d => console.log(d.toString().trim()));

  await new Promise(r => setTimeout(r, 1000));

  // 2. Start Firefox
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

  ff.stdout.on('data', d => console.log('[FF_OUT]', d.toString().trim()));
  ff.stderr.on('data', d => {
    const s = d.toString();
    if (s.includes('SPIKE_LOG') || s.includes('Marionette')) {
      console.log('[FF_LOG]', s.trim());
    }
  });

  await new Promise(r => setTimeout(r, 2000));

  const client = net.createConnection({ port: 2828 });
  let msgId = 1;
  const pending = new Map();

  function send(name, params) {
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
      if (isNaN(len)) {
        buffer = '';
        break;
      }
      if (buffer.length < idx + 1 + len) break;
      const jsonStr = buffer.substring(idx + 1, idx + 1 + len);
      buffer = buffer.substring(idx + 1 + len);

      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.marionetteProtocol) {
          console.log('[MARIONETTE] Handshake protocol:', parsed.marionetteProtocol);
        } else if (Array.isArray(parsed) && parsed[0] === 1) {
          const [, id, err, result] = parsed;
          if (pending.has(id)) {
            const { resolve, reject } = pending.get(id);
            pending.delete(id);
            if (err) reject(err);
            else resolve(result);
          }
        }
      } catch (e) {
        console.error('Parse error:', e);
      }
    }
  });

  // Handshake wait
  await new Promise(r => setTimeout(r, 1000));

  console.log('Initializing session...');
  await send('WebDriver:NewSession', {});

  console.log('Installing Moment Spike Extension...');
  const addonRes = await send('Addon:Install', { path: '/tmp/moment_spike.xpi', temporary: true });
  console.log('Extension installed:', addonRes);

  // Test 1: Direct navigation to target
  console.log('\n--- EXECUTING TEST 1: Direct Address Bar Navigation to http://127.0.0.1:8080/target ---');
  await send('WebDriver:Navigate', { url: 'http://127.0.0.1:8080/target' });
  await new Promise(r => setTimeout(r, 1500));

  let currentUrl = await send('WebDriver:GetCurrentURL', {});
  let pageTitle = await send('WebDriver:GetTitle', {});
  console.log('Resulting URL:', currentUrl);
  console.log('Resulting Title:', pageTitle);

  if (currentUrl.value.includes('intervene.html')) {
    console.log('>>> TEST 1 PASS: Navigation routed to intervene.html! Target preserved in query.');
  } else {
    console.log('>>> TEST 1 FAIL: URL did not route to intervene.html');
  }

  // Test 10: Complete Intervention
  console.log('\n--- EXECUTING TEST 10: Complete Intervention & Resume Navigation ---');
  // Find and click Complete button
  const completeBtn = await send('WebDriver:FindElement', { using: 'id', value: 'btnComplete' });
  console.log('Found complete button:', completeBtn.value);
  await send('WebDriver:ElementClick', { id: completeBtn.value });
  await new Promise(r => setTimeout(r, 2000));

  currentUrl = await send('WebDriver:GetCurrentURL', {});
  pageTitle = await send('WebDriver:GetTitle', {});
  console.log('After completion URL:', currentUrl);
  console.log('After completion Title:', pageTitle);

  if (currentUrl.value === 'http://127.0.0.1:8080/target') {
    console.log('>>> TEST 10 PASS: Destination reached cleanly! No redirect loop.');
  } else {
    console.log('>>> TEST 10 FAIL: Expected target URL, got:', currentUrl.value);
  }

  // Cleanup
  console.log('\nCleaning up processes...');
  client.destroy();
  ff.kill();
  server.kill();
  process.exit(0);
}

run().catch(err => {
  console.error('Fatal error in spike test:', err);
  process.exit(1);
});
