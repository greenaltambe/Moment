import { sanitizeUrlForDisplay } from '../../shared/urls.js';
import '../../shared/types.js';
import { initTheme } from '../theme.js';

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  const urlParams = new URLSearchParams(window.location.search);
  const target = urlParams.get('target') || 'Managed Site';
  const collection = urlParams.get('collection') || 'Default Boundaries';
  const collectionName = urlParams.get('collectionName');
  const customMessage = urlParams.get('message');

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
});
