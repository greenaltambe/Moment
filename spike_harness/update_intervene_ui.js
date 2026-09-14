const fs = require('fs');

let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Moment Test Intervention</title>
</head>
<body>
  <div class="card">
    <h2>Moment Test Intervention</h2>
    <p id="targetDisplay">Destination: Loading...</p>
    <div>
      <button id="btnComplete" class="primary">Complete Intervention</button>
      <button id="btnCancel">Cancel</button>
      <button id="btnTamper">Tamper Nonce</button>
      <button id="btnShortGrant">Complete (1s Grant)</button>
    </div>
    <div id="status"></div>
  </div>
  <script src="intervene.js"></script>
</body>
</html>`;
fs.writeFileSync('/home/greenaltambe/Projects/Moment/spike_harness/intervene.html', html);

let js = `const urlParams = new URLSearchParams(window.location.search);
const target = urlParams.get('target');
const tabId = urlParams.get('tabId');
const nonce = urlParams.get('nonce');

document.getElementById('targetDisplay').textContent = \`Destination: \${target || 'None'}\`;
const statusEl = document.getElementById('status');

document.getElementById('btnComplete').addEventListener('click', () => {
  statusEl.textContent = 'Authorizing...';
  chrome.runtime.sendMessage({
    action: 'COMPLETE_INTERVENTION',
    target,
    tabId,
    nonce
  }, (res) => {
    if (res && res.status === 'AUTHORIZED') {
      statusEl.textContent = 'Authorized! Navigating...';
      window.location.replace(res.targetUrl);
    } else {
      statusEl.textContent = \`Authorization failed: \${res ? res.reason : 'Unknown'}\`;
    }
  });
});

document.getElementById('btnCancel').addEventListener('click', () => {
  chrome.runtime.sendMessage({
    action: 'CANCEL_INTERVENTION',
    tabId,
    nonce
  }, () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.replace('about:blank');
    }
  });
});

document.getElementById('btnTamper')?.addEventListener('click', () => {
  chrome.runtime.sendMessage({
    action: 'COMPLETE_INTERVENTION',
    target,
    tabId,
    nonce: 'FORGED_NONCE_XYZ'
  }, (res) => {
    statusEl.textContent = \`Tamper Result: \${res ? res.status : 'None'}\`;
  });
});

document.getElementById('btnShortGrant')?.addEventListener('click', () => {
  chrome.runtime.sendMessage({
    action: 'COMPLETE_INTERVENTION',
    target,
    tabId,
    nonce,
    durationMs: 1000
  }, (res) => {
    if (res && res.status === 'AUTHORIZED') {
      statusEl.textContent = 'Authorized 1s! Navigating...';
      window.location.replace(res.targetUrl);
    }
  });
});
`;
fs.writeFileSync('/home/greenaltambe/Projects/Moment/spike_harness/intervene.js', js);
console.log('Updated intervene.html and intervene.js');
