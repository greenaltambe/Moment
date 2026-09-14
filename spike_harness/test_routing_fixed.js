const net = require('net');
const { spawn } = require('child_process');

async function run() {
  const server = spawn('node', ['/home/greenaltambe/Projects/Moment/spike_harness/test_server.js']);

  await new Promise(r => setTimeout(r, 1000));

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

  await new Promise(r => setTimeout(r, 1000));
  await send('WebDriver:NewSession', {});
  await send('Addon:Install', { path: '/tmp/moment_spike.xpi', temporary: true });

  console.log('--- TEST 1: Direct Navigation ---');
  await send('WebDriver:Navigate', { url: 'http://127.0.0.1:8080/target' });
  await new Promise(r => setTimeout(r, 1500));

  let currentUrl = await send('WebDriver:GetCurrentURL', {});
  console.log('Intervened URL:', currentUrl.value);

  console.log('\n--- TEST 10: Complete Intervention ---');
  const btn = await send('WebDriver:FindElement', { using: 'id', value: 'btnComplete' });
  const elId = btn.value['element-6066-11e4-a52e-4f735466cecf'] || btn.value;
  await send('WebDriver:ElementClick', { id: elId });
  await new Promise(r => setTimeout(r, 2000));

  currentUrl = await send('WebDriver:GetCurrentURL', {});
  let pageTitle = await send('WebDriver:GetTitle', {});
  console.log('Final URL:', currentUrl.value);
  console.log('Final Title:', pageTitle.value);

  if (currentUrl.value === 'http://127.0.0.1:8080/target' && pageTitle.value.includes('Managed Target')) {
    console.log('>>> TEST 10 PASS: Reached destination without redirect loop!');
  } else {
    console.log('>>> TEST 10 FAIL: Final URL mismatch');
  }

  client.destroy();
  ff.kill();
  server.kill();
}

run().catch(e => { console.error(e); process.exit(1); });
