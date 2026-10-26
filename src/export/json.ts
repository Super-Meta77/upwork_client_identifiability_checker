import type { Result } from '../core/types';
import { toRow } from '../store/checks';

/** FR-33: shown before every export. */
export const EXPORT_WARNING =
  'Exports contain personal data: names, companies, websites and review text about real clients. Keep the file private, share it only when you have a reason, and delete it when you no longer need it.';

/** D-32: the checks as stored in the database (`job_checks` rows), so the file matches the history. */
export function toJson(results: readonly Result[], now: Date): string {
  const checks = results.map((r) => toRow(r, true)).filter((r) => r !== null);
  return JSON.stringify({ format: 'upwork-client-checker/2', exportedAt: now.toISOString(), warning: EXPORT_WARNING, count: checks.length, checks }, null, 2);
}

export function exportFileName(kind: 'csv' | 'json', now: Date, prefix = 'client-checker'): string {
  const stamp = now.toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `${prefix}-${stamp}.${kind}`;
}
