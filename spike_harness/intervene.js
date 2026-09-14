const urlParams = new URLSearchParams(window.location.search);
const target = urlParams.get('target');
const tabId = urlParams.get('tabId');
const nonce = urlParams.get('nonce');

document.getElementById('targetDisplay').textContent = `Destination: ${target || 'None'}`;
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
      statusEl.textContent = `Authorization failed: ${res ? res.reason : 'Unknown'}`;
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
    statusEl.textContent = `Tamper Result: ${res ? res.status : 'None'}`;
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
