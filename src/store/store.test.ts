import { describe, expect, it, vi } from 'vitest';
import { fakeChrome } from '../../test/fakes/chrome';
import type { ChecksStore } from './checks';
import { getDayCount, incrementDayCount, localDay } from './local-state';
import { deleteAllData } from './maintenance';
import { DEFAULT_SETTINGS, ensureDefaultSettings, loadSettings, saveSettings } from './settings';
import { SESSION_KEY } from './supabase';

describe('settings (FR-34)', () => {
  it('has the spec defaults', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({ delaySeconds: 3, dailyLimit: 200, extraGenericSites: [], extraLegalEndings: [], watchIntervalSeconds: 60 });
  });

  it('saves valid values and rejects out-of-range ones', async () => {
    await saveSettings({ delaySeconds: 10, dailyLimit: 50 });
    expect(await loadSettings()).toMatchObject({ delaySeconds: 10, dailyLimit: 50 });
    await expect(saveSettings({ delaySeconds: 2 })).rejects.toThrow();
    await expect(saveSettings({ delaySeconds: 31 })).rejects.toThrow();
    await expect(saveSettings({ watchIntervalSeconds: 29 })).rejects.toThrow();
  });

  it('falls back to defaults when stored settings are corrupt, and drops settings that no longer exist', async () => {
    await fakeChrome().storage.local.set({ settings: { delaySeconds: 'fast' } });
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    await fakeChrome().storage.local.set({ settings: { ...DEFAULT_SETTINGS, retentionDays: 30, attachmentsEnabled: true, s3Threshold: 70 } });
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

describe('delete all (FR-34)', () => {
  it('empties the history and local storage, keeping default settings and the database sign-in', async () => {
    const chrome = fakeChrome();
    const session = { accessToken: 'a', refreshToken: 'r', expiresAt: 1, userId: 'u', email: 'me@example.com' };
    await chrome.storage.local.set({ [SESSION_KEY]: session, checksOutbox: [{ job_id: '~01a' }] });
    await saveSettings({ delaySeconds: 9 });
    await incrementDayCount(new Date());
    await chrome.storage.session.set({ upworkToken: 't' });
    const removeAll = vi.fn(async () => {});
    await deleteAllData({ removeAll } as unknown as ChecksStore);
    expect(removeAll).toHaveBeenCalled();
    expect(chrome.storage.local.dump()).toEqual({ settings: DEFAULT_SETTINGS, [SESSION_KEY]: session });
    expect(chrome.storage.session.dump()).toEqual({});
  });
});

describe('daily count (NFR-02)', () => {
  it('counts jobs per local day', async () => {
    const day1 = new Date(2026, 9, 21, 23, 0);
    const day2 = new Date(2026, 9, 22, 0, 30);
    expect(localDay(day1)).toBe('2026-10-21');
    await incrementDayCount(day1);
    await incrementDayCount(day1);
    expect(await getDayCount(day1)).toBe(2);
    expect(await getDayCount(day2)).toBe(0);
  });
});
