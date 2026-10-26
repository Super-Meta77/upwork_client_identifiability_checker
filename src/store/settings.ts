// FR-34: settings live in chrome.storage.local, validated with defaults.

import { z } from 'zod';

export const settingsSchema = z.object({
  /** FR-13: seconds between job requests, 3 to 30. */
  delaySeconds: z.number().int().min(3).max(30).default(3),
  /** NFR-02: watching stops once today's checks reach this. */
  dailyLimit: z.number().int().min(1).max(1000).default(200),
  /** FR-17: user additions to the generic-site and legal-ending lists. */
  extraGenericSites: z.array(z.string().max(253)).max(500).default([]),
  extraLegalEndings: z.array(z.string().max(40)).max(200).default([]),
  /** D-31: seconds between search refreshes while auto-refresh is on, 30 to 3600. */
  watchIntervalSeconds: z.number().int().min(30).max(3600).default(60),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

const KEY = 'settings';

export async function loadSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get(KEY))[KEY];
  const parsed = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...(stored && typeof stored === 'object' ? stored : {}) });
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

/** Validates and saves. Throws a ZodError when a value is out of range. */
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = settingsSchema.parse({ ...(await loadSettings()), ...patch });
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export async function ensureDefaultSettings(): Promise<void> {
  const stored = (await chrome.storage.local.get(KEY))[KEY];
  if (!stored) await chrome.storage.local.set({ [KEY]: DEFAULT_SETTINGS });
}
