/**
 * Moment Intervention Shell Controller
 * Implements Phase 3 Behavioral Mindfulness Interventions:
 * - Conscious Confirmation (CONFIRM)
 * - Intent Timer (TIMER)
 * - Calm Breathing (BREATHE)
 * - Reduced-motion support and keyboard accessibility
 * - Window.location.replace() loop prevention invariant
 */

import { sanitizeUrlForDisplay } from '../../shared/urls.js';
import '../../shared/types.js';
import { initTheme } from '../theme.js';

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  const urlParams = new URLSearchParams(window.location.search);
  const targetUrl = urlParams.get('target') || '';
  const tabId = parseInt(urlParams.get('tabId') || '-1', 10);
  const nonce = urlParams.get('nonce') || '';
  const fallbackType = (urlParams.get('type') || 'CONFIRM').toUpperCase();
  const fallbackDuration = parseInt(urlParams.get('duration') || '0', 10);

  const headlineEl = document.getElementById('interventionHeadline')!;
  const subtitleEl = document.getElementById('interventionSubtitle')!;
  const destUrlEl = document.getElementById('destUrl')!;
  const btnComplete = document.getElementById('btnComplete') as HTMLButtonElement;
  const btnCancel = document.getElementById('btnCancel') as HTMLButtonElement;
  const statusMsg = document.getElementById('statusMsg')!;

  // Dynamic elements
  const breathePacer = document.getElementById('breathePacer')!;
  const breatheCircle = document.getElementById('breatheCircle')!;
  const breathePhaseText = document.getElementById('breathePhaseText')!;
  const timerContainer = document.getElementById('timerContainer')!;
  const timerDisplay = document.getElementById('timerDisplay')!;
  const timerProgressBar = document.getElementById('timerProgressBar')!;
  const intentionBox = document.getElementById('intentionBox')!;
  const intentionInput = document.getElementById('intentionText') as HTMLTextAreaElement;

  // Validation: Guard against missing or malformed navigation params
  if (!targetUrl || tabId === -1 || !nonce) {
    destUrlEl.textContent = 'Invalid or missing navigation parameters.';
    btnComplete.disabled = true;
    btnComplete.setAttribute('aria-disabled', 'true');
    statusMsg.textContent = 'Error: Navigation context could not be verified.';
    return;
  }

  // Safe destination display (textContent only, credential stripped)
  destUrlEl.textContent = sanitizeUrlForDisplay(targetUrl);

  let activeInterventionType = fallbackType;
  let activeDurationSeconds = fallbackDuration;
  let requireIntentionText = false;
  let timerInterval: ReturnType<typeof setInterval> | null = null;
  let isTimerCompleted = false;
  let customOpeningMessage: string | null = null;

  // Check user motion preferences
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Query background for authoritative intervention state
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage(
      {
        type: 'GET_INTERVENTION',
        tabId,
        nonce,
      },
      (res: any) => {
        if (res && res.success && res.data) {
          activeInterventionType = res.data.interventionType;
          activeDurationSeconds = res.data.durationSeconds;
          requireIntentionText = res.data.requireIntentionText;
          if (res.data.openingMessage) {
            customOpeningMessage = res.data.openingMessage;
            subtitleEl.textContent = customOpeningMessage;
          } else if (res.data.collectionName) {
            subtitleEl.textContent = `Paused according to '${res.data.collectionName}' boundaries.`;
          }
        }
        setupInterventionUI();
      }
    );
  } else {
    // Standalone / demo fallback
    setupInterventionUI();
  }

  function updateCompletionButtonState() {
    if (requireIntentionText) {
      const hasText = intentionInput.value.trim().length > 0;
      const canProceed = isTimerCompleted && hasText;
      btnComplete.disabled = !canProceed;
      btnComplete.setAttribute('aria-disabled', String(!canProceed));
    } else {
      btnComplete.disabled = !isTimerCompleted;
      btnComplete.setAttribute('aria-disabled', String(!isTimerCompleted));
    }
  }

  if (intentionInput) {
    intentionInput.addEventListener('input', () => {
      updateCompletionButtonState();
    });
  }

  function setupInterventionUI() {
    if (requireIntentionText) {
      intentionBox.classList.remove('is-hidden');
    }

    switch (activeInterventionType) {
      case 'BREATHE': {
        setupBreathingIntervention();
        break;
      }

      case 'TIMER': {
        setupTimerIntervention();
        break;
      }

      case 'CONFIRM':
      default: {
        setupConfirmIntervention();
        break;
      }
    }
  }

  // MODE A: Conscious Confirmation
  function setupConfirmIntervention() {
    headlineEl.textContent = 'Pause for a moment';
    isTimerCompleted = true;
    updateCompletionButtonState();
    statusMsg.textContent = 'You have full autonomy to continue or turn back.';
  }

  // MODE B: Intent Timer
  function setupTimerIntervention() {
    const totalSeconds = activeDurationSeconds > 0 ? activeDurationSeconds : 5;
    let remainingSeconds = totalSeconds;

    headlineEl.textContent = 'Intentional Pause';
    if (!customOpeningMessage) {
      subtitleEl.textContent = 'Please pause briefly before continuing.';
    }
    timerContainer.classList.remove('is-hidden');
    timerDisplay.textContent = `${remainingSeconds}s`;

    isTimerCompleted = false;
    updateCompletionButtonState();

    const startTime = Date.now();
    const durationMs = totalSeconds * 1000;

    timerInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remainingMs = Math.max(0, durationMs - elapsed);
      const secondsLeft = Math.ceil(remainingMs / 1000);

      timerDisplay.textContent = `${secondsLeft}s`;
      const percent = (remainingMs / durationMs) * 100;
      timerProgressBar.style.width = `${percent}%`;

      if (remainingMs <= 0) {
        if (timerInterval) clearInterval(timerInterval);
        isTimerCompleted = true;
        timerDisplay.textContent = '0s';
        timerProgressBar.style.width = '0%';
        statusMsg.textContent = 'Pause complete. You may intentionally continue.';
        updateCompletionButtonState();
      }
    }, 100);
  }

  // MODE C: Calm Breathing
  function setupBreathingIntervention() {
    headlineEl.textContent = 'Take a breath';
    if (!customOpeningMessage) {
      subtitleEl.textContent = 'Follow the gentle rhythm to center your attention.';
    }

    breathePacer.classList.remove('is-hidden');
    breathePhaseText.classList.remove('is-hidden');

    isTimerCompleted = false;
    updateCompletionButtonState();

    // 4-Phase box breathing: Inhale (4s), Hold (2s), Exhale (4s), Rest (2s) = 12s total
    const phases = [
      { name: 'Breathe in...', duration: 4000, className: 'inhale' },
      { name: 'Hold...', duration: 2000, className: 'hold' },
      { name: 'Breathe out...', duration: 4000, className: 'exhale' },
      { name: 'Rest...', duration: 2000, className: 'rest' },
    ];

    let currentPhaseIdx = 0;
    let cycleCount = 0;
    const requiredCycles = 1; // 1 full cycle for standard pause

    function runBreathingPhase() {
      const phase = phases[currentPhaseIdx];
      breathePhaseText.textContent = prefersReducedMotion
        ? `[Phase ${currentPhaseIdx + 1} of 4] ${phase.name}`
        : phase.name;

      if (!prefersReducedMotion) {
        breatheCircle.className = `breathe-circle ${phase.className}`;
      }

      setTimeout(() => {
        currentPhaseIdx++;
        if (currentPhaseIdx >= phases.length) {
          currentPhaseIdx = 0;
          cycleCount++;
        }

        if (cycleCount >= requiredCycles) {
          breathePhaseText.textContent = 'Breathing complete. You may continue.';
          isTimerCompleted = true;
          updateCompletionButtonState();
        } else {
          runBreathingPhase();
        }
      }, phase.duration);
    }

    runBreathingPhase();
  }

  // Completion Handler
  btnComplete.addEventListener('click', () => {
    if (!isTimerCompleted) return;

    btnComplete.disabled = true;
    btnComplete.setAttribute('aria-disabled', 'true');
    statusMsg.textContent = 'Authorizing temporary access...';

    const intentionText = intentionInput ? intentionInput.value.trim() : '';

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(
        {
          type: 'COMPLETE_INTERVENTION',
          tabId,
          targetUrl,
          nonce,
          intentionText,
        },
        (res: any) => {
          if (res && res.success && res.data?.targetUrl) {
            statusMsg.textContent = "Authorized. You're free to browse for 5 minutes.";
            // Mandatory Invariant: Use window.location.replace to eliminate back-button loops
            window.location.replace(res.data.targetUrl);
          } else {
            statusMsg.textContent = `Authorization failed: ${res?.error || 'Unknown error'}`;
            btnComplete.disabled = false;
            btnComplete.setAttribute('aria-disabled', 'false');
          }
        }
      );
    } else {
      statusMsg.textContent = 'Demo Mode: window.location.replace() simulated.';
    }
  });

  // Cancellation Handler
  btnCancel.addEventListener('click', () => {
    if (timerInterval) clearInterval(timerInterval);

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(
        {
          type: 'CANCEL_INTERVENTION',
          tabId,
          nonce,
        },
        () => {
          // Mandatory Invariant: Never history.back() to avoid revisiting the blocked URL
          window.location.replace('about:blank');
        }
      );
    } else {
      window.location.replace('about:blank');
    }
  });

  // Intent Pass elements and handlers
  const btnToggleIntentPass = document.getElementById('btnToggleIntentPass');
  const intentPassOptions = document.getElementById('intentPassOptions');
  const durationButtons = document.querySelectorAll<HTMLButtonElement>('.btn-intent-duration');

  if (btnToggleIntentPass && intentPassOptions) {
    btnToggleIntentPass.addEventListener('click', () => {
      const isExpanded = btnToggleIntentPass.getAttribute('aria-expanded') === 'true';
      btnToggleIntentPass.setAttribute('aria-expanded', String(!isExpanded));
      intentPassOptions.classList.toggle('is-hidden', isExpanded);
    });
  }

  durationButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const durationMs = parseInt(btn.getAttribute('data-duration') || '900000', 10);
      const minutes = Math.round(durationMs / 60000);

      // Disable buttons while processing
      durationButtons.forEach((b) => (b.disabled = true));
      btnComplete.disabled = true;
      btnComplete.setAttribute('aria-disabled', 'true');
      btnCancel.disabled = true;
      statusMsg.textContent = `Activating ${minutes}-minute Intent Pass...`;

      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage(
          {
            type: 'REQUEST_INTENT_PASS',
            tabId,
            durationMs,
          },
          (res: any) => {
            if (res && res.success && res.data?.destinationUrl) {
              statusMsg.textContent = `Intent Pass active (${minutes}m). Loading...`;
              // Mandatory Invariant: Use window.location.replace to eliminate back-button loops
              window.location.replace(res.data.destinationUrl);
            } else {
              statusMsg.textContent = `Could not activate Intent Pass: ${res?.error || 'Unknown error'}`;
              durationButtons.forEach((b) => (b.disabled = false));
              btnCancel.disabled = false;
              updateCompletionButtonState();
            }
          }
        );
      } else {
        statusMsg.textContent = `Demo Mode: Intent Pass for ${minutes}m activated.`;
      }
    });
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
});
