// FR-32: results in IndexedDB, one record per job (D-18: a re-check overwrites but keeps ground truth).

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { CheckerError } from '../core/errors';
import type { GroundTruth, Result } from '../core/types';

interface CheckerDB extends DBSchema {
  results: {
    key: string;
    value: Result;
    indexes: { checkedAt: string };
  };
}

const DB_NAME = 'upwork-checker';
const DB_VERSION = 1;

let cached: { factory: IDBFactory; db: Promise<IDBPDatabase<CheckerDB>> } | null = null;

function database(): Promise<IDBPDatabase<CheckerDB>> {
  // Tests swap the IndexedDB factory between cases; reopen when it changes.
  if (!cached || cached.factory !== globalThis.indexedDB) {
    cached = {
      factory: globalThis.indexedDB,
      db: openDB<CheckerDB>(DB_NAME, DB_VERSION, {
        upgrade(db) {
          const store = db.createObjectStore('results', { keyPath: 'jobId' });
          store.createIndex('checkedAt', 'checkedAt');
        },
      }),
    };
  }
  return cached.db;
}

async function guarded<T>(work: (db: IDBPDatabase<CheckerDB>) => Promise<T>): Promise<T> {
  try {
    return await work(await database());
  } catch (error) {
    if (error instanceof CheckerError) throw error;
    throw new CheckerError('E-STORAGE', error instanceof Error ? error.name : undefined);
  }
}

export function saveResult(result: Result): Promise<void> {
  return guarded(async (db) => {
    const tx = db.transaction('results', 'readwrite');
    const existing = await tx.store.get(result.jobId);
    await tx.store.put(existing?.groundTruth && !result.groundTruth ? { ...result, groundTruth: existing.groundTruth } : result);
    await tx.done;
  });
}

export function getResult(jobId: string): Promise<Result | undefined> {
  return guarded((db) => db.get('results', jobId));
}

/** Newest first. */
export function listResults(): Promise<Result[]> {
  return guarded(async (db) => (await db.getAllFromIndex('results', 'checkedAt')).reverse());
}

export function deleteResult(jobId: string): Promise<void> {
  return guarded((db) => db.delete('results', jobId));
}

export function deleteAllResults(): Promise<void> {
  return guarded((db) => db.clear('results'));
}

/** Deletes results checked before the cutoff; returns how many were removed. */
export function deleteOlderThan(cutoffIso: string): Promise<number> {
  return guarded(async (db) => {
    const tx = db.transaction('results', 'readwrite');
    let removed = 0;
    let cursor = await tx.store.index('checkedAt').openCursor(IDBKeyRange.upperBound(cutoffIso, true));
    while (cursor) {
      await cursor.delete();
      removed += 1;
      cursor = await cursor.continue();
    }
    await tx.done;
    return removed;
  });
}

export function setGroundTruth(jobId: string, groundTruth: GroundTruth | null): Promise<Result | null> {
  return guarded(async (db) => {
    const tx = db.transaction('results', 'readwrite');
    const existing = await tx.store.get(jobId);
    if (!existing) {
      await tx.done;
      return null;
    }
    const updated = { ...existing, groundTruth };
    await tx.store.put(updated);
    await tx.done;
    return updated;
  });
}

const VERDICT_WORDS: Record<Result['verdict'], string> = {
  identified: 'identified before contact',
  partial: 'partially identified',
  narrowable: 'narrowable',
  not_identifiable: 'not identifiable before contact',
  error: 'error',
};

/** FR-32: search by job ID, title and verdict. */
export function searchResults(results: readonly Result[], query: string): Result[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...results];
  return results.filter(
    (r) =>
      r.jobId.toLowerCase().includes(q) ||
      (r.jobTitle ?? '').toLowerCase().includes(q) ||
      r.verdict.includes(q.replace(/\s+/g, '_')) ||
      VERDICT_WORDS[r.verdict].includes(q),
  );
}
