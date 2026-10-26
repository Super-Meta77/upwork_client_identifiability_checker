import { describe, expect, it } from 'vitest';
import { CheckerError } from '../core/errors';
import type { Result } from '../core/types';
import { DEFAULT_SETTINGS } from '../store/settings';
import { readJobResponse } from '../upwork/classify';
import type { UpworkClient } from '../upwork';
import { jsonResponse } from '../../test/fakes/fetch';
import { jobFixture, jobFixtures } from '../../test/fixtures';
import { sequentialIds } from '../../test/builders';
import { analyseJob } from './analyse';
import { checkJob } from './check';

const JOB_ID = '~01a2b3c4d5e6f7a8b9';
const URL = `https://www.upwork.com/jobs/${JOB_ID}`;
const NOW = new Date('2026-10-21T09:30:00Z');

async function analyseFixture(name: string): Promise<Result> {
  const job = await readJobResponse(JOB_ID, jsonResponse(jobFixture(name)));
  return analyseJob({ job, url: URL, settings: DEFAULT_SETTINGS, now: NOW, newId: sequentialIds() });
}

const best = (r: Result) => r.evidence.find((e) => e.id === r.bestEvidenceId);

describe('analysis of fixtures (end to end, offline)', () => {
  it('S1 company name → has potential', async () => {
    const r = await analyseFixture('synthetic-01-s1-company');
    expect(r.verdict).toBe('has_potential');
    expect(best(r)).toMatchObject({ source: 'S1', value: 'Northwind Traders', confidence: 'high', reasonId: 'R-S1' });
    expect(r.evidence.some((e) => e.value === 'Ahmed')).toBe(false);
    expect(r).toMatchObject({ jobId: JOB_ID, url: URL, checkedAt: NOW.toISOString(), jobTitle: 'Inventory dashboard for a furniture importer' });
  });

  it('"we are X" and an owned website → has potential, without raising each other (same source)', async () => {
    const r = await analyseFixture('synthetic-02-intro-and-website');
    expect(r.verdict).toBe('has_potential');
    expect(r.evidence.map((e) => [e.kind, e.value, e.confidence])).toEqual([
      ['website', 'fabrikam-studio.pt', 'medium'],
      ['company_name', 'Fabrikam Studio', 'medium'],
    ]);
  });

  it('third-party mentions and a gmail address stay weak (D-04, D-06)', async () => {
    const r = await analyseFixture('synthetic-03-third-party');
    const byValue = Object.fromEntries(r.evidence.map((e) => [e.value, e.confidence]));
    expect(byValue).toMatchObject({ 'rivalbookings.com': 'low', 'Contoso Payments Inc.': 'low', 'host.helper@gmail.com': 'medium', Maria: 'low' });
    expect(byValue['gmail.com']).toBeUndefined();
    expect(byValue['airbnb.com']).toBeUndefined();
    expect(r.verdict).toBe('has_potential'); // the email is Medium
  });

  it('a minimal job has no potential', async () => {
    const r = await analyseFixture('synthetic-04-minimal');
    expect(r).toMatchObject({ verdict: 'no_potential', evidence: [], bestEvidenceId: null });
  });

  it('an attachment file name alone is a weak signal (S2-file)', async () => {
    const r = await analyseFixture('synthetic-05-attachments');
    expect(r.evidence.map((e) => [e.source, e.value, e.confidence])).toEqual([['S2-file', 'Tailspin Toys', 'low']]);
    expect(r.verdict).toBe('no_potential');
  });

  it('S5: a client first name in two reviews, freelancers removed → has potential', async () => {
    const r = await analyseFixture('synthetic-06-reviews');
    expect(r.evidence.map((e) => [e.source, e.value, e.mentions, e.confidence])).toEqual([['S5', 'Sarah', 2, 'medium']]);
    expect(r.verdict).toBe('has_potential');
  });

  it('a client who shows no name, website or email has no potential', async () => {
    const r = await analyseFixture('synthetic-07-enterprise');
    expect(r.evidence).toEqual([]);
    expect(r.verdict).toBe('no_potential');
  });

  it('no freelancer name is ever reported from reviews (Phase 2 gate)', async () => {
    for (const { name, body } of jobFixtures()) {
      const job = await readJobResponse(JOB_ID, jsonResponse(body));
      const freelancers = new Set(job.buyer.workHistory.map((w) => (w.contractorName ?? '').split(/\s+/)[0]?.toLowerCase()).filter(Boolean));
      const r = analyseJob({ job, url: URL, settings: DEFAULT_SETTINGS, now: NOW, newId: sequentialIds() });
      for (const e of r.evidence.filter((x) => x.source === 'S5')) {
        expect(freelancers.has(e.value.split(' ')[0]!.toLowerCase()), `${name}: ${e.value}`).toBe(false);
      }
    }
  });

  it('analyses a fetched job in under 500 ms (NFR-03)', async () => {
    for (const { body } of jobFixtures()) {
      const job = await readJobResponse(JOB_ID, jsonResponse(body));
      const t = performance.now();
      analyseJob({ job, url: URL, settings: DEFAULT_SETTINGS, now: NOW, newId: sequentialIds() });
      expect(performance.now() - t).toBeLessThan(500);
    }
  });
});

describe('checkJob', () => {
  const client = (fetchJob: UpworkClient['fetchJob']): UpworkClient => ({ fetchJob });

  it('fetches the job and analyses it', async () => {
    const upwork = client(async () => readJobResponse(JOB_ID, jsonResponse(jobFixture('synthetic-01-s1-company'))));
    const r = await checkJob({ jobId: JOB_ID, url: URL }, DEFAULT_SETTINGS, { upwork, now: () => NOW, newId: sequentialIds() });
    expect(r).toMatchObject({ jobId: JOB_ID, verdict: 'has_potential' });
  });

  it('passes the Stop signal to the request and job-level errors through', async () => {
    const stop = new AbortController();
    let seen: AbortSignal | undefined;
    const upwork = client(async (_id, signal) => {
      seen = signal;
      throw new CheckerError('E-AUTH');
    });
    await expect(checkJob({ jobId: JOB_ID, url: URL }, DEFAULT_SETTINGS, { upwork, now: () => NOW, newId: sequentialIds() }, stop.signal)).rejects.toMatchObject({ code: 'E-AUTH' });
    expect(seen).toBe(stop.signal);
  });
});
