import type { ChecksStore } from './checks';
import { DEFAULT_SETTINGS } from './settings';
import { SESSION_KEY } from './supabase';

/**
 * FR-34: deletes the user's history in the database and everything stored in the browser (results
 * waiting to upload, the daily count, the Upwork token, settings), leaving only the default settings.
 * The database sign-in is kept, so the user is not signed out.
 */
export async function deleteAllData(checks: ChecksStore): Promise<void> {
  await checks.removeAll();
  const session = (await chrome.storage.local.get(SESSION_KEY))[SESSION_KEY];
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ settings: DEFAULT_SETTINGS, ...(session ? { [SESSION_KEY]: session } : {}) });
  await chrome.storage.session.clear();
}
