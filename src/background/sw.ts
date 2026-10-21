// D-01: the service worker only opens the side panel and keeps housekeeping. Batches run in the panel.
// No network requests, timers or polling here (constraints: no background activity).

import { runRetention } from '../store/maintenance';
import { ensureDefaultSettings } from '../store/settings';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

chrome.runtime.onInstalled.addListener(() => {
  void ensureDefaultSettings();
});

// D-24: retention runs when the browser starts (and whenever the panel opens).
chrome.runtime.onStartup.addListener(() => {
  void runRetention().catch(() => undefined);
});
