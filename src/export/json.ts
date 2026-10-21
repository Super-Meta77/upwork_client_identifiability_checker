import type { Result } from '../core/types';

/** FR-33: shown before every export. */
export const EXPORT_WARNING =
  'Exports contain personal data: names, companies, websites and review text about real clients. Keep the file private, share it only when you have a reason, and delete it when you no longer need it.';

export function toJson(results: readonly Result[], now: Date): string {
  return JSON.stringify(
    { format: 'upwork-client-checker/1', exportedAt: now.toISOString(), warning: EXPORT_WARNING, count: results.length, results },
    null,
    2,
  );
}

export function exportFileName(kind: 'csv' | 'json', now: Date, prefix = 'client-checker'): string {
  const stamp = now.toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `${prefix}-${stamp}.${kind}`;
}
