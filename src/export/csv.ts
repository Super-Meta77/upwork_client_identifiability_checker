// FR-33: CSV export with the spec's columns. D-16: cells that a spreadsheet would run as a formula
// get a leading apostrophe, because job titles and names are written by clients.

import type { Result } from '../core/types';

export const CSV_COLUMNS = [
  'job_id',
  'url',
  'checked_at',
  'job_title',
  'verdict',
  'best_value',
  'best_kind',
  'best_source',
  'best_confidence',
  's3_score',
  's3_attributes',
  'evidence_count',
  'ground_truth_name',
] as const;

export function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  if (/[",\r\n]/.test(v) || /^\s|\s$/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

function row(r: Result): (string | number | null)[] {
  const best = r.evidence.find((e) => e.id === r.bestEvidenceId) ?? null;
  const gt = r.groundTruth;
  return [
    r.jobId,
    r.url,
    r.checkedAt,
    r.jobTitle,
    r.verdict,
    best?.value ?? null,
    best?.kind ?? null,
    best?.source ?? null,
    best ? best.confidence : null,
    r.distinctiveness?.score ?? null,
    r.distinctiveness?.attributes.join(';') ?? null,
    r.evidence.length,
    gt?.companyName || gt?.personName || null,
  ];
}

/** UTF-8 BOM so spreadsheet apps read accents correctly; CRLF line endings (RFC 4180). */
export function toCsv(results: readonly Result[]): string {
  const lines = [CSV_COLUMNS.join(','), ...results.map((r) => row(r).map(escapeCell).join(','))];
  return `﻿${lines.join('\r\n')}\r\n`;
}
