import { describe, expect, it } from 'vitest';
import type { Result } from '../core/types';
import { errorResult } from '../pipeline/analyse';
import { fakeChrome } from '../../test/fakes/chrome';
import { deleteOlderThan, deleteResult, getResult, listResults, saveResult, searchResults, setGroundTruth } from './db';
import { clearQueue, getDayCount, incrementDayCount, loadQueue, localDay, saveQueue, wouldExceedDailyLimit } from './local-state';
import { deleteAllData, runRetention } from './maintenance';
import { peerCounts } from './peers';
import { DEFAULT_SETTINGS, ensureDefaultSettings, loadSettings, saveSettings } from './settings';

const result = (jobId: string, checkedAt: string, over: Partial<Result> = {}): Result => ({
  ...errorResult(jobId, `https://www.upwork.com/jobs/${jobId}`, 'E-NOTFOUND', '', new Date(checkedAt)),
  verdict: 'not_identifiable',
  error: null,
  jobTitle: `Title ${jobId}`,
  ...over,
});

describe('settings (FR-34)', () => {
  it('has the spec defaults', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toMatchObject({ delaySeconds: 3, attachmentsEnabled: true, retentionDays: 30, dailyLimit: 200, s3Threshold: 70 });
    expect(DEFAULT_SETTINGS.s3Points.city).toBe(25);
  });

  it('saves valid values and rejects out-of-range ones', async () => {
    await saveSettings({ delaySeconds: 10, attachmentsEnabled: false });
    expect(await loadSettings()).toMatchObject({ delaySeconds: 10, attachmentsEnabled: false });
    await expect(saveSettings({ delaySeconds: 2 })).rejects.toThrow();
    await expect(saveSettings({ delaySeconds: 31 })).rejects.toThrow();
  });

  it('falls back to defaults when stored settings are corrupt', async () => {
    await fakeChrome().storage.local.set({ settings: { delaySeconds: 'fast' } });
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('writes defaults once on install', async () => {
    await ensureDefaultSettings();
    expect(fakeChrome().storage.local.dump()).toEqual({ settings: DEFAULT_SETTINGS });
    await saveSettings({ delaySeconds: 5 });
    await ensureDefaultSettings();
    expect((await loadSettings()).delaySeconds).toBe(5);
  });
});

describe('results database (FR-32, D-18)', () => {
  it('lists newest first and finds by job ID', async () => {
    await saveResult(result('~01a', '2026-10-01T00:00:00Z'));
    await saveResult(result('~01b', '2026-10-03T00:00:00Z'));
    await saveResult(result('~01c', '2026-10-02T00:00:00Z'));
    expect((await listResults()).map((r) => r.jobId)).toEqual(['~01b', '~01c', '~01a']);
    expect((await getResult('~01c'))?.jobTitle).toBe('Title ~01c');
  });

  it('overwrites a re-check but keeps the ground truth', async () => {
    await saveResult(result('~01a', '2026-10-01T00:00:00Z'));
    await setGroundTruth('~01a', { companyName: 'Acme', matchedEvidenceIds: [] });
    await saveResult(result('~01a', '2026-10-05T00:00:00Z', { verdict: 'partial' }));
    expect(await getResult('~01a')).toMatchObject({ verdict: 'partial', groundTruth: { companyName: 'Acme' } });
    expect(await listResults()).toHaveLength(1);
  });

  it('deletes one result and results older than a cutoff', async () => {
    await saveResult(result('~01a', '2026-09-01T00:00:00Z'));
    await saveResult(result('~01b', '2026-10-20T00:00:00Z'));
    await saveResult(result('~01c', '2026-10-21T00:00:00Z'));
    expect(await deleteOlderThan('2026-10-01T00:00:00Z')).toBe(1);
    await deleteResult('~01b');
    expect((await listResults()).map((r) => r.jobId)).toEqual(['~01c']);
  });

  it('returns null when setting ground truth on an unknown job', async () => {
    expect(await setGroundTruth('~missing', null)).toBeNull();
  });

  it('wraps IndexedDB failures as E-STORAGE', async () => {
    const original = globalThis.indexedDB;
    globalThis.indexedDB = { open: () => { throw new DOMException('full', 'QuotaExceededError'); } } as unknown as IDBFactory;
    await expect(saveResult(result('~01a', '2026-10-01T00:00:00Z'))).rejects.toMatchObject({ code: 'E-STORAGE' });
    globalThis.indexedDB = original;
  });

  it('searches by job ID, title and verdict', () => {
    const list = [result('~01abc', '2026-10-01T00:00:00Z', { jobTitle: 'Logo design' }), result('~01xyz', '2026-10-01T00:00:00Z', { verdict: 'identified', jobTitle: 'SEO audit' })];
    expect(searchResults(list, 'abc').map((r) => r.jobId)).toEqual(['~01abc']);
    expect(searchResults(list, 'seo').map((r) => r.jobId)).toEqual(['~01xyz']);
    expect(searchResults(list, 'identified before').map((r) => r.jobId)).toEqual(['~01xyz']);
    expect(searchResults(list, 'not identifiable').map((r) => r.jobId)).toEqual(['~01abc']);
    expect(searchResults(list, '  ')).toHaveLength(2);
  });
});

describe('retention and delete all (NFR-11, FR-34)', () => {
  it('deletes results older than the retention period', async () => {
    await saveSettings({ retentionDays: 7 });
    await saveResult(result('~01old', '2026-10-10T00:00:00Z'));
    await saveResult(result('~01new', '2026-10-20T00:00:00Z'));
    expect(await runRetention(new Date('2026-10-21T00:00:00Z'))).toBe(1);
    expect((await listResults()).map((r) => r.jobId)).toEqual(['~01new']);
  });

  it('leaves IndexedDB and local storage empty except default settings', async () => {
    const chrome = fakeChrome();
    await saveResult(result('~01a', '2026-10-20T00:00:00Z'));
    await saveSettings({ delaySeconds: 9 });
    await saveQueue({ id: 'q', createdAt: '', items: [{ jobId: '~01a', url: 'u' }], nextIndex: 0 });
    await incrementDayCount(new Date());
    await chrome.storage.session.set({ upworkToken: 't' });
    await deleteAllData();
    expect(await listResults()).toEqual([]);
    expect(chrome.storage.local.dump()).toEqual({ settings: DEFAULT_SETTINGS });
    expect(chrome.storage.session.dump()).toEqual({});
  });
});

describe('batch queue and daily count (D-23, NFR-02, NFR-06)', () => {
  it('saves, loads and clears the queue', async () => {
    const q = { id: 'q1', createdAt: '2026-10-21', items: [{ jobId: '~01a', url: 'u1' }, { jobId: '~01b', url: 'u2' }], nextIndex: 1 };
    await saveQueue(q);
    expect(await loadQueue()).toEqual(q);
    await clearQueue();
    expect(await loadQueue()).toBeNull();
  });

  it('ignores a malformed queue and clamps the index', async () => {
    await fakeChrome().storage.local.set({ batchQueue: { id: 'q', items: 'x', nextIndex: 0 } });
    expect(await loadQueue()).toBeNull();
    await fakeChrome().storage.local.set({ batchQueue: { id: 'q', items: [{ jobId: '~01a', url: 'u' }, null], nextIndex: 9 } });
    expect(await loadQueue()).toMatchObject({ items: [{ jobId: '~01a' }], nextIndex: 1 });
  });

  it('counts jobs per local day and warns past the limit', async () => {
    const day1 = new Date(2026, 9, 21, 23, 0);
    const day2 = new Date(2026, 9, 22, 0, 30);
    expect(localDay(day1)).toBe('2026-10-21');
    await incrementDayCount(day1);
    await incrementDayCount(day1);
    expect(await getDayCount(day1)).toBe(2);
    expect(await getDayCount(day2)).toBe(0);
    expect(wouldExceedDailyLimit(190, 10, 200)).toBe(false);
    expect(wouldExceedDailyLimit(190, 11, 200)).toBe(true);
  });
});

describe('peer counts (FR-22)', () => {
  const withProfile = (jobId: string, companyId: string | null, city: string | null, year: number | null) =>
    result(jobId, '2026-10-01T00:00:00Z', { profile: { companyId, country: 'Norway', city, industry: null, size: null, memberSinceYear: year } });

  it('counts other clients once each, by company ID', () => {
    const target = withProfile('~01t', 'c0', 'Tromsø', 2016);
    const saved = [target, withProfile('~01a', 'c1', 'tromsø', 2016), withProfile('~01b', 'c1', 'Tromsø', 2016), withProfile('~01c', 'c2', 'Oslo', 2016), withProfile('~01d', 'c0', 'Tromsø', 2016)];
    expect(peerCounts(target, saved)).toEqual({ country: 2, city: 1, industry: null, size: null, memberSinceYear: 2 });
  });

  it('returns nulls without a profile', () => {
    expect(peerCounts(result('~01x', '2026-10-01T00:00:00Z'), [])).toEqual({ country: null, city: null, industry: null, size: null, memberSinceYear: null });
  });
});
