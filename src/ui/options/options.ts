/**
 * Moment Options Dashboard Controller (Phase 5)
 * Comprehensive management for Collections, Rules, Boundaries, Schedules,
 * Usage Limits, Settings, and Import/Export.
 */

import '../../shared/types.js';
import { Collection, OpeningMessageMode, MessageIntensity, WhenAccessExpires } from '../../core/models/collection.js';
import { Target, TargetRuleType } from '../../core/models/target.js';
import { BoundaryPolicy, ScheduleInterval } from '../../core/models/boundary.js';
import { UserSettings } from '../../storage/schema.js';
import {
  validateCollectionName,
  validateTargetPattern,
  formatScheduleNaturalLanguage,
} from '../../core/validation/rules.js';
import {
  formatDuration,
  resolveEffectiveLimitMs,
  getLocalDateKey,
  getUsageRecordKey,
} from '../../core/usage/accounting.js';
import { ACCENTS, AccentGroup, sanitizeAccentId } from '../../shared/accent.js';
import { initTheme, applyTheme, setAccentPreferences } from '../theme.js';

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  // Navigation elements
  const navItems = document.querySelectorAll<HTMLButtonElement>('.nav-item');
  const sectionTitle = document.getElementById('sectionTitle')!;
  const sectionDesc = document.getElementById('sectionDesc')!;
  const dashboardAlert = document.getElementById('dashboardAlert')!;

  // Tab Panes
  const tabCollections = document.getElementById('tab-collections')!;
  const tabSettings = document.getElementById('tab-settings')!;
  const tabImportExport = document.getElementById('tab-import-export')!;
  const tabPrivacy = document.getElementById('tab-privacy')!;

  // Collections & Rules Elements
  const btnNewCollection = document.getElementById('btnNewCollection') as HTMLButtonElement;
  const collectionListContainer = document.getElementById('collectionListContainer')!;

  // Collection Modal Elements
  const collectionModal = document.getElementById('collectionModal') as HTMLDialogElement;
  const collectionModalTitle = document.getElementById('collectionModalTitle')!;
  const btnCloseCollectionModal = document.getElementById('btnCloseCollectionModal') as HTMLButtonElement;
  const btnCancelCollection = document.getElementById('btnCancelCollection') as HTMLButtonElement;
  const collectionForm = document.getElementById('collectionForm') as HTMLFormElement;
  const collectionModalId = document.getElementById('collectionModalId') as HTMLInputElement;
  const collectionModalName = document.getElementById('collectionModalName') as HTMLInputElement;
  const collectionModalNameError = document.getElementById('collectionModalNameError')!;
  const scheduleDetailsGroup = document.getElementById('scheduleDetailsGroup')!;
  const schedStartTime = document.getElementById('schedStartTime') as HTMLInputElement;
  const schedEndTime = document.getElementById('schedEndTime') as HTMLInputElement;
  const scheduleSummaryPreview = document.getElementById('scheduleSummaryPreview')!;
  const colEnableDailyLimit = document.getElementById('colEnableDailyLimit') as HTMLInputElement;
  const dailyLimitInputGroup = document.getElementById('dailyLimitInputGroup')!;
  const colDailyLimitMinutes = document.getElementById('colDailyLimitMinutes') as HTMLInputElement;
  const colDailyLimitError = document.getElementById('colDailyLimitError')!;
  const colTimerDurationGroup = document.getElementById('colTimerDurationGroup')!;
  const colTimerSeconds = document.getElementById('colTimerSeconds') as HTMLInputElement;
  const colRequireIntention = document.getElementById('colRequireIntention') as HTMLInputElement;
  const interventionSettingsGroup = document.getElementById('interventionSettingsGroup')!;
  const colCustomBlockMessage = document.getElementById('colCustomBlockMessage') as HTMLInputElement;
  const colOpeningMessagesGroup = document.getElementById('colOpeningMessagesGroup')!;
  const colOpeningMessagesInput = document.getElementById('colOpeningMessagesInput') as HTMLTextAreaElement;
  const colOpeningMessagesHint = document.getElementById('colOpeningMessagesHint');
  const colMomentLibraryGroup = document.getElementById('colMomentLibraryGroup')!;
  const colIntensityHint = document.getElementById('colIntensityHint');

  // Rule Modal Elements
  const ruleModal = document.getElementById('ruleModal') as HTMLDialogElement;
  const ruleModalTitle = document.getElementById('ruleModalTitle')!;
  const btnCloseRuleModal = document.getElementById('btnCloseRuleModal') as HTMLButtonElement;
  const btnCancelRule = document.getElementById('btnCancelRule') as HTMLButtonElement;
  const ruleForm = document.getElementById('ruleForm') as HTMLFormElement;
  const ruleModalCollectionId = document.getElementById('ruleModalCollectionId') as HTMLInputElement;
  const ruleModalRuleId = document.getElementById('ruleModalRuleId') as HTMLInputElement;
  const ruleModalType = document.getElementById('ruleModalType') as HTMLSelectElement;
  const ruleModalPattern = document.getElementById('ruleModalPattern') as HTMLInputElement;
  const ruleModalPatternError = document.getElementById('ruleModalPatternError')!;
  const ruleTypeHelperText = document.getElementById('ruleModalTypeHint')!;
  const ruleModalIsException = document.getElementById('ruleModalIsException') as HTMLInputElement;
  const ruleExceptionNotice = document.getElementById('ruleExceptionNotice')!;

  // Confirm Modal Elements
  const confirmModal = document.getElementById('confirmModal') as HTMLDialogElement;
  const confirmModalTitle = document.getElementById('confirmModalTitle')!;
  const confirmModalMessage = document.getElementById('confirmModalMessage')!;
  const btnConfirmDanger = document.getElementById('btnConfirmDanger') as HTMLButtonElement;
  const btnConfirmCancel = document.getElementById('btnConfirmCancel') as HTMLButtonElement;
  const btnCloseConfirmModal = document.getElementById('btnCloseConfirmModal') as HTMLButtonElement;

  // Settings Elements
  const btnSaveSettings = document.getElementById('btnSaveSettings') as HTMLButtonElement;
  const settingsStatusMsg = document.getElementById('settingsStatusMsg')!;
  const settingReducedMotion = document.getElementById('settingReducedMotion') as HTMLInputElement;

  // Import / Export Elements
  const btnExportJson = document.getElementById('btnExportJson') as HTMLButtonElement;
  const btnImportJson = document.getElementById('btnImportJson') as HTMLButtonElement;
  const importFileInput = document.getElementById('importFileInput') as HTMLInputElement;
  const importStatusReport = document.getElementById('importStatusReport')!;

  // Diagnostics & Sidebar
  const sidebarVersionDisplay = document.getElementById('sidebarVersionDisplay')!;
  const extensionVersionDisplay = document.getElementById('extensionVersionDisplay')!;
  const schemaVersionDisplay = document.getElementById('schemaVersionDisplay')!;

  // Usage Card Elements
  const todayUsageCard = document.getElementById('todayUsageCard')!;
  const todayUsageDate = document.getElementById('todayUsageDate')!;
  const todayUsageList = document.getElementById('todayUsageList')!;

  // Local State Cache
  let collectionsState: Record<string, Collection> = {};
  let pendingConfirmAction: (() => Promise<void>) | null = null;
  let lastFocusedElement: HTMLElement | null = null;

  function rememberFocus() {
    lastFocusedElement = document.activeElement as HTMLElement | null;
  }

  function restoreFocus() {
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function' && document.contains(lastFocusedElement)) {
      lastFocusedElement.focus();
    } else {
      btnNewCollection.focus();
    }
    lastFocusedElement = null;
  }

  function applyReducedMotion(reduced: boolean) {
    if (reduced) {
      document.documentElement.setAttribute('data-reduced-motion', 'true');
    } else {
      document.documentElement.removeAttribute('data-reduced-motion');
    }
  }

  // Navigation Descriptions
  const navDescriptions: Record<string, { title: string; desc: string }> = {
    collections: {
      title: 'Collections & Rules',
      desc: 'Group websites together to apply mindful boundaries and time limits.',
    },
    settings: {
      title: 'General Settings',
      desc: 'Personalize appearance, time format, and motion preferences.',
    },
    'import-export': {
      title: 'Import / Export',
      desc: 'Backup and restore your collections, rules, and boundaries.',
    },
    privacy: {
      title: 'About & Privacy',
      desc: 'Review local-first architecture and system information.',
    },
  };

  function showAlert(message: string, type: 'success' | 'error' = 'success', timeoutMs = 4000) {
    dashboardAlert.textContent = message;
    dashboardAlert.className = `dashboard-alert ${type}`;
    dashboardAlert.classList.remove('is-hidden');
    if (timeoutMs > 0) {
      setTimeout(() => {
        if (dashboardAlert.textContent === message) {
          dashboardAlert.classList.add('is-hidden');
        }
      }, timeoutMs);
    }
  }

  // --- TAB ROUTING ---
  function switchTab(tabName: string) {
    navItems.forEach((btn) => {
      const active = btn.getAttribute('data-tab') === tabName;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });

    const info = navDescriptions[tabName];
    if (info) {
      sectionTitle.textContent = info.title;
      sectionDesc.textContent = info.desc;
    }

    tabCollections.classList.toggle('is-hidden', tabName !== 'collections');
    tabSettings.classList.toggle('is-hidden', tabName !== 'settings');
    tabImportExport.classList.toggle('is-hidden', tabName !== 'import-export');
    tabPrivacy.classList.toggle('is-hidden', tabName !== 'privacy');
  }

  navItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab') || 'collections';
      switchTab(tab);
    });
  });

  // --- TODAY'S USAGE STATISTICS ---
  function renderTodayUsage(usage: Record<string, any>, cols: Record<string, Collection>) {
    todayUsageList.replaceChildren();
    const today = new Date();
    const dateKey = getLocalDateKey(today);
    todayUsageDate.textContent = today.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });

    const colList = Object.values(cols);
    const activeStats: Array<{ col: Collection; usedMs: number; limitMs: number | null }> = [];

    for (const col of colList) {
      const key = getUsageRecordKey(dateKey, col.id);
      const usedMs = usage[key]?.accumulatedMs || 0;
      const limitMs = resolveEffectiveLimitMs(col, usage[key]?.extendedMs ?? 0);
      if (usedMs > 0 || limitMs !== null) {
        activeStats.push({ col, usedMs, limitMs });
      }
    }

    if (activeStats.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'usage-stat-empty';
      emptyMsg.textContent = 'No active browsing time recorded today yet. Mindful boundaries are active.';
      todayUsageList.appendChild(emptyMsg);
    } else {
      for (const stat of activeStats) {
        const chip = document.createElement('div');
        chip.className = 'usage-stat-chip';

        const dot = document.createElement('span');
        dot.className = 'usage-stat-dot';
        dot.style.backgroundColor = stat.col.color;

        const name = document.createElement('span');
        name.className = 'usage-stat-name';
        name.textContent = stat.col.name;

        const time = document.createElement('span');
        time.className = 'usage-stat-time';
        const usedStr = formatDuration(stat.usedMs);
        if (stat.limitMs !== null) {
          const limitStr = formatDuration(stat.limitMs);
          time.textContent = `${usedStr} / ${limitStr}`;
        } else {
          time.textContent = `${usedStr} spent`;
        }

        chip.appendChild(dot);
        chip.appendChild(name);
        chip.appendChild(time);
        todayUsageList.appendChild(chip);
      }
    }

    todayUsageCard.classList.remove('is-hidden');
  }

  // --- COLLECTIONS & RULES RENDERING ---
  async function loadCollections(): Promise<Record<string, Collection>> {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'GET_STATE' }, (res: any) => {
          if (res?.success && res.data) {
            collectionsState = res.data.collections || {};
            renderTodayUsage(res.data.usage || {}, collectionsState);
            resolve(collectionsState);
          } else {
            resolve({});
          }
        });
      } else {
        resolve({});
      }
    });
  }

  function renderCollections(cols: Record<string, Collection>) {
    collectionsState = cols;
    collectionListContainer.replaceChildren();
    const colList = Object.values(cols);

    if (colList.length === 0) {
      const emptyCard = document.createElement('div');
      emptyCard.className = 'empty-state-card';

      const h3 = document.createElement('h3');
      h3.textContent = 'No Collections Yet';

      const p = document.createElement('p');
      p.textContent = 'Create your first collection to group websites and apply mindful boundaries.';

      const btnEmptyCreate = document.createElement('button');
      btnEmptyCreate.id = 'btnEmptyCreate';
      btnEmptyCreate.className = 'btn btn-primary';
      btnEmptyCreate.textContent = '+ Create First Collection';
      btnEmptyCreate.addEventListener('click', () => openCollectionModal(null));

      emptyCard.append(h3, p, btnEmptyCreate);
      collectionListContainer.appendChild(emptyCard);
      return;
    }

    for (const col of colList) {
      const card = document.createElement('div');
      card.className = 'collection-card';

      // Header summary badges
      const ruleCount = col.targets.length;
      const ruleCountText = `${ruleCount} rule${ruleCount === 1 ? '' : 's'}`;

      let limitBadge = 'No limit';
      if (col.dailyLimitMs !== null && col.dailyLimitMs !== undefined) {
        const mins = Math.round(col.dailyLimitMs / 60000);
        limitBadge = `${mins}m daily limit`;
      }

      let scheduleBadge = 'Always active';
      if (col.boundary.schedule.enabled && col.boundary.schedule.intervals.length > 0) {
        scheduleBadge = formatScheduleNaturalLanguage(col.boundary.schedule);
      }

      // Check if collection has exceptions
      const hasExceptions = col.targets.some((t) => t.isException);

      // Build header
      const header = document.createElement('div');
      header.className = 'collection-card-header';

      const headerLeft = document.createElement('div');
      headerLeft.className = 'col-header-left';

      const colorDot = document.createElement('span');
      colorDot.className = 'col-color-dot';
      colorDot.dataset.color = col.color || '#15803d';

      const colTitle = document.createElement('h2');
      colTitle.className = 'col-name';
      colTitle.textContent = col.name;

      const badgeRules = document.createElement('span');
      badgeRules.className = 'badge';
      badgeRules.textContent = ruleCountText;

      const badgeLimit = document.createElement('span');
      badgeLimit.className = `badge ${col.dailyLimitMs ? 'badge-warning' : ''}`.trim();
      badgeLimit.textContent = limitBadge;

      const badgeSched = document.createElement('span');
      badgeSched.className = `badge ${col.boundary.schedule.enabled ? 'badge-info' : ''}`.trim();
      badgeSched.textContent = scheduleBadge;

      const isStrict = col.boundary?.pause?.type === 'NONE';
      const badgeEnf = document.createElement('span');
      badgeEnf.className = `badge ${isStrict ? 'badge-danger' : 'badge-neutral'}`.trim();
      badgeEnf.textContent = isStrict ? 'Strict Block' : 'Mindful Pause';

      headerLeft.append(colorDot, colTitle, badgeEnf, badgeRules, badgeLimit, badgeSched);

      const headerActions = document.createElement('div');
      headerActions.className = 'col-header-actions';

      const btnAddRule = document.createElement('button');
      btnAddRule.className = 'btn btn-sm btn-secondary btn-add-rule';
      btnAddRule.dataset.colId = col.id;
      btnAddRule.textContent = '+ Add Rule';

      const btnEditCol = document.createElement('button');
      btnEditCol.className = 'btn btn-sm btn-ghost btn-edit-col';
      btnEditCol.dataset.colId = col.id;
      btnEditCol.textContent = 'Edit';

      const btnDelCol = document.createElement('button');
      btnDelCol.className = 'btn btn-sm btn-ghost text-danger btn-del-col';
      btnDelCol.dataset.colId = col.id;
      btnDelCol.textContent = 'Delete';

      headerActions.append(btnAddRule, btnEditCol, btnDelCol);
      header.append(headerLeft, headerActions);

      // Build table container
      const tableContainer = document.createElement('div');
      tableContainer.className = 'rules-table-container';

      const table = document.createElement('table');
      table.className = 'rules-table';

      const thead = document.createElement('thead');
      const headerTr = document.createElement('tr');
      const thPattern = document.createElement('th');
      thPattern.className = 'col-pattern';
      thPattern.textContent = 'Pattern';
      const thMode = document.createElement('th');
      thMode.className = 'col-mode';
      thMode.textContent = 'Mode';
      const thPolicy = document.createElement('th');
      thPolicy.className = 'col-policy';
      thPolicy.textContent = 'Policy';
      const thActions = document.createElement('th');
      thActions.className = 'col-actions';
      thActions.textContent = 'Actions';
      headerTr.append(thPattern, thMode, thPolicy, thActions);
      thead.appendChild(headerTr);

      const tbody = document.createElement('tbody');
      tbody.id = `rules-tbody-${col.id}`;
      table.append(thead, tbody);
      tableContainer.appendChild(table);

      card.append(header, tableContainer);

      if (hasExceptions) {
        const callout = document.createElement('div');
        callout.className = 'info-callout';
        const strong = document.createElement('strong');
        strong.textContent = 'Precedence Invariant: ';
        callout.append(strong, document.createTextNode('More-specific rules can still override exceptions within this collection.'));
        card.appendChild(callout);
      }

      if (col.targets.length === 0) {
        const emptyRow = document.createElement('tr');
        const emptyTd = document.createElement('td');
        emptyTd.colSpan = 4;
        emptyTd.className = 'rules-table-empty';
        emptyTd.textContent = 'No rules in this collection. Click "+ Add Rule" to add websites or domains.';
        emptyRow.appendChild(emptyTd);
        tbody.appendChild(emptyRow);
      } else {
        for (const target of col.targets) {
          const tr = document.createElement('tr');

          const tdPattern = document.createElement('td');
          tdPattern.className = 'rule-pattern';
          tdPattern.textContent = target.pattern;

          const tdMode = document.createElement('td');
          const badgeMode = document.createElement('span');
          badgeMode.className = 'badge';
          badgeMode.textContent = target.type;
          tdMode.appendChild(badgeMode);

          const tdPolicy = document.createElement('td');
          const badgePolicy = document.createElement('span');
          if (target.isException) {
            badgePolicy.className = 'badge badge-warning';
            badgePolicy.title = 'More-specific rules can still override this exception';
            badgePolicy.textContent = 'Exception (Allow)';
          } else {
            badgePolicy.className = 'badge badge-emerald';
            badgePolicy.textContent = 'Restricted';
          }
          tdPolicy.appendChild(badgePolicy);

          const tdActions = document.createElement('td');
          tdActions.className = 'text-right';

          const btnEditRule = document.createElement('button');
          btnEditRule.className = 'btn btn-sm btn-ghost btn-edit-rule';
          btnEditRule.dataset.colId = col.id;
          btnEditRule.dataset.ruleId = target.id;
          btnEditRule.textContent = 'Edit';

          const btnDelRule = document.createElement('button');
          btnDelRule.className = 'btn btn-sm btn-ghost text-danger btn-del-rule';
          btnDelRule.dataset.colId = col.id;
          btnDelRule.dataset.ruleId = target.id;
          btnDelRule.textContent = 'Delete';

          tdActions.append(btnEditRule, btnDelRule);
          tr.append(tdPattern, tdMode, tdPolicy, tdActions);
          tbody.appendChild(tr);
        }
      }

      collectionListContainer.appendChild(card);
    }

    // Attach Action Listeners
    collectionListContainer.querySelectorAll('.btn-add-rule').forEach((btn) => {
      btn.addEventListener('click', () => {
        const colId = btn.getAttribute('data-col-id')!;
        openRuleModal(colId, null);
      });
    });

    collectionListContainer.querySelectorAll('.btn-edit-col').forEach((btn) => {
      btn.addEventListener('click', () => {
        const colId = btn.getAttribute('data-col-id')!;
        const col = cols[colId];
        if (col) openCollectionModal(col);
      });
    });

    collectionListContainer.querySelectorAll('.btn-del-col').forEach((btn) => {
      btn.addEventListener('click', () => {
        const colId = btn.getAttribute('data-col-id')!;
        const col = cols[colId];
        if (col) confirmDeleteCollection(col.id, col.name);
      });
    });

    collectionListContainer.querySelectorAll('.btn-edit-rule').forEach((btn) => {
      btn.addEventListener('click', () => {
        const colId = btn.getAttribute('data-col-id')!;
        const ruleId = btn.getAttribute('data-rule-id')!;
        const col = cols[colId];
        const rule = col?.targets.find((t) => t.id === ruleId);
        if (rule) openRuleModal(colId, rule);
      });
    });

    collectionListContainer.querySelectorAll('.btn-del-rule').forEach((btn) => {
      btn.addEventListener('click', () => {
        const colId = btn.getAttribute('data-col-id')!;
        const ruleId = btn.getAttribute('data-rule-id')!;
        const col = cols[colId];
        const rule = col?.targets.find((t) => t.id === ruleId);
        if (rule) confirmDeleteRule(colId, rule.id, rule.pattern);
      });
    });
  }

  // --- COLLECTION MODAL ---
  function openCollectionModal(col: Collection | null) {
    rememberFocus();
    collectionModalTitle.textContent = col ? 'Edit Collection' : 'New Collection';
    collectionModalId.value = col ? col.id : '';
    collectionModalName.value = col ? col.name : '';
    collectionModalNameError.textContent = '';
    colDailyLimitError.textContent = '';

    // Color
    const targetColor = col?.color || '#15803d';
    const colorRadio = collectionForm.querySelector<HTMLInputElement>(`input[name="colColor"][value="${targetColor}"]`);
    if (colorRadio) colorRadio.checked = true;

    // Schedule
    const schedMode = col?.boundary.schedule.enabled ? 'SCHEDULE' : 'ALWAYS';
    const schedModeRadio = collectionForm.querySelector<HTMLInputElement>(`input[name="colScheduleMode"][value="${schedMode}"]`);
    if (schedModeRadio) schedModeRadio.checked = true;
    scheduleDetailsGroup.classList.toggle('is-hidden', schedMode !== 'SCHEDULE');

    // Populate schedule inputs
    const interval = col?.boundary.schedule.intervals[0];
    const days = interval?.days || [1, 2, 3, 4, 5];
    collectionForm.querySelectorAll<HTMLInputElement>('input[name="schedDay"]').forEach((chk) => {
      chk.checked = days.includes(parseInt(chk.value, 10));
    });

    const startMin = interval ? interval.startMinute : 9 * 60;
    const endMin = interval ? interval.endMinute : 17 * 60;
    schedStartTime.value = formatMinuteToHHMM(startMin);
    schedEndTime.value = formatMinuteToHHMM(endMin);
    updateScheduleSummary();

    // Daily Limit
    const hasLimit = col?.dailyLimitMs !== null && col?.dailyLimitMs !== undefined;
    colEnableDailyLimit.checked = hasLimit;
    dailyLimitInputGroup.classList.toggle('is-hidden', !hasLimit);
    colDailyLimitMinutes.value = hasLimit ? String(Math.round(col.dailyLimitMs! / 60000)) : '30';

    // Enforcement Mode
    const isStrict = col?.boundary?.pause?.type === 'NONE';
    const enfMode = isStrict ? 'STRICT_BLOCK' : 'INTERVENE';
    const enfRadio = collectionForm.querySelector<HTMLInputElement>(`input[name="colEnforcementMode"][value="${enfMode}"]`);
    if (enfRadio) enfRadio.checked = true;
    interventionSettingsGroup.classList.toggle('is-hidden', isStrict);

    // Pause Type
    const pauseType = col?.boundary?.pause?.type !== 'NONE' ? (col?.boundary?.pause?.type || 'BREATHE') : 'BREATHE';
    const pauseRadio = collectionForm.querySelector<HTMLInputElement>(`input[name="colPauseType"][value="${pauseType}"]`);
    if (pauseRadio) pauseRadio.checked = true;
    colTimerDurationGroup.classList.toggle('is-hidden', pauseType !== 'TIMER');
    colTimerSeconds.value = String(col?.boundary?.pause?.durationSeconds || 15);
    colRequireIntention.checked = Boolean(col?.boundary?.pause?.requireIntentionText);

    // Opening Message & Intensity
    const opMode = col?.openingMessageMode || 'NONE';
    const opRadio = collectionForm.querySelector<HTMLInputElement>(`input[name="colOpeningMode"][value="${opMode}"]`);
    if (opRadio) opRadio.checked = true;

    const intensity = col?.messageIntensity || 'MILD';
    const intensityRadio = collectionForm.querySelector<HTMLInputElement>(`input[name="colMessageIntensity"][value="${intensity}"]`);
    if (intensityRadio) intensityRadio.checked = true;
    updateIntensityHint(intensity);

    updateOpeningModeUI(opMode);
    colOpeningMessagesInput.value = col?.openingMessages && col.openingMessages.length > 0 ? col.openingMessages.join('\n') : '';

    // Custom Block Message
    colCustomBlockMessage.value = col?.customBlockMessage || '';

    // When Access Expires
    // New collections default to the gentler behavior: the page you are on is not pulled away mid-task.
    const whenExp = col ? (col.whenAccessExpires || 'IMMEDIATE') : 'NEXT_NAV';
    const whenExpRadio = collectionForm.querySelector<HTMLInputElement>(`input[name="colWhenExpires"][value="${whenExp}"]`);
    if (whenExpRadio) whenExpRadio.checked = true;

    collectionModal.showModal();
    collectionModalName.focus();
  }

  function formatMinuteToHHMM(minute: number): string {
    const h = Math.floor(minute / 60).toString().padStart(2, '0');
    const m = (minute % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
  }

  function parseHHMMToMinute(hhmm: string): number {
    const parts = hhmm.split(':');
    if (parts.length !== 2) return 0;
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    return Math.max(0, Math.min(1439, h * 60 + m));
  }

  function updateScheduleSummary() {
    const days: number[] = [];
    collectionForm.querySelectorAll<HTMLInputElement>('input[name="schedDay"]:checked').forEach((chk) => {
      days.push(parseInt(chk.value, 10));
    });

    const startMin = parseHHMMToMinute(schedStartTime.value);
    const endMin = parseHHMMToMinute(schedEndTime.value);

    const interval: ScheduleInterval = {
      days,
      startMinute: startMin,
      endMinute: endMin,
    };

    scheduleSummaryPreview.textContent = formatScheduleNaturalLanguage({
      enabled: true,
      intervals: [interval],
    });
  }

  // Event Listeners for Collection Modal
  collectionForm.querySelectorAll<HTMLInputElement>('input[name="colScheduleMode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      scheduleDetailsGroup.classList.toggle('is-hidden', !(radio.value === 'SCHEDULE' && radio.checked));
      if (radio.checked && radio.value === 'SCHEDULE') updateScheduleSummary();
    });
  });

  collectionForm.querySelectorAll<HTMLInputElement>('input[name="schedDay"]').forEach((chk) => {
    chk.addEventListener('change', updateScheduleSummary);
  });

  schedStartTime.addEventListener('input', updateScheduleSummary);
  schedEndTime.addEventListener('input', updateScheduleSummary);

  colEnableDailyLimit.addEventListener('change', () => {
    dailyLimitInputGroup.classList.toggle('is-hidden', !colEnableDailyLimit.checked);
    if (colEnableDailyLimit.checked) colDailyLimitMinutes.focus();
  });

  collectionForm.querySelectorAll<HTMLInputElement>('input[name="colEnforcementMode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const isStrict = radio.value === 'STRICT_BLOCK' && radio.checked;
      interventionSettingsGroup.classList.toggle('is-hidden', isStrict);
    });
  });

  collectionForm.querySelectorAll<HTMLInputElement>('input[name="colPauseType"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      colTimerDurationGroup.classList.toggle('is-hidden', !(radio.value === 'TIMER' && radio.checked));
    });
  });

  function updateIntensityHint(intensity: string) {
    if (!colIntensityHint) return;
    switch (intensity) {
      case 'SARCASTIC':
        colIntensityHint.textContent = 'Playful roast calling out routine excuses.';
        break;
      case 'SPICY':
        colIntensityHint.textContent = 'Direct confrontation puncturing procrastination.';
        break;
      case 'BRUTAL':
        colIntensityHint.textContent = 'Uncompromising behavioral callout targeting avoidance.';
        break;
      case 'MILD':
      default:
        colIntensityHint.textContent = 'Gentle interruption to prompt awareness.';
        break;
    }
  }

  function updateOpeningModeUI(mode: string) {
    colMomentLibraryGroup.classList.toggle('is-hidden', mode !== 'MOMENT_LIBRARY');
    colOpeningMessagesGroup.classList.toggle('is-hidden', mode !== 'CUSTOM' && mode !== 'RANDOM');
    if (colOpeningMessagesHint) {
      if (mode === 'CUSTOM') {
        colOpeningMessagesHint.textContent = 'Enter your custom message.';
      } else {
        colOpeningMessagesHint.textContent = 'Enter one message per line. In random mode, one is selected on each visit.';
      }
    }
  }

  collectionForm.querySelectorAll<HTMLInputElement>('input[name="colOpeningMode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        updateOpeningModeUI(radio.value);
      }
    });
  });

  collectionForm.querySelectorAll<HTMLInputElement>('input[name="colMessageIntensity"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        updateIntensityHint(radio.value);
      }
    });
  });

  btnCloseCollectionModal.addEventListener('click', () => {
    collectionModal.close();
    restoreFocus();
  });
  btnCancelCollection.addEventListener('click', () => {
    collectionModal.close();
    restoreFocus();
  });

  collectionForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    collectionModalNameError.textContent = '';
    colDailyLimitError.textContent = '';

    // Validate Name
    const nameVal = validateCollectionName(collectionModalName.value);
    if (!nameVal.valid) {
      collectionModalNameError.textContent = nameVal.error || 'Invalid collection name';
      collectionModalName.focus();
      return;
    }

    // Validate Daily Limit
    let dailyLimitMs: number | null = null;
    if (colEnableDailyLimit.checked) {
      const minutes = parseInt(colDailyLimitMinutes.value, 10);
      if (isNaN(minutes) || minutes < 1 || minutes > 1440) {
        colDailyLimitError.textContent = 'Daily limit must be between 1 and 1440 minutes.';
        colDailyLimitMinutes.focus();
        return;
      }
      dailyLimitMs = minutes * 60 * 1000;
    }

    // Color
    const colorInput = collectionForm.querySelector<HTMLInputElement>('input[name="colColor"]:checked');
    const color = colorInput?.value || '#15803d';

    // Schedule
    const schedModeInput = collectionForm.querySelector<HTMLInputElement>('input[name="colScheduleMode"]:checked');
    const isSchedule = schedModeInput?.value === 'SCHEDULE';
    let scheduleIntervals: ScheduleInterval[] = [];

    if (isSchedule) {
      const days: number[] = [];
      collectionForm.querySelectorAll<HTMLInputElement>('input[name="schedDay"]:checked').forEach((chk) => {
        days.push(parseInt(chk.value, 10));
      });
      const startMin = parseHHMMToMinute(schedStartTime.value);
      const endMin = parseHHMMToMinute(schedEndTime.value);
      scheduleIntervals = [{ days, startMinute: startMin, endMinute: endMin }];
    }

    // Enforcement Mode
    const enfInput = collectionForm.querySelector<HTMLInputElement>('input[name="colEnforcementMode"]:checked');
    const isStrict = enfInput?.value === 'STRICT_BLOCK';

    // Pause Type
    const pauseTypeInput = collectionForm.querySelector<HTMLInputElement>('input[name="colPauseType"]:checked');
    const chosenPauseType = (pauseTypeInput?.value || 'BREATHE') as 'BREATHE' | 'TIMER' | 'CONFIRM';
    let durationSeconds = 10;
    if (chosenPauseType === 'TIMER') {
      const s = parseInt(colTimerSeconds.value, 10);
      durationSeconds = Math.max(5, Math.min(60, isNaN(s) ? 15 : s));
    } else if (chosenPauseType === 'CONFIRM') {
      durationSeconds = 0;
    }

    const finalPauseType = isStrict ? 'NONE' : chosenPauseType;
    const finalDurationSeconds = isStrict ? 0 : durationSeconds;
    const finalRequireIntention = isStrict ? false : colRequireIntention.checked;

    // Opening Message & Intensity
    const opModeInput = collectionForm.querySelector<HTMLInputElement>('input[name="colOpeningMode"]:checked');
    const opMode = (opModeInput?.value || 'NONE') as OpeningMessageMode;
    const intensityInput = collectionForm.querySelector<HTMLInputElement>('input[name="colMessageIntensity"]:checked');
    const messageIntensity = (intensityInput?.value || 'MILD') as MessageIntensity;
    const rawOpeningText = colOpeningMessagesInput.value || '';
    const openingMessages = rawOpeningText
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= 250)
      .slice(0, 10);

    // Custom Block Message
    const customBlockMessage = colCustomBlockMessage.value.trim() || null;

    // When Access Expires
    const whenExpInput = collectionForm.querySelector<HTMLInputElement>('input[name="colWhenExpires"]:checked');
    const whenAccessExpires = (whenExpInput?.value === 'NEXT_NAV' ? 'NEXT_NAV' : 'IMMEDIATE') as WhenAccessExpires;

    const boundary: BoundaryPolicy = {
      schedule: {
        enabled: isSchedule,
        intervals: scheduleIntervals,
      },
      limits: {
        dailyMinutes: dailyLimitMs ? Math.round(dailyLimitMs / 60000) : null,
        sessionMinutes: null,
      },
      pause: {
        type: finalPauseType,
        durationSeconds: finalDurationSeconds,
        requireIntentionText: finalRequireIntention,
      },
      action: { type: 'BLOCK_PAGE', redirectUrl: null },
      strictMode: isStrict,
    };

    const colId = collectionModalId.value;

    // Stale State Check: Re-read canonical state before committing mutations
    const latestCols = await loadCollections();

    if (colId) {
      if (!latestCols[colId]) {
        showAlert('This collection was deleted in another window or tab.', 'error');
        collectionModal.close();
        restoreFocus();
        renderCollections(latestCols);
        return;
      }

      // UPDATE
      const res: any = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'UPDATE_COLLECTION',
          collectionId: colId,
          updates: {
            name: nameVal.sanitized!,
            color,
            dailyLimitMs,
            boundary,
            customBlockMessage,
            openingMessageMode: opMode,
            messageIntensity,
            openingMessages,
            whenAccessExpires,
          },
        }, resolve);
      });

      if (!res?.success) {
        collectionModalNameError.textContent = res?.error || 'Failed to update collection';
        return;
      }
      showAlert(`Collection "${nameVal.sanitized}" updated.`);
    } else {
      // CREATE
      const res: any = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'CREATE_COLLECTION',
          name: nameVal.sanitized!,
          color,
          icon: 'shield',
          dailyLimitMs,
          boundary,
          customBlockMessage,
          openingMessageMode: opMode,
          messageIntensity,
          openingMessages,
          whenAccessExpires,
        }, resolve);
      });

      if (!res?.success) {
        collectionModalNameError.textContent = res?.error || 'Failed to create collection';
        return;
      }
      showAlert(`Collection "${nameVal.sanitized}" created.`);
    }

    collectionModal.close();
    restoreFocus();
    const updated = await loadCollections();
    renderCollections(updated);
  });

  btnNewCollection.addEventListener('click', () => openCollectionModal(null));

  // --- RULE MODAL ---
  const ruleTypeDescriptions: Record<TargetRuleType, string> = {
    WEBSITE: 'Matches example.com and any subdomains (like blog.example.com).',
    EXACT_HOST: 'Matches only the exact host specified (e.g. sub.example.com, not example.com).',
    PATH_PREFIX: 'Matches the host and any path beginning with the prefix (e.g. site.com/feed/).',
    EXACT_PAGE: 'Matches the exact page URL and path only.',
    GLOB: 'Wildcard pattern using * and ? (e.g. *.example.com/*news*).',
  };

  function updateRuleHelper() {
    const type = ruleModalType.value as TargetRuleType;
    ruleTypeHelperText.textContent = ruleTypeDescriptions[type] || '';
  }

  function openRuleModal(colId: string, rule: Target | null) {
    rememberFocus();
    const col = collectionsState[colId];
    ruleModalTitle.textContent = rule ? `Edit Rule (${col?.name || 'Collection'})` : `Add Rule to ${col?.name || 'Collection'}`;
    ruleModalCollectionId.value = colId;
    ruleModalRuleId.value = rule ? rule.id : '';
    ruleModalPattern.value = rule ? rule.pattern : '';
    ruleModalType.value = rule ? rule.type : 'WEBSITE';
    ruleModalIsException.checked = rule ? Boolean(rule.isException) : false;
    ruleModalPatternError.textContent = '';
    ruleExceptionNotice.classList.toggle('is-hidden', !ruleModalIsException.checked);
    updateRuleHelper();

    ruleModal.showModal();
    ruleModalPattern.focus();
  }

  ruleModalType.addEventListener('change', updateRuleHelper);

  ruleModalIsException.addEventListener('change', () => {
    ruleExceptionNotice.classList.toggle('is-hidden', !ruleModalIsException.checked);
  });

  btnCloseRuleModal.addEventListener('click', () => {
    ruleModal.close();
    restoreFocus();
  });
  btnCancelRule.addEventListener('click', () => {
    ruleModal.close();
    restoreFocus();
  });

  ruleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    ruleModalPatternError.textContent = '';

    const colId = ruleModalCollectionId.value;
    const ruleId = ruleModalRuleId.value;
    const ruleType = ruleModalType.value as TargetRuleType;
    const patternInput = ruleModalPattern.value;
    const isException = ruleModalIsException.checked;

    const patternVal = validateTargetPattern(patternInput, ruleType);
    if (!patternVal.valid) {
      ruleModalPatternError.textContent = patternVal.error || 'Invalid pattern';
      ruleModalPattern.focus();
      return;
    }

    // Stale State Check: Re-read canonical collections before committing rule mutations
    const latestCols = await loadCollections();
    if (!latestCols[colId]) {
      showAlert('The parent collection was deleted in another window or tab.', 'error');
      ruleModal.close();
      restoreFocus();
      renderCollections(latestCols);
      return;
    }

    if (ruleId && !latestCols[colId].targets.some((t) => t.id === ruleId)) {
      showAlert('This rule was deleted in another window or tab.', 'error');
      ruleModal.close();
      restoreFocus();
      renderCollections(latestCols);
      return;
    }

    if (ruleId) {
      // UPDATE RULE
      const res: any = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'UPDATE_RULE',
          collectionId: colId,
          ruleId,
          updates: {
            pattern: patternVal.sanitized!,
            type: ruleType,
            isException,
          },
        }, resolve);
      });

      if (!res?.success) {
        ruleModalPatternError.textContent = res?.error || 'Failed to update rule';
        return;
      }
      showAlert(`Rule "${patternVal.sanitized}" updated.`);
    } else {
      // CREATE RULE
      const res: any = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'CREATE_RULE',
          collectionId: colId,
          pattern: patternVal.sanitized!,
          ruleType,
          isException,
        }, resolve);
      });

      if (!res?.success) {
        ruleModalPatternError.textContent = res?.error || 'Failed to add rule';
        return;
      }
      showAlert(`Rule "${patternVal.sanitized}" added.`);
    }

    ruleModal.close();
    restoreFocus();
    const updated = await loadCollections();
    renderCollections(updated);
  });

  // --- CONFIRM MODAL (DELETIONS) ---
  function openConfirmModal(title: string, message: string, onConfirm: () => Promise<void>) {
    rememberFocus();
    confirmModalTitle.textContent = title;
    confirmModalMessage.textContent = message;
    pendingConfirmAction = onConfirm;
    confirmModal.showModal();
    btnConfirmCancel.focus();
  }

  function closeConfirmModal() {
    pendingConfirmAction = null;
    confirmModal.close();
    restoreFocus();
  }

  btnCloseConfirmModal.addEventListener('click', closeConfirmModal);
  btnConfirmCancel.addEventListener('click', closeConfirmModal);

  btnConfirmDanger.addEventListener('click', async () => {
    if (pendingConfirmAction) {
      await pendingConfirmAction();
    }
    closeConfirmModal();
  });

  function confirmDeleteCollection(colId: string, colName: string) {
    openConfirmModal(
      'Delete Collection',
      `Are you sure you want to delete "${colName}"? All rules within this collection will be permanently removed.`,
      async () => {
        const latestCols = await loadCollections();
        if (!latestCols[colId]) {
          showAlert('This collection was already deleted in another window or tab.', 'error');
          renderCollections(latestCols);
          return;
        }

        const res: any = await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            type: 'DELETE_COLLECTION',
            collectionId: colId,
          }, resolve);
        });

        if (res?.success) {
          showAlert(`Collection "${colName}" deleted.`);
          const updated = await loadCollections();
          renderCollections(updated);
        } else {
          showAlert(res?.error || 'Failed to delete collection.', 'error');
        }
      }
    );
  }

  function confirmDeleteRule(colId: string, ruleId: string, pattern: string) {
    openConfirmModal(
      'Delete Rule',
      `Are you sure you want to delete rule "${pattern}"?`,
      async () => {
        const latestCols = await loadCollections();
        if (!latestCols[colId] || !latestCols[colId].targets.some((t) => t.id === ruleId)) {
          showAlert('This rule was already deleted in another window or tab.', 'error');
          renderCollections(latestCols);
          return;
        }

        const res: any = await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            type: 'DELETE_RULE',
            collectionId: colId,
            ruleId,
          }, resolve);
        });

        if (res?.success) {
          showAlert(`Rule "${pattern}" removed.`);
          const updated = await loadCollections();
          renderCollections(updated);
        } else {
          showAlert(res?.error || 'Failed to remove rule.', 'error');
        }
      }
    );
  }

  // --- GENERAL SETTINGS ---
  function loadSettings() {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (res: any) => {
        if (res?.success && res.data) {
          const settings: UserSettings = res.data;
          setAccentPreferences(settings.accentLight, settings.accentDark);
          applyTheme(settings.theme);
          for (const [name, value] of [['accentLight', settings.accentLight], ['accentDark', settings.accentDark]] as const) {
            const accentRadio = tabSettings.querySelector<HTMLInputElement>(`input[name="${name}"][value="${sanitizeAccentId(value)}"]`);
            if (accentRadio) accentRadio.checked = true;
          }
          applyReducedMotion(Boolean(settings.reducedMotion));

          const themeRadio = tabSettings.querySelector<HTMLInputElement>(`input[name="settingTheme"][value="${settings.theme}"]`);
          if (themeRadio) themeRadio.checked = true;

          const timeRadio = tabSettings.querySelector<HTMLInputElement>(`input[name="settingTimeFormat"][value="${settings.timeFormat}"]`);
          if (timeRadio) timeRadio.checked = true;

          const unlockRadio = tabSettings.querySelector<HTMLInputElement>(`input[name="settingUnlockScope"][value="${settings.temporaryUnlockScope || 'THIS_TAB_ONLY'}"]`);
          if (unlockRadio) unlockRadio.checked = true;

          settingReducedMotion.checked = Boolean(settings.reducedMotion);
        }
      });
    }
  }

  // Accent color swatches (one grid per appearance)
  const ACCENT_GROUP_LABELS: Record<AccentGroup, string> = {
    moment: 'Moment',
    gnome: 'GNOME',
    firefox: 'Firefox',
  };

  function buildAccentGrid(container: HTMLElement | null, name: 'accentLight' | 'accentDark') {
    if (!container) return;
    (['moment', 'gnome', 'firefox'] as AccentGroup[]).forEach((group) => {
      const groupEl = document.createElement('div');
      groupEl.className = 'accent-group';
      const title = document.createElement('span');
      title.className = 'accent-group-title';
      title.textContent = ACCENT_GROUP_LABELS[group];
      groupEl.appendChild(title);

      const row = document.createElement('div');
      row.className = 'accent-row';
      ACCENTS.filter((a) => a.group === group).forEach((a) => {
        const label = document.createElement('label');
        label.className = 'accent-swatch';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = name;
        input.value = a.id;
        input.setAttribute('aria-label', `${ACCENT_GROUP_LABELS[group]} ${a.label}`);
        if (a.id === 'moment') input.checked = true;
        const dot = document.createElement('span');
        dot.className = 'accent-dot';
        dot.title = a.label;
        dot.style.setProperty('--dot', a.hex);
        const text = document.createElement('span');
        text.className = 'accent-name';
        text.textContent = a.label.replace('Firefox ', '');
        label.append(input, dot, text);
        row.appendChild(label);
      });
      groupEl.appendChild(row);
      container.appendChild(groupEl);
    });
  }

  buildAccentGrid(document.getElementById('accentGridLight'), 'accentLight');
  buildAccentGrid(document.getElementById('accentGridDark'), 'accentDark');

  function readAccent(name: 'accentLight' | 'accentDark'): string {
    return tabSettings.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value || 'moment';
  }

  function previewAppearance() {
    setAccentPreferences(readAccent('accentLight'), readAccent('accentDark'));
    const themeInput = tabSettings.querySelector<HTMLInputElement>('input[name="settingTheme"]:checked');
    applyTheme(themeInput?.value || 'system');
  }

  tabSettings.addEventListener('change', (ev) => {
    const target = ev.target as HTMLInputElement;
    if (target?.name === 'accentLight' || target?.name === 'accentDark') previewAppearance();
  });

  // Live Theme Switching
  tabSettings.querySelectorAll<HTMLInputElement>('input[name="settingTheme"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) applyTheme(radio.value);
    });
  });

  btnSaveSettings.addEventListener('click', async () => {
    const themeInput = tabSettings.querySelector<HTMLInputElement>('input[name="settingTheme"]:checked');
    const timeInput = tabSettings.querySelector<HTMLInputElement>('input[name="settingTimeFormat"]:checked');
    const unlockInput = tabSettings.querySelector<HTMLInputElement>('input[name="settingUnlockScope"]:checked');

    const theme = (themeInput?.value || 'system') as 'system' | 'light' | 'dark' | 'sepia';
    const timeFormat = (timeInput?.value || '24h') as '12h' | '24h';
    const temporaryUnlockScope = (unlockInput?.value || 'THIS_TAB_ONLY') as 'THIS_TAB_ONLY' | 'ALL_TABS_UNTIL_EXPIRATION';
    const reducedMotion = settingReducedMotion.checked;

    const res: any = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        settings: {
          theme,
          accentLight: readAccent('accentLight'),
          accentDark: readAccent('accentDark'),
          timeFormat,
          reducedMotion,
          temporaryUnlockScope,
        },
      }, resolve);
    });

    if (res?.success) {
      settingsStatusMsg.textContent = 'Settings saved.';
      settingsStatusMsg.className = 'status-msg success';
      applyTheme(theme);
      applyReducedMotion(reducedMotion);
    } else {
      settingsStatusMsg.textContent = res?.error || 'Failed to save settings.';
      settingsStatusMsg.className = 'status-msg error';
    }

    setTimeout(() => {
      settingsStatusMsg.textContent = '';
      settingsStatusMsg.className = 'status-msg';
    }, 3000);
  });

  // --- IMPORT / EXPORT ---
  btnExportJson.addEventListener('click', async () => {
    const res: any = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'EXPORT_DATA' }, resolve);
    });

    if (res?.success && res.data) {
      const jsonStr = JSON.stringify(res.data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const dateStr = new Date().toISOString().split('T')[0];

      const a = document.createElement('a');
      a.href = url;
      a.download = `moment-backup-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showAlert('Configuration exported successfully.');
    } else {
      showAlert('Failed to export configuration.', 'error');
    }
  });

  btnImportJson.addEventListener('click', async () => {
    importStatusReport.textContent = '';
    importStatusReport.className = 'import-status-report';

    const files = importFileInput.files;
    if (!files || files.length === 0) {
      importStatusReport.textContent = 'Please select a JSON file to import.';
      importStatusReport.classList.add('error');
      return;
    }

    const file = files[0];
    const reader = new FileReader();

    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);

        const modeInput = tabImportExport.querySelector<HTMLInputElement>('input[name="importMode"]:checked');
        const mode = modeInput?.value || 'merge';

        const res: any = await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            type: 'IMPORT_DATA',
            data: parsed,
            mode,
          }, resolve);
        });

        if (res?.success) {
          const count = res.data?.importedCollectionsCount || 0;
          importStatusReport.textContent = `Successfully imported ${count} collection(s).`;
          importStatusReport.classList.add('success');
          showAlert(`Import complete: ${count} collection(s) loaded.`);

          const updated = await loadCollections();
          renderCollections(updated);
        } else {
          importStatusReport.textContent = `Import failed: ${res?.error || 'Invalid configuration file'}`;
          importStatusReport.classList.add('error');
        }
      } catch (err: any) {
        importStatusReport.textContent = `Failed to parse JSON: ${err.message}`;
        importStatusReport.classList.add('error');
      }
    };

    reader.readAsText(file);
  });

  // --- ESCAPE KEY LISTENER ---
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      let closed = false;
      if (collectionModal.open) {
        collectionModal.close();
        closed = true;
      }
      if (ruleModal.open) {
        ruleModal.close();
        closed = true;
      }
      if (confirmModal.open) {
        closeConfirmModal();
        closed = true;
      }
      if (closed) {
        restoreFocus();
      }
    }
  });

  // Display Extension Version from Manifest
  if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
    const manifest = chrome.runtime.getManifest();
    if (manifest?.version) {
      extensionVersionDisplay.textContent = manifest.version;
      sidebarVersionDisplay.textContent = `Moment v${manifest.version}`;
    }
  }

  // Check Schema Version
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (res: any) => {
      if (res?.success && res.data) {
        schemaVersionDisplay.textContent = `v${res.data.schemaVersion || 3}`;
      }
    });
  }

  // --- MOBILE SOFT KEYBOARD AUTO-SCROLL FIX ---
  document.addEventListener('focusin', (e) => {
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
      setTimeout(() => {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 150);
    }
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      const active = document.activeElement as HTMLElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
        setTimeout(() => {
          active.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
      }
    });
  }

  // --- INITIAL BOOT ---
  loadSettings();
  loadCollections().then(renderCollections);
});

