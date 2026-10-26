import type { Finding, JobData } from '../core/types';
import { GENERIC_SITES } from './lists/generic-sites';
import { legalEndingsWith } from './lists/legal-endings';
import { extractS1 } from './s1';
import { extractS2File } from './s2file';
import { extractS2Text, type TextScanOptions } from './s2text';
import { extractS5 } from './s5';

export interface ExtractSettings {
  extraGenericSites: readonly string[];
  extraLegalEndings: readonly string[];
}

export function scanOptions(settings: ExtractSettings): TextScanOptions {
  const extraSites = settings.extraGenericSites.map((s) => s.trim().toLowerCase().replace(/^www\./, '')).filter(Boolean);
  return {
    genericSites: extraSites.length ? new Set([...GENERIC_SITES, ...extraSites]) : GENERIC_SITES,
    legalEndings: legalEndingsWith(settings.extraLegalEndings),
  };
}

/** NFR-12: extractors are pure functions from mapped job data to findings. */
export function extractAll(job: JobData, settings: ExtractSettings): Finding[] {
  const options = scanOptions(settings);
  return [...extractS1(job), ...extractS2Text(job, options), ...extractS2File(job, options), ...extractS5(job)];
}
