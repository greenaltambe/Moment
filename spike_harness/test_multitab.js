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

  console.log('[TEST 7] Multi-Tab Concurrency Test Running...');

  // Reset
  await send('WebDriver:Navigate', { url: 'http://127.0.0.1:8080/unmanaged?__MOMENT_RESET__' });
  await sleep(500);

  // Tab A: Navigate to target
  await send('WebDriver:Navigate', { url: 'http://127.0.0.1:8080/target' });
  await sleep(1200);
  let tabAUrl = (await send('WebDriver:GetCurrentURL')).value;
  console.log('Tab A initial URL (should be intervene):', tabAUrl);

  // Get initial handle
  let initialHandles = await send('WebDriver:GetWindowHandles');
  let handleA = Array.isArray(initialHandles) ? initialHandles[0] : initialHandles.value[0];

  // Open Tab B
  let newTabRes = await send('WebDriver:NewWindow', { type: 'tab' });
  let allHandles = await send('WebDriver:GetWindowHandles');
  let handleList = Array.isArray(allHandles) ? allHandles : allHandles.value;
  let handleB = handleList.find(h => h !== handleA);

  console.log('Switching to Tab B:', handleB);
  await send('WebDriver:SwitchToWindow', { handle: handleB });
  await sleep(500);

  // Tab B: Navigate to target
  await send('WebDriver:Navigate', { url: 'http://127.0.0.1:8080/target' });
  await sleep(1200);
  let tabBUrl = (await send('WebDriver:GetCurrentURL')).value;
  console.log('Tab B initial URL (should be intervene):', tabBUrl);

  // Complete intervention in Tab B
  console.log('Completing intervention in Tab B...');
  let btnB = await send('WebDriver:FindElement', { using: 'id', value: 'btnComplete' });
  await send('WebDriver:ElementClick', { id: getElId(btnB) });
  await sleep(1500);
  let tabBFinalUrl = (await send('WebDriver:GetCurrentURL')).value;
  console.log('Tab B final URL (should be target):', tabBFinalUrl);

  // Switch back to Tab A
  console.log('Switching back to Tab A:', handleA);
  await send('WebDriver:SwitchToWindow', { handle: handleA });
  await sleep(500);
  let tabAFinalUrl = (await send('WebDriver:GetCurrentURL')).value;
  console.log('Tab A final URL (MUST STILL BE INTERVENE):', tabAFinalUrl);

  if (tabBFinalUrl === 'http://127.0.0.1:8080/target' && tabAFinalUrl.includes('intervene.html')) {
    console.log('>>> TEST 7 PASS: Tab B authorized, Tab A remains isolated in intervention!');
  } else {
    console.log('>>> TEST 7 FAIL: Tab isolation failed.');
  }

  client.destroy();
  ff.kill();
  server.kill();
}

main().catch(e => { console.error(e); process.exit(1); });
