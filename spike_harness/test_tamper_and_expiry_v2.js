const net = require('net');
const { spawn } = require('child_process');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
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

  function getElId(res) {
    return res.value['element-6066-11e4-a52e-4f735466cecf'] || res.value;
  }

  // --- TEST 13: Tampering Test ---
  console.log('[TEST 13] Nonce Tampering Test Running...');
  await send('WebDriver:Navigate', { url: 'http://127.0.0.1:8080/target' });
  await sleep(1200);

  let tamperBtn = await send('WebDriver:FindElement', { using: 'id', value: 'btnTamper' });
  await send('WebDriver:ElementClick', { id: getElId(tamperBtn) });
  await sleep(800);

  let statusEl = await send('WebDriver:FindElement', { using: 'id', value: 'status' });
  let statusText = (await send('WebDriver:GetElementText', { id: getElId(statusEl) })).value;
  console.log('Status element text:', statusText);

  if (statusText.includes('REJECTED')) {
    console.log('>>> TEST 13 PASS: Tampered nonce was explicitly REJECTED by background validator!');
  } else {
    console.log('>>> TEST 13 FAIL: Tampered nonce was not rejected.');
  }

  // --- TEST 12: Expired Grant Test ---
  console.log('\n[TEST 12] Expired Grant Test Running...');
  let shortBtn = await send('WebDriver:FindElement', { using: 'id', value: 'btnShortGrant' });
  await send('WebDriver:ElementClick', { id: getElId(shortBtn) });
  await sleep(1200);

  let immediateUrl = (await send('WebDriver:GetCurrentURL')).value;
  console.log('Immediate load (within 1s):', immediateUrl);

  console.log('Waiting 1.5s for 1-second grant to expire...');
  await sleep(1500);

  console.log('Re-navigating to target after expiration...');
  await send('WebDriver:Navigate', { url: 'http://127.0.0.1:8080/target' });
  await sleep(1200);

  let expiredUrl = (await send('WebDriver:GetCurrentURL')).value;
  console.log('URL after expiration:', expiredUrl);

  if (expiredUrl.includes('intervene.html')) {
    console.log('>>> TEST 12 PASS: Expired grant correctly intercepted; fresh intervention required!');
  } else {
    console.log('>>> TEST 12 FAIL: Expired grant allowed access.');
  }

  client.destroy();
  ff.kill();
  server.kill();
}

main().catch(e => { console.error(e); process.exit(1); });
