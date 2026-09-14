/**
 * Moment Popup Controller (Phase 5)
 * Connects UI to background decision engine and active tab tracking.
 */

import '../../shared/types.js';
import { CurrentSiteState, TabUsageSummary } from '../../shared/messages.js';
import { Collection } from '../../core/models/collection.js';
import { initTheme, applyTheme } from '../theme.js';

async function initPopup(): Promise<void> {
  initTheme();
  // Elements
  const siteDisplay = document.getElementById('siteDisplay')!;
  const siteStatusBadge = document.getElementById('siteStatusBadge')!;
  const collectionRuleIndicator = document.getElementById('collectionRuleIndicator')!;
  const statusMsg = document.getElementById('statusMsg')!;
  const linkDashboard = document.getElementById('linkDashboard')!;

  // Intent Pass Elements
  const intentPassCard = document.getElementById('intentPassCard')!;
  const intentPassCountdown = document.getElementById('intentPassCountdown')!;
  const intentPassScopeText = document.getElementById('intentPassScopeText')!;
  const btnEndIntentPass = document.getElementById('btnEndIntentPass') as HTMLButtonElement;

  // Site Pass Elements
  const sitePassCard = document.getElementById('sitePassCard')!;
  const sitePassCountdown = document.getElementById('sitePassCountdown')!;
  const sitePassScopeText = document.getElementById('sitePassScopeText')!;
  const btnEndSitePass = document.getElementById('btnEndSitePass') as HTMLButtonElement;

  let sitePassTimerInterval: any = null;

  // Focus Mode Elements
  const focusModeActiveCard = document.getElementById('focusModeActiveCard')!;
  const focusModeCountdown = document.getElementById('focusModeCountdown')!;
  const focusModeScopeText = document.getElementById('focusModeScopeText')!;
  const btnEndFocus = document.getElementById('btnEndFocus') as HTMLButtonElement;

  const focusModeControls = document.getElementById('focusModeControls')!;
  const btnOpenFocusSetup = document.getElementById('btnOpenFocusSetup') as HTMLButtonElement;
  const focusSetupDrawer = document.getElementById('focusSetupDrawer')!;
  const focusSetupForm = document.getElementById('focusSetupForm') as HTMLFormElement;
  const focusCollectionsList = document.getElementById('focusCollectionsList')!;
  const btnCancelFocus = document.getElementById('btnCancelFocus') as HTMLButtonElement;

  let focusTimerInterval: any = null;

  // Usage Card Elements
  const usageCard = document.getElementById('usageCard')!;
  const usageCollectionLabel = document.getElementById('usageCollectionLabel')!;
  const usageBadge = document.getElementById('usageBadge')!;
  const usageTimeSpent = document.getElementById('usageTimeSpent')!;
  const usageDivider = document.getElementById('usageDivider')!;
  const usageRemainingContainer = document.getElementById('usageRemainingContainer')!;
  const usageTimeRemaining = document.getElementById('usageTimeRemaining')!;
  const usageProgressBarContainer = document.getElementById('usageProgressBarContainer')!;
  const usageProgressBar = document.getElementById('usageProgressBar')!;
  const usageLimitNotice = document.getElementById('usageLimitNotice')!;

  // Action Elements
  const unconfiguredActions = document.getElementById('unconfiguredActions')!;
  const configuredActions = document.getElementById('configuredActions')!;
  const btnOpenQuickAdd = document.getElementById('btnOpenQuickAdd') as HTMLButtonElement;
  const btnEditRule = document.getElementById('btnEditRule') as HTMLButtonElement;
  const btnRemoveRule = document.getElementById('btnRemoveRule') as HTMLButtonElement;

  // Drawer Elements
  const quickAddDrawer = document.getElementById('quickAddDrawer')!;
  const quickAddForm = document.getElementById('quickAddForm') as HTMLFormElement;
  const quickAddPatternPreview = document.getElementById('quickAddPatternPreview')!;
  const quickAddCollectionSelect = document.getElementById('quickAddCollectionSelect') as HTMLSelectElement;
  const newCollectionGroup = document.getElementById('newCollectionGroup')!;
  const newCollectionNameInput = document.getElementById('newCollectionNameInput') as HTMLInputElement;
  const btnCancelQuickAdd = document.getElementById('btnCancelQuickAdd') as HTMLButtonElement;

  let currentTabState: CurrentSiteState | null = null;

  // Helpers
  function showStatus(text: string, type: 'info' | 'error' | 'success' = 'info', timeoutMs = 3500) {
    statusMsg.textContent = text;
    statusMsg.className = `status-msg ${type}`;
    if (timeoutMs > 0) {
      setTimeout(() => {
        if (statusMsg.textContent === text) {
          statusMsg.textContent = '';
          statusMsg.className = 'status-msg';
        }
      }, timeoutMs);
    }
  }

  function applyReducedMotion(reduced: boolean) {
    if (reduced) {
      document.documentElement.setAttribute('data-reduced-motion', 'true');
    } else {
      document.documentElement.removeAttribute('data-reduced-motion');
    }
  }

  // Fetch Settings (theme, reduced motion, etc.)
  function loadSettings() {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (res: any) => {
        if (res?.success && res.data) {
          applyTheme(res.data.theme);
          applyReducedMotion(Boolean(res.data.reducedMotion));
        }
      });
    }
  }

  // Render Site State
  function renderSiteState(state: CurrentSiteState) {
    currentTabState = state;

    // 1. Hostname / Location Display
    if (state.hostname) {
      siteDisplay.textContent = state.hostname;
    } else if (state.decision.reason === 'NO_ACTIVE_TAB') {
      siteDisplay.textContent = 'No active tab';
    } else if (state.decision.reason === 'RESTRICTED_TAB_URL') {
      siteDisplay.textContent = 'Restricted page';
    } else if (state.decision.reason === 'UNSUPPORTED_SCHEME' || state.url) {
      try {
        const proto = state.url ? new URL(state.url).protocol : '';
        siteDisplay.textContent = proto ? `${proto} (System page)` : 'System page';
      } catch {
        siteDisplay.textContent = 'System page';
      }
    } else {
      siteDisplay.textContent = 'Active tab';
    }

    // 2. Status Badge
    siteStatusBadge.className = 'status-badge';
    if (state.sitePass) {
      siteStatusBadge.textContent = 'Access Active';
      siteStatusBadge.classList.add('status-allowed');
    } else if (state.intentPass) {
      siteStatusBadge.textContent = 'Intent Pass';
      siteStatusBadge.classList.add('status-intent-pass');
    } else if (state.decision.reason === 'FOCUS_MODE') {
      siteStatusBadge.textContent = state.decision.action === 'BLOCK' ? 'Focus Block' : 'Focus Pause';
      siteStatusBadge.classList.add('status-focus-mode');
    } else if (!state.hostname) {
      if (state.decision.reason === 'NO_ACTIVE_TAB') {
        siteStatusBadge.textContent = 'No tab';
        siteStatusBadge.classList.add('status-unconfigured');
      } else if (state.decision.reason === 'RESTRICTED_TAB_URL') {
        siteStatusBadge.textContent = 'Restricted';
        siteStatusBadge.classList.add('status-unconfigured');
      } else {
        siteStatusBadge.textContent = 'Unsupported';
        siteStatusBadge.classList.add('status-unconfigured');
      }
    } else if (!state.isConfigured) {
      siteStatusBadge.textContent = 'Not in Moment';
      siteStatusBadge.classList.add('status-unconfigured');
    } else if (state.decision.isLimitExhausted) {
      siteStatusBadge.textContent = 'Limit reached';
      siteStatusBadge.classList.add('status-limit');
    } else if (state.decision.action === 'BLOCK') {
      siteStatusBadge.textContent = 'Blocked';
      siteStatusBadge.classList.add('status-blocked');
    } else if (state.decision.action === 'INTERVENE') {
      siteStatusBadge.textContent = 'Paused';
      siteStatusBadge.classList.add('status-paused');
    } else {
      siteStatusBadge.textContent = 'Allowed';
      siteStatusBadge.classList.add('status-allowed');
    }

    // 3. Collection & Rule Indicator
    if (state.isConfigured && state.collection) {
      const ruleText = state.rule ? state.rule.pattern : 'Configured';
      const exceptionText = state.rule?.isException ? ' • Exception' : '';
      const focusText = state.decision.reason === 'FOCUS_MODE' ? ' • Focus Mode' : '';
      collectionRuleIndicator.textContent = `${state.collection.name} • ${ruleText}${exceptionText}${focusText}`;
    } else if (!state.hostname) {
      collectionRuleIndicator.textContent = state.decision.explanation || 'Not managed by Moment';
    } else {
      collectionRuleIndicator.textContent = 'Not managed by any collection';
    }

    // 4. Primary Actions View
    if (state.isConfigured) {
      unconfiguredActions.classList.add('is-hidden');
      configuredActions.classList.remove('is-hidden');
      quickAddDrawer.classList.add('is-hidden');
      quickAddDrawer.setAttribute('aria-hidden', 'true');
      btnOpenQuickAdd.setAttribute('aria-expanded', 'false');
    } else {
      unconfiguredActions.classList.remove('is-hidden');
      configuredActions.classList.add('is-hidden');
      const previewHost = state.hostname || 'example.com';
      quickAddPatternPreview.textContent = previewHost;
      btnOpenQuickAdd.disabled = !state.hostname;
      if (!state.hostname) {
        btnOpenQuickAdd.title = state.decision.explanation || 'Current page cannot be added';
      } else {
        btnOpenQuickAdd.removeAttribute('title');
      }
    }

    // 5. Focus Mode Active Card
    if (state.focusSession) {
      focusModeActiveCard.classList.remove('is-hidden');
      focusModeControls.classList.add('is-hidden');
      focusSetupDrawer.classList.add('is-hidden');
      focusSetupDrawer.setAttribute('aria-hidden', 'true');
      btnOpenFocusSetup.setAttribute('aria-expanded', 'false');

      let localRemainingSeconds = state.focusSession.remainingSeconds;
      const updateFocusCountdown = () => {
        const remMin = Math.ceil(localRemainingSeconds / 60);
        focusModeCountdown.textContent = remMin > 1 ? `${remMin}m remaining` : `${localRemainingSeconds}s remaining`;
      };
      updateFocusCountdown();

      const names = state.focusSession.collectionNames && state.focusSession.collectionNames.length > 0
        ? state.focusSession.collectionNames.join(', ')
        : 'Selected collections';
      focusModeScopeText.textContent = `Focusing on: ${names}`;

      if (focusTimerInterval) {
        clearInterval(focusTimerInterval);
        focusTimerInterval = null;
      }

      focusTimerInterval = setInterval(() => {
        localRemainingSeconds--;
        if (localRemainingSeconds > 0) {
          updateFocusCountdown();
        } else {
          clearInterval(focusTimerInterval);
          focusTimerInterval = null;
          refreshSiteState();
        }
      }, 1000);
    } else {
      focusModeActiveCard.classList.add('is-hidden');
      focusModeControls.classList.remove('is-hidden');
      if (focusTimerInterval) {
        clearInterval(focusTimerInterval);
        focusTimerInterval = null;
      }
    }

    // 6. Site Pass Active Card
    if (state.sitePass) {
      sitePassCard.classList.remove('is-hidden');
      let localSitePassSeconds = state.sitePass.remainingSeconds;

      const formatSitePassTime = (sec: number) => {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}:${s < 10 ? '0' : ''}${s} remaining`;
      };

      sitePassCountdown.textContent = formatSitePassTime(localSitePassSeconds);
      sitePassScopeText.textContent = state.sitePass.scope === 'ALL_TABS_UNTIL_EXPIRATION'
        ? 'All tabs until expiration'
        : 'This tab only';

      if (sitePassTimerInterval) {
        clearInterval(sitePassTimerInterval);
        sitePassTimerInterval = null;
      }

      sitePassTimerInterval = setInterval(() => {
        localSitePassSeconds--;
        if (localSitePassSeconds > 0) {
          sitePassCountdown.textContent = formatSitePassTime(localSitePassSeconds);
        } else {
          clearInterval(sitePassTimerInterval);
          sitePassTimerInterval = null;
          refreshSiteState();
        }
      }, 1000);
    } else {
      sitePassCard.classList.add('is-hidden');
      if (sitePassTimerInterval) {
        clearInterval(sitePassTimerInterval);
        sitePassTimerInterval = null;
      }
    }

    // 7. Intent Pass Active Card
    if (state.intentPass) {
      intentPassCard.classList.remove('is-hidden');
      const remSec = state.intentPass.remainingSeconds;
      const remMin = Math.ceil(remSec / 60);
      intentPassCountdown.textContent = remMin > 1 ? `${remMin}m remaining` : `${remSec}s remaining`;
      const scopeType = state.intentPass.scope.type;
      const pattern = state.intentPass.scope.pattern;
      if (scopeType === 'EXACT_PAGE') {
        intentPassScopeText.textContent = `Temporary access for exact page: ${pattern}`;
      } else if (scopeType === 'PATH_PREFIX') {
        intentPassScopeText.textContent = `Temporary access for section: ${pattern}`;
      } else if (scopeType === 'EXACT_HOST') {
        intentPassScopeText.textContent = `Temporary access for host: ${pattern}`;
      } else {
        intentPassScopeText.textContent = `Temporary access for ${pattern}`;
      }
    } else {
      intentPassCard.classList.add('is-hidden');
    }

    // 6. Usage Card
    renderUsage(state.usage, state.collection?.name);
  }

  function renderUsage(usage: TabUsageSummary, collectionName?: string) {
    const hasUsage = Boolean(usage && usage.collectionId);
    usageCard.classList.toggle('is-hidden', !hasUsage);
    if (!hasUsage) {
      return;
    }

    usageCollectionLabel.textContent = usage.collectionName || collectionName || 'Collection Usage';
    usageTimeSpent.textContent = usage.formattedUsed;

    const hasLimit = usage.dailyLimitMs !== null;
    usageDivider.classList.toggle('is-hidden', !hasLimit);
    usageRemainingContainer.classList.toggle('is-hidden', !hasLimit);
    usageProgressBarContainer.classList.toggle('is-hidden', !hasLimit);

    if (hasLimit && usage.dailyLimitMs) {
      usageTimeRemaining.textContent = usage.formattedRemaining || '0m';

      const percent = Math.min(100, Math.round((usage.usedMs / usage.dailyLimitMs) * 100));
      usageProgressBar.style.setProperty('--progress', `${percent}%`);
      usageProgressBar.style.width = `${percent}%`;
      usageProgressBarContainer.setAttribute('aria-valuenow', String(percent));

      if (usage.isExhausted) {
        usageProgressBar.classList.add('exhausted');
        usageBadge.textContent = 'Limit reached';
        usageBadge.classList.add('exhausted');
        usageLimitNotice.classList.remove('is-hidden');
      } else {
        usageProgressBar.classList.remove('exhausted');
        usageBadge.textContent = `${usage.formattedLimit} limit`;
        usageBadge.classList.remove('exhausted');
        usageLimitNotice.classList.add('is-hidden');
      }
    } else {
      usageLimitNotice.classList.add('is-hidden');
      usageBadge.textContent = 'No limit';
      usageBadge.classList.remove('exhausted');
    }
  }

  // Load Collections for Drawer Dropdown
  async function loadCollections(): Promise<Record<string, Collection>> {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'GET_COLLECTIONS' }, (res: any) => {
          if (res?.success && res.data) {
            resolve(res.data);
          } else {
            resolve({});
          }
        });
      } else {
        resolve({});
      }
    });
  }

  function updateCollectionDropdown(collections: Record<string, Collection>) {
    quickAddCollectionSelect.replaceChildren();
    const colList = Object.values(collections);

    for (const col of colList) {
      const opt = document.createElement('option');
      opt.value = col.id;
      opt.textContent = col.name;
      quickAddCollectionSelect.appendChild(opt);
    }

    const newOpt = document.createElement('option');
    newOpt.value = '__NEW__';
    newOpt.textContent = '+ Create New Collection...';
    quickAddCollectionSelect.appendChild(newOpt);

    if (colList.length === 0) {
      quickAddCollectionSelect.value = '__NEW__';
      newCollectionGroup.classList.remove('is-hidden');
    } else {
      quickAddCollectionSelect.value = colList[0].id;
      newCollectionGroup.classList.add('is-hidden');
    }
  }

  // Fetch Full Site State (queries popup active tab directly, passing tabId to background)
  async function refreshSiteState() {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      let activeTabId: number | undefined;
      if (chrome.tabs?.query) {
        try {
          const tabs = await new Promise<any[]>((resolve) => {
            chrome.tabs.query({ active: true, currentWindow: true }, (t: any[]) => resolve(t || []));
          });
          if (tabs.length > 0 && tabs[0].id !== undefined) {
            activeTabId = tabs[0].id;
          }
        } catch {
          activeTabId = undefined;
        }
      }

      chrome.runtime.sendMessage(
        { type: 'GET_CURRENT_SITE_STATE', tabId: activeTabId },
        (res: any) => {
          if (chrome.runtime.lastError || !res?.success || !res.data) {
            siteDisplay.textContent = 'Unable to connect to Moment';
            siteStatusBadge.textContent = 'Error';
            siteStatusBadge.className = 'status-badge status-blocked';
            currentTabState = null;
            return;
          }
          renderSiteState(res.data);
        }
      );
    } else {
      // Dev fallback
      renderSiteState({
        tabId: 1,
        url: 'https://example.com/test',
        hostname: 'example.com',
        isConfigured: false,
        collection: null,
        rule: null,
        decision: { action: 'ALLOW', reason: 'DEFAULT_ALLOW', explanation: 'Allowed' },
        usage: {
          tabId: 1,
          url: 'https://example.com/test',
          hostname: 'example.com',
          collectionId: null,
          collectionName: null,
          dailyLimitMs: null,
          usedMs: 0,
          remainingMs: null,
          isExhausted: false,
          formattedUsed: '0m',
          formattedLimit: null,
          formattedRemaining: null,
        },
      });
    }
  }

  // Quick-Add Open / Close
  btnOpenQuickAdd.addEventListener('click', async () => {
    if (btnOpenQuickAdd.disabled) return;
    const cols = await loadCollections();
    updateCollectionDropdown(cols);

    unconfiguredActions.classList.add('is-hidden');
    quickAddDrawer.classList.remove('is-hidden');
    quickAddDrawer.setAttribute('aria-hidden', 'false');
    btnOpenQuickAdd.setAttribute('aria-expanded', 'true');
    quickAddCollectionSelect.focus();
  });

  btnCancelQuickAdd.addEventListener('click', () => {
    quickAddDrawer.classList.add('is-hidden');
    quickAddDrawer.setAttribute('aria-hidden', 'true');
    unconfiguredActions.classList.remove('is-hidden');
    btnOpenQuickAdd.setAttribute('aria-expanded', 'false');
    btnOpenQuickAdd.focus();
  });

  quickAddCollectionSelect.addEventListener('change', () => {
    if (quickAddCollectionSelect.value === '__NEW__') {
      newCollectionGroup.classList.remove('is-hidden');
      newCollectionNameInput.focus();
    } else {
      newCollectionGroup.classList.add('is-hidden');
    }
  });

  // Quick-Add Submit
  quickAddForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!currentTabState) {
      showStatus('Unable to connect to Moment background service.', 'error');
      return;
    }

    if (!currentTabState.hostname) {
      const reasonMsg = currentTabState.decision.explanation || 'Current page cannot be blocked by Moment.';
      showStatus(reasonMsg, 'error');
      return;
    }

    const modeInput = quickAddForm.querySelector<HTMLInputElement>('input[name="quickAddMode"]:checked');
    const mode = (modeInput?.value || 'WEBSITE') as 'WEBSITE' | 'EXACT_PAGE';

    let pattern = currentTabState.hostname;
    if (mode === 'EXACT_PAGE' && currentTabState.url) {
      pattern = currentTabState.url;
    }

    let targetCollectionId = quickAddCollectionSelect.value;

    // Check if creating a new collection
    if (targetCollectionId === '__NEW__') {
      const colName = newCollectionNameInput.value.trim();
      if (!colName) {
        showStatus('Please enter a collection name.', 'error');
        newCollectionNameInput.focus();
        return;
      }

      const createColRes: any = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'CREATE_COLLECTION',
          name: colName,
          color: '#15803d',
          icon: 'shield',
        }, resolve);
      });

      if (!createColRes?.success || !createColRes.data?.id) {
        showStatus(createColRes?.error || 'Failed to create collection.', 'error');
        return;
      }

      targetCollectionId = createColRes.data.id;
    }

    // Create Rule
    const createRuleRes: any = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'CREATE_RULE',
        collectionId: targetCollectionId,
        pattern,
        ruleType: mode,
        isException: false,
      }, resolve);
    });

    if (!createRuleRes?.success) {
      showStatus(createRuleRes?.error || 'Failed to add rule.', 'error');
      return;
    }

    showStatus('Site added to Moment.', 'success');
    quickAddDrawer.classList.add('is-hidden');
    quickAddDrawer.setAttribute('aria-hidden', 'true');
    refreshSiteState();
  });

  // End Site Pass Action
  btnEndSitePass.addEventListener('click', () => {
    if (!currentTabState || currentTabState.tabId === undefined || currentTabState.tabId < 0) return;
    btnEndSitePass.disabled = true;
    showStatus('Ending access...', 'info');
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(
        {
          type: 'END_SITE_PASS',
          tabId: currentTabState.tabId,
          passId: currentTabState.sitePass?.id,
          site: currentTabState.sitePass?.site,
        },
        (res: any) => {
          btnEndSitePass.disabled = false;
          if (res?.success) {
            showStatus('Access ended.', 'success');
            refreshSiteState();
          } else {
            showStatus(res?.error || 'Could not end access', 'error');
          }
        }
      );
    }
  });

  // End Intent Pass Action
  btnEndIntentPass.addEventListener('click', () => {
    if (!currentTabState || currentTabState.tabId === undefined || currentTabState.tabId < 0) return;
    btnEndIntentPass.disabled = true;
    showStatus('Ending Intent Pass...', 'info');
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(
        {
          type: 'END_INTENT_PASS',
          tabId: currentTabState.tabId,
        },
        (res: any) => {
          btnEndIntentPass.disabled = false;
          if (res?.success) {
            showStatus('Intent Pass ended.', 'success');
            refreshSiteState();
          } else {
            showStatus(res?.error || 'Could not end Intent Pass', 'error');
          }
        }
      );
    }
  });

  // Focus Setup Open / Close
  btnOpenFocusSetup.addEventListener('click', async () => {
    const cols = await loadCollections();
    focusCollectionsList.replaceChildren();
    const colList = Object.values(cols);

    if (colList.length === 0) {
      const p = document.createElement('p');
      p.className = 'site-meta';
      p.textContent = 'No collections yet. Create a collection first.';
      focusCollectionsList.appendChild(p);
    } else {
      for (const col of colList) {
        const label = document.createElement('label');
        label.className = 'focus-collection-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.name = 'focusCollection';
        checkbox.value = col.id;
        checkbox.checked = col.enabled !== false;

        const span = document.createElement('span');
        span.textContent = col.name;

        label.appendChild(checkbox);
        label.appendChild(span);
        focusCollectionsList.appendChild(label);
      }
    }

    focusModeControls.classList.add('is-hidden');
    focusSetupDrawer.classList.remove('is-hidden');
    focusSetupDrawer.setAttribute('aria-hidden', 'false');
    btnOpenFocusSetup.setAttribute('aria-expanded', 'true');
  });

  btnCancelFocus.addEventListener('click', () => {
    focusSetupDrawer.classList.add('is-hidden');
    focusSetupDrawer.setAttribute('aria-hidden', 'true');
    focusModeControls.classList.remove('is-hidden');
    btnOpenFocusSetup.setAttribute('aria-expanded', 'false');
    btnOpenFocusSetup.focus();
  });

  // Focus Setup Form Submit
  focusSetupForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const durationInput = focusSetupForm.querySelector<HTMLInputElement>('input[name="focusDuration"]:checked');
    const durationMs = durationInput ? parseInt(durationInput.value, 10) : 1800000;

    const checkedBoxes = focusSetupForm.querySelectorAll<HTMLInputElement>('input[name="focusCollection"]:checked');
    const selectedCollectionIds: string[] = [];
    checkedBoxes.forEach((cb) => {
      selectedCollectionIds.push(cb.value);
    });

    if (selectedCollectionIds.length === 0) {
      showStatus('Please select at least one collection to focus.', 'error');
      return;
    }

    showStatus('Starting Focus session...', 'info');

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(
        {
          type: 'START_FOCUS_MODE',
          durationMs,
          collectionIds: selectedCollectionIds,
        },
        (res: any) => {
          if (res?.success) {
            showStatus('Focus session started.', 'success');
            focusSetupDrawer.classList.add('is-hidden');
            focusSetupDrawer.setAttribute('aria-hidden', 'true');
            refreshSiteState();
          } else {
            showStatus(res?.error || 'Could not start Focus session', 'error');
          }
        }
      );
    }
  });

  // End Focus Action
  btnEndFocus.addEventListener('click', () => {
    btnEndFocus.disabled = true;
    showStatus('Ending Focus session...', 'info');
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'END_FOCUS_MODE' }, (res: any) => {
        btnEndFocus.disabled = false;
        if (res?.success) {
          showStatus('Focus session ended.', 'success');
          refreshSiteState();
        } else {
          showStatus(res?.error || 'Could not end Focus session', 'error');
        }
      });
    }
  });

  // Remove Rule Action
  btnRemoveRule.addEventListener('click', async () => {
    if (!currentTabState || !currentTabState.collection || !currentTabState.rule) {
      return;
    }

    const confirmed = window.confirm(
      `Remove rule "${currentTabState.rule.pattern}" from ${currentTabState.collection.name}?`
    );
    if (!confirmed) return;

    const delRes: any = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'DELETE_RULE',
        collectionId: currentTabState!.collection!.id,
        ruleId: currentTabState!.rule!.id,
      }, resolve);
    });

    if (!delRes?.success) {
      showStatus(delRes?.error || 'Failed to remove rule.', 'error');
      refreshSiteState();
      return;
    }

    showStatus('Rule removed.', 'success');
    refreshSiteState();
  });

  // Edit in Dashboard Action
  btnEditRule.addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open('../options/options.html', '_blank');
    }
  });

  // Dashboard Link
  linkDashboard.addEventListener('click', (e) => {
    e.preventDefault();
    if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open('../options/options.html', '_blank');
    }
  });

  // Window Focus: Re-evaluate canonical site state when window regains focus
  window.addEventListener('focus', () => {
    refreshSiteState();
  });

  // Keyboard shortcut: Esc closes drawer
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!quickAddDrawer.classList.contains('is-hidden')) {
        quickAddDrawer.classList.add('is-hidden');
        quickAddDrawer.setAttribute('aria-hidden', 'true');
        unconfiguredActions.classList.remove('is-hidden');
        btnOpenQuickAdd.focus();
      }
      if (!focusSetupDrawer.classList.contains('is-hidden')) {
        focusSetupDrawer.classList.add('is-hidden');
        focusSetupDrawer.setAttribute('aria-hidden', 'true');
        focusModeControls.classList.remove('is-hidden');
        btnOpenFocusSetup.setAttribute('aria-expanded', 'false');
        btnOpenFocusSetup.focus();
      }
    }
  });

  // --- MOBILE SOFT KEYBOARD AUTO-SCROLL FIX ---
  document.addEventListener('focusin', (e) => {
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
      setTimeout(() => {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 150);
    }
  });

  // Initial Boot
  loadSettings();
  await refreshSiteState();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void initPopup();
  });
} else {
  void initPopup();
}

