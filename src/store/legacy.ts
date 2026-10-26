// D-32: results that earlier versions kept in the extension's own IndexedDB. After sign-in they are
// uploaded once (checks.ts moveLegacyHistory), then this database is deleted.

import type { Result } from '../core/types';

export const LEGACY_DB = 'upwork-checker';

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** The saved results, or null when there is no old database. */
export async function readLegacyResults(factory: IDBFactory = indexedDB): Promise<Result[] | null> {
  // Opening a database that does not exist would create it, so look first.
  const names = await factory.databases();
  if (!names.some((d) => d.name === LEGACY_DB)) return null;
  const db = await request(factory.open(LEGACY_DB));
  try {
    if (!db.objectStoreNames.contains('results')) return [];
    return (await request(db.transaction('results').objectStore('results').getAll())) as Result[];
  } finally {
    db.close();
  }
}

export function deleteLegacyResults(factory: IDBFactory = indexedDB): Promise<void> {
  return new Promise((resolve, reject) => {
    const r = factory.deleteDatabase(LEGACY_DB);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
    r.onblocked = () => resolve();
  });
}
