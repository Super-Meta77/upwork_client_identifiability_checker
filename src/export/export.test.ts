import { describe, expect, it } from 'vitest';
import type { Result } from '../core/types';
import { errorResult } from '../pipeline/analyse';
import { evidence } from '../../test/builders';
import { CSV_COLUMNS, escapeCell, toCsv } from './csv';
import { EXPORT_WARNING, exportFileName, toJson } from './json';

const base = (over: Partial<Result> = {}): Result => ({
  ...errorResult('~01abc', 'https://www.upwork.com/jobs/~01abc', 'E-NOTFOUND', 'x', new Date('2026-10-21T09:30:00Z')),
  ...over,
});

describe('CSV export (FR-33)', () => {
  it('uses the spec columns in order', () => {
    const [header] = toCsv([]).replace('﻿', '').split('\r\n');
    expect(header).toBe(CSV_COLUMNS.join(','));
    expect(CSV_COLUMNS).toEqual(['job_id', 'url', 'checked_at', 'job_title', 'verdict', 'best_value', 'best_kind', 'best_source', 'best_confidence', 's3_score', 's3_attributes', 'evidence_count', 'error_code', 'ground_truth_name']);
  });

  it('writes the best evidence, S3 and ground truth', () => {
    const best = evidence({ id: 'b', value: 'Acme, Ltd', kind: 'company_name', source: 'S1', confidence: 'high' });
    const csv = toCsv([
      base({
        verdict: 'identified',
        error: null,
        jobTitle: 'Logo "v2"',
        evidence: [best, evidence({ id: 'c' })],
        bestEvidenceId: 'b',
        distinctiveness: { score: 40, attributes: ['city', 'industry'], details: [] },
        groundTruth: { personName: 'Jo Bloggs', matchedEvidenceIds: [] },
      }),
    ]);
    const line = csv.split('\r\n')[1];
    expect(line).toBe('~01abc,https://www.upwork.com/jobs/~01abc,2026-10-21T09:30:00.000Z,"Logo ""v2""",identified,"Acme, Ltd",company_name,S1,high,40,city;industry,2,,Jo Bloggs');
  });

  it('writes error rows', () => {
    expect(toCsv([base()]).split('\r\n')[1]).toBe('~01abc,https://www.upwork.com/jobs/~01abc,2026-10-21T09:30:00.000Z,,error,,,,,,,0,E-NOTFOUND,');
  });

  it.each([
    ['=HYPERLINK("http://x")', `"'=HYPERLINK(""http://x"")"`],
    ['+1+2', "'+1+2"],
    ['-2+3', "'-2+3"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tcmd', "'\tcmd"],
  ])('escapes formula-like cell %j (D-16)', (value, expected) => {
    expect(escapeCell(value)).toBe(expected);
  });

  it('leaves ordinary values and numbers alone', () => {
    expect(escapeCell('Acme')).toBe('Acme');
    expect(escapeCell(-5)).toBe('-5');
    expect(escapeCell(null)).toBe('');
    expect(escapeCell(Number.NaN)).toBe('');
    expect(escapeCell(' padded ')).toBe('" padded "');
  });

  it('starts with a BOM and ends with CRLF', () => {
    const csv = toCsv([base()]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});

describe('JSON export (FR-33)', () => {
  it('includes the results and the personal-data warning', () => {
    const parsed = JSON.parse(toJson([base()], new Date('2026-10-21T10:00:00Z'))) as { warning: string; count: number; results: Result[] };
    expect(parsed).toMatchObject({ warning: EXPORT_WARNING, count: 1 });
    expect(parsed.results[0]?.jobId).toBe('~01abc');
  });

  it('names files with a timestamp', () => {
    expect(exportFileName('csv', new Date('2026-10-21T10:05:00Z'))).toBe('client-checker-2026-10-21-10-05.csv');
  });
});
