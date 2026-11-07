import { sanitizeUrlForDisplay, isSafeDestination } from '../../shared/urls.js';
import '../../shared/types.js';
import { initTheme } from '../theme.js';

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  const urlParams = new URLSearchParams(window.location.search);
  const target = urlParams.get('target') || 'Managed Site';
  const collection = urlParams.get('collection') || 'Default Boundaries';
  const collectionName = urlParams.get('collectionName');
  const customMessage = urlParams.get('message');
  const reason = urlParams.get('reason');
  const collectionId = urlParams.get('collection') || '';

  const targetDisplay = document.getElementById('targetDisplay')!;
  const collectionDisplay = document.getElementById('collectionDisplay')!;
  const reasonDesc = document.getElementById('reasonDesc');
  const btnBack = document.getElementById('btnBack')!;
  const btnClose = document.getElementById('btnClose')!;

  targetDisplay.textContent = sanitizeUrlForDisplay(target);
  collectionDisplay.textContent =
    collectionName && collectionName.trim().length > 0 ? collectionName.trim() : collection;

  if (customMessage && customMessage.trim().length > 0 && reasonDesc) {
    reasonDesc.textContent = customMessage.trim();
  }

  btnBack.addEventListener('click', () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.replace('about:blank');
    }
  });

  btnClose.addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.tabs?.getCurrent) {
      chrome.tabs.getCurrent((tab: any) => {
        if (tab?.id) chrome.tabs.remove(tab.id);
        else window.close();
      });
    } else {
      window.close();
    }
  });

  // --- Daily budget: explain, and offer an intention-gated extension -------------------
  if (reason === 'DAILY_LIMIT_EXHAUSTED' && collectionId && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    const extensionBox = document.getElementById('extensionBox')!;
    const extensionIntention = document.getElementById('extensionIntention') as HTMLTextAreaElement;
    const btnExtend = document.getElementById('btnExtend') as HTMLButtonElement;
    const extensionNote = document.getElementById('extensionNote')!;
    const extensionStatus = document.getElementById('extensionStatus')!;
    const headline = document.querySelector('.headline');
    const hasCustomMessage = Boolean(customMessage && customMessage.trim().length > 0);

    if (headline) headline.textContent = "You've reached today's limit";

    const syncButton = () => {
      const ok = extensionIntention.value.trim().length >= 3;
      btnExtend.disabled = !ok;
      btnExtend.setAttribute('aria-disabled', String(!ok));
    };
    extensionIntention.addEventListener('input', syncButton);

    chrome.runtime.sendMessage({ type: 'GET_BUDGET_STATUS', collectionId }, (res: any) => {
      const data = res && res.success ? res.data : null;
      if (!data) return;
      if (reasonDesc && !hasCustomMessage && data.formattedLimit) {
        reasonDesc.textContent = `You've used your ${data.formattedLimit} for ${data.collectionName} today. It resets at midnight.`;
      }
      if (data.extensionAllowed) {
        const mins = Math.round(data.extensionMs / 60000);
        btnExtend.textContent = `Add ${mins} more minutes`;
        extensionNote.textContent = `${data.extensionsRemaining} extension${data.extensionsRemaining === 1 ? '' : 's'} left today.`;
        extensionBox.classList.remove('is-hidden');
      } else if (data.extensionsRemaining <= 0) {
        extensionStatus.textContent = 'No extensions left for today. Your limit resets at midnight.';
      }
    });

    btnExtend.addEventListener('click', () => {
      btnExtend.disabled = true;
      btnExtend.setAttribute('aria-disabled', 'true');
      chrome.runtime.sendMessage(
        { type: 'REQUEST_BUDGET_EXTENSION', collectionId, intentionText: extensionIntention.value.trim() },
        (res: any) => {
          if (res && res.success && isSafeDestination(target)) {
            extensionStatus.textContent = 'Extra time added. Take only what you need.';
            window.location.replace(target);
          } else {
            extensionStatus.textContent = res?.error || 'Could not add time.';
            syncButton();
          }
        }
      );
    });
  }
});
