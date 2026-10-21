import { describe, expect, it } from 'vitest';
import type { Result } from '../core/types';
import { errorResult } from '../pipeline/analyse';
import { evidence } from '../../test/builders';
import { evidenceMatches, hasGroundTruth, withMatches } from './match';
import { buildEvaluationReport, formatShare, reportToCsv } from './report';

const job = (id: string, over: Partial<Result>): Result => ({
  ...errorResult(id, `https://www.upwork.com/jobs/${id}`, 'E-NOTFOUND', '', new Date('2026-10-21T00:00:00Z')),
  verdict: 'partial',
  error: null,
  ...over,
});

describe('ground-truth matching (FR-35, D-19)', () => {
  const gt = { companyName: 'Acme Logistics Ltd', personName: 'Dana Whitfield', website: 'acme-logistics.com' };

  it.each([
    ['company name', { kind: 'company_name' as const, value: 'ACME LOGISTICS, LLC' }, true],
    ['website for the company', { kind: 'website' as const, value: 'acme-logistics.com' }, true],
    ['email on the company domain', { kind: 'email' as const, value: 'dana@acme-logistics.com' }, true],
    ['full name', { kind: 'person_full_name' as const, value: 'Dana Whitfield' }, true],
    ['first name', { kind: 'person_first_name' as const, value: 'Dana' }, true],
    ['another company', { kind: 'company_name' as const, value: 'Contoso Inc' }, false],
    ['another first name', { kind: 'person_first_name' as const, value: 'Sarah' }, false],
    ['an S3 attribute', { kind: 'attribute' as const, value: 'Acme Logistics Ltd' }, false],
  ])('%s', (_label, e, expected) => {
    expect(evidenceMatches(evidence(e), gt)).toBe(expected);
  });

  it('matches a one-word person name against full names', () => {
    expect(evidenceMatches(evidence({ kind: 'person_full_name', value: 'Dana Whitfield' }), { personName: 'Dana' })).toBe(true);
  });

  it('stores trimmed values and the matching evidence ids', () => {
    const r = job('~01a', { evidence: [evidence({ id: 'x', kind: 'company_name', value: 'Acme' }), evidence({ id: 'y', kind: 'company_name', value: 'Other' })] });
    expect(withMatches(r, { companyName: '  Acme ', personName: ' ' })).toEqual({ companyName: 'Acme', personName: undefined, website: undefined, matchedEvidenceIds: ['x'] });
    expect(hasGroundTruth({ matchedEvidenceIds: [] })).toBe(false);
    expect(hasGroundTruth(null)).toBe(false);
  });
});

describe('evaluation report (FR-36)', () => {
  const results: Result[] = [
    job('~01a', {
      groundTruth: { companyName: 'Acme Ltd', matchedEvidenceIds: [] },
      evidence: [
        evidence({ source: 'S1', kind: 'company_name', value: 'Acme Ltd', confidence: 'high' }),
        evidence({ source: 'S5', kind: 'person_first_name', value: 'Sarah', confidence: 'low' }),
      ],
    }),
    job('~01b', {
      groundTruth: { personName: 'Sarah Kim', matchedEvidenceIds: [] },
      evidence: [evidence({ source: 'S5', kind: 'person_first_name', value: 'Sarah', confidence: 'medium' })],
    }),
    job('~01c', { groundTruth: null, evidence: [evidence({ source: 'S1' })] }),
    job('~01d', { verdict: 'error', groundTruth: { companyName: 'X', matchedEvidenceIds: [] } }),
  ];

  it('reports hit rate and precision per source, from ground-truth jobs only', () => {
    const report = buildEvaluationReport(results, new Date('2026-10-21T00:00:00Z'));
    expect(report.groundTruthJobs).toBe(2);
    const bySource = Object.fromEntries(report.sources.map((s) => [s.source, s]));
    expect(bySource.S1).toMatchObject({ jobs: 2, jobsWithEvidence: 1, hitRate: 0.5, evidence: 1, matched: 1, precision: 1 });
    expect(bySource.S5).toMatchObject({ jobsWithEvidence: 2, hitRate: 1, evidence: 2, matched: 1, precision: 0.5 });
    expect(bySource['S2-text']).toMatchObject({ jobsWithEvidence: 0, hitRate: 0, evidence: 0, precision: null });
  });

  it('reports precision per confidence level', () => {
    const report = buildEvaluationReport(results, new Date());
    expect(report.levels).toEqual([
      { level: 'high', evidence: 1, matched: 1, precision: 1 },
      { level: 'medium', evidence: 1, matched: 1, precision: 1 },
      { level: 'low', evidence: 1, matched: 0, precision: 0 },
    ]);
  });

  it('handles no ground truth and exports as CSV', () => {
    const empty = buildEvaluationReport([], new Date());
    expect(empty.sources.every((s) => s.hitRate === null)).toBe(true);
    expect(formatShare(null)).toBe('—');
    expect(formatShare(0.333)).toBe('33%');
    const csv = reportToCsv(buildEvaluationReport(results, new Date()));
    expect(csv).toContain('source,S1,2,1,50%,1,1,100%');
    expect(csv).toContain('confidence,low,,,,1,0,0%');
  });
});
