// NFR-02: the daily job count in chrome.storage.local. It holds no personal data, only a number.

const DAY_KEY = 'dayCounter';

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
