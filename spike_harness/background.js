// Moment Pre-Phase-1 Spike: background.js

const MANAGED_TARGET_PATTERN = "/target";

// In-memory state (backed by storage.local for worker survival test)
// tabId -> { targetUrl, grantedAt, expiresAt, nonce }
const activeGrants = new Map();

// tabId -> { targetUrl, nonce, createdAt }
const pendingRequests = new Map();

// Activity log ring buffer
const spikeLogs = [];
function log(event, data) {
  const entry = { timestamp: Date.now(), event, ...data };
  spikeLogs.push(entry);
  console.log(`[SPIKE_LOG] ${event}`, JSON.stringify(data));
}

function isManaged(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.includes(MANAGED_TARGET_PATTERN);
  } catch (e) {
    return false;
  }
}

// 1. Navigation Detection & Routing
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return; // Top-level only

  const targetUrl = details.url;
  if (targetUrl.includes('__MOMENT_RESET__')) {
    activeGrants.clear();
    pendingRequests.clear();
    log('ALL_GRANTS_CLEARED_VIA_HOOK', {});
    return;
  }
  if (!isManaged(targetUrl)) return;

  log('NAVIGATION_DETECTED', { tabId: details.tabId, url: targetUrl });

  const grant = activeGrants.get(details.tabId);
  const now = Date.now();

  if (grant && grant.targetUrl === targetUrl && grant.expiresAt > now) {
    log('GRANT_ACTIVE_ALLOWING', { tabId: details.tabId, url: targetUrl, expiresAt: grant.expiresAt });
    return; // Allow navigation to proceed
  }

  // Need intervention
  const nonce = Math.random().toString(36).substring(2, 10);
  pendingRequests.set(details.tabId, { targetUrl, nonce, createdAt: now });

  const interveneUrl = chrome.runtime.getURL(
    `intervene.html?target=${encodeURIComponent(targetUrl)}&tabId=${details.tabId}&nonce=${nonce}`
  );

  log('INTERVENTION_DISPLAYED', { tabId: details.tabId, targetUrl, nonce });
  chrome.tabs.update(details.tabId, { url: interveneUrl });
});

// 2. Messaging Handler for Intervene Page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const now = Date.now();

  if (message.action === 'COMPLETE_INTERVENTION') {
    const { target, tabId, nonce } = message;
    log('COMPLETION_REQUESTED', { tabId, target, nonce });

    const pending = pendingRequests.get(Number(tabId));
    if (!pending || pending.nonce !== nonce || pending.targetUrl !== target) {
      log('MALFORMED_STATE_REJECTED', { tabId, receivedNonce: nonce });
      sendResponse({ status: 'REJECTED', reason: 'Invalid or forged nonce' });
      return true;
    }

    // Grant valid for 60 seconds (or configurable)
    const expiresAt = now + (message.durationMs || 60000);
    activeGrants.set(Number(tabId), { targetUrl: target, grantedAt: now, expiresAt, nonce });
    pendingRequests.delete(Number(tabId));

    log('GRANT_CREATED', { tabId, target, expiresAt });
    sendResponse({ status: 'AUTHORIZED', targetUrl: target });
    return true;
  }

  if (message.action === 'CANCEL_INTERVENTION') {
    const { tabId } = message;
    log('CANCELLATION_RECORDED', { tabId });
    pendingRequests.delete(Number(tabId));
    sendResponse({ status: 'CANCELLED' });
    return true;
  }

  if (message.action === 'GET_SPIKE_LOGS') {
    sendResponse({ logs: spikeLogs, grants: Array.from(activeGrants.entries()) });
    return true;
  }

  
  if (message.action === 'CLEAR_ALL_GRANTS') {
    activeGrants.clear();
    pendingRequests.clear();
    log('ALL_GRANTS_CLEARED', {});
    sendResponse({ status: 'CLEARED' });
    return true;
  }
  if (message.action === 'EXPIRE_GRANT_NOW') {
    // For test scenario 12
    const { tabId } = message;
    const grant = activeGrants.get(Number(tabId));
    if (grant) {
      grant.expiresAt = now - 1000;
      activeGrants.set(Number(tabId), grant);
      log('GRANT_MANUALLY_EXPIRED', { tabId });
    }
    sendResponse({ status: 'EXPIRED' });
    return true;
  }
});
