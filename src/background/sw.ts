// D-01: the service worker only opens the side panel and writes the default settings on install.
// Batches run in the panel. No network requests, timers or polling here (no background activity).
// D-32: the history is kept, so there is no retention cleanup any more.

import { ensureDefaultSettings } from '../store/settings';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

chrome.runtime.onInstalled.addListener(() => {
  void ensureDefaultSettings();
});
