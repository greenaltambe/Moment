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

  console.log('[TEST 13] Nonce Tampering Test Running...');
  // Navigate to target to get on intervene.html
  await send('WebDriver:Navigate', { url: 'http://127.0.0.1:8080/target' });
  await sleep(1200);

  // Send message from intervene page with forged nonce
  const tamperRes = await send('WebDriver:ExecuteAsyncScript', {
    script: `
      const callback = arguments[arguments.length - 1];
      chrome.runtime.sendMessage({
        action: 'COMPLETE_INTERVENTION',
        target: 'http://127.0.0.1:8080/target',
        tabId: 1,
        nonce: 'FORGED_INVALID_NONCE_999'
      }, res => callback(res));
    `
  });
  console.log('Background response to tampered nonce:', tamperRes.value);

  if (tamperRes.value && tamperRes.value.status === 'REJECTED') {
    console.log('>>> TEST 13 PASS: Tampered nonce was explicitly REJECTED by background validator!');
  } else {
    console.log('>>> TEST 13 FAIL: Tampered nonce was not rejected!');
  }

  console.log('\n[TEST 12] Expired Grant Test Running...');
  // 1. Complete valid intervention with 1-second grant
  const urlParams = await send('WebDriver:ExecuteScript', {
    script: 'return { target: new URLSearchParams(location.search).get("target"), tabId: new URLSearchParams(location.search).get("tabId"), nonce: new URLSearchParams(location.search).get("nonce") };'
  });
  const { target, tabId, nonce } = urlParams.value;

  console.log('Valid params:', { target, tabId, nonce });
  const validRes = await send('WebDriver:ExecuteAsyncScript', {
    script: `
      const callback = arguments[arguments.length - 1];
      chrome.runtime.sendMessage({
        action: 'COMPLETE_INTERVENTION',
        target: '${target}',
        tabId: '${tabId}',
        nonce: '${nonce}',
        durationMs: 1000 // Expire in 1 second!
      }, res => callback(res));
    `
  });
  console.log('Short-lived grant issued:', validRes.value);

  // Navigate to target
  await send('WebDriver:Navigate', { url: 'http://127.0.0.1:8080/target' });
  await sleep(500);
  let immediateUrl = (await send('WebDriver:GetCurrentURL')).value;
  console.log('Immediate load (within 1s):', immediateUrl);

  // Wait 1.5 seconds for grant to expire
  console.log('Waiting 1.5s for grant expiration...');
  await sleep(1500);

  // Re-navigate to target
  console.log('Re-navigating to target after expiration...');
  await send('WebDriver:Navigate', { url: 'http://127.0.0.1:8080/target' });
  await sleep(1200);
  let expiredUrl = (await send('WebDriver:GetCurrentURL')).value;
  console.log('URL after expiration:', expiredUrl);

  if (expiredUrl.includes('intervene.html')) {
    console.log('>>> TEST 12 PASS: Expired grant correctly intercepted; fresh intervention required!');
  } else {
    console.log('>>> TEST 12 FAIL: Access still allowed after grant expired!');
  }

  client.destroy();
  ff.kill();
  server.kill();
}

main().catch(e => { console.error(e); process.exit(1); });
