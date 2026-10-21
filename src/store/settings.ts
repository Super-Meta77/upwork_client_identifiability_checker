// FR-34: settings live in chrome.storage.local, validated with defaults.

import { z } from 'zod';
import { DEFAULT_S3_POINTS, DEFAULT_S3_THRESHOLD } from '../extract/s3';

const points = z.number().int().min(0).max(100);

export const settingsSchema = z.object({
  /** FR-13: seconds between job requests, 3 to 30. */
  delaySeconds: z.number().int().min(3).max(30).default(3),
  /** FR-34: attachment analysis, on by default. */
  attachmentsEnabled: z.boolean().default(true),
  /** FR-34: days before results are deleted automatically. */
  retentionDays: z.number().int().min(1).max(365).default(30),
  /** NFR-02: warn before a batch would take the day's total past this. */
  dailyLimit: z.number().int().min(1).max(1000).default(200),
  /** FR-21 / D-22: S3 points per attribute and the Narrowable threshold. */
  s3Points: z
    .object({
      city: points,
      industry: points,
      company_size: points,
      smallest_size: points,
      member_since: points,
      open_jobs: points,
      past_jobs: points,
      enterprise: points,
      spend_and_hires: points,
    })
    .default(DEFAULT_S3_POINTS),
  s3Threshold: z.number().int().min(0).max(100).default(DEFAULT_S3_THRESHOLD),
  /** FR-17: user additions to the generic-site and legal-ending lists. */
  extraGenericSites: z.array(z.string().max(253)).max(500).default([]),
  extraLegalEndings: z.array(z.string().max(40)).max(200).default([]),
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
