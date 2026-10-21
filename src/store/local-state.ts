// D-23: the batch queue (for Resume, NFR-06) and the daily job count (NFR-02) in chrome.storage.local.
// Neither holds personal data: only job links and a number.

export interface QueueItem {
  jobId: string;
  url: string;
}

export interface SavedQueue {
  id: string;
  createdAt: string;
  items: QueueItem[];
  /** Index of the next job to check. */
  nextIndex: number;
}

const QUEUE_KEY = 'batchQueue';
const DAY_KEY = 'dayCounter';

export async function saveQueue(queue: SavedQueue): Promise<void> {
  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
}

export async function loadQueue(): Promise<SavedQueue | null> {
  const q = (await chrome.storage.local.get(QUEUE_KEY))[QUEUE_KEY] as Partial<SavedQueue> | undefined;
  if (!q || !Array.isArray(q.items) || typeof q.nextIndex !== 'number' || typeof q.id !== 'string') return null;
  const items = q.items.filter((i): i is QueueItem => !!i && typeof i.jobId === 'string' && typeof i.url === 'string');
  return { id: q.id, createdAt: String(q.createdAt ?? ''), items, nextIndex: Math.max(0, Math.min(q.nextIndex, items.length)) };
}

export async function clearQueue(): Promise<void> {
  await chrome.storage.local.remove(QUEUE_KEY);
}

/** Local calendar day, e.g. "2026-10-21". */
export function localDay(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export async function getDayCount(now: Date): Promise<number> {
  const stored = (await chrome.storage.local.get(DAY_KEY))[DAY_KEY] as { day?: string; count?: number } | undefined;
  return stored?.day === localDay(now) && typeof stored.count === 'number' ? stored.count : 0;
}

export async function incrementDayCount(now: Date): Promise<number> {
  const count = (await getDayCount(now)) + 1;
  await chrome.storage.local.set({ [DAY_KEY]: { day: localDay(now), count } });
  return count;
}

/** NFR-02: true when checking `jobs` more jobs would take today's total past the limit. */
export function wouldExceedDailyLimit(countToday: number, jobs: number, limit: number): boolean {
  return countToday + jobs > limit;
}
