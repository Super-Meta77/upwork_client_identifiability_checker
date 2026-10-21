import { deleteAllResults, deleteOlderThan } from './db';
import { DEFAULT_SETTINGS, loadSettings } from './settings';

const DAY_MS = 24 * 60 * 60 * 1000;

/** NFR-11 / D-24: delete results older than the retention period. Runs on browser start and panel open. */
export async function runRetention(now = new Date()): Promise<number> {
  const { retentionDays } = await loadSettings();
  return deleteOlderThan(new Date(now.getTime() - retentionDays * DAY_MS).toISOString());
}

/** FR-34: leaves IndexedDB empty and chrome.storage.local holding only the default settings. */
export async function deleteAllData(): Promise<void> {
  await deleteAllResults();
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  await chrome.storage.session.clear();
}
