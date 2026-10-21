import { describe, expect, it } from 'vitest';
import { AttachError, CheckerError } from '../core/errors';
import type { AttachmentProps, AttachmentRef, Result } from '../core/types';
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

async function analyseFixture(name: string, props: AttachmentProps[] = []): Promise<Result> {
  const job = await readJobResponse(JOB_ID, jsonResponse(jobFixture(name)));
  return analyseJob({ job, url: URL, props, attachmentNotes: [], settings: DEFAULT_SETTINGS, now: NOW, newId: sequentialIds() });
}

const best = (r: Result) => r.evidence.find((e) => e.id === r.bestEvidenceId);

describe('analysis of fixtures (end to end, offline)', () => {
  it('S1 company name → identified', async () => {
    const r = await analyseFixture('synthetic-01-s1-company');
    expect(r.verdict).toBe('identified');
    expect(best(r)).toMatchObject({ source: 'S1', value: 'Northwind Traders', confidence: 'high', reasonId: 'R-S1' });
    expect(r.evidence.some((e) => e.value === 'Ahmed')).toBe(false);
    expect(r).toMatchObject({ jobId: JOB_ID, url: URL, checkedAt: NOW.toISOString(), jobTitle: 'Inventory dashboard for a furniture importer' });
  });

  it('"we are X" and an owned website agree only within one source → partial', async () => {
    const r = await analyseFixture('synthetic-02-intro-and-website');
    expect(r.verdict).toBe('partial');
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
    expect(r.verdict).toBe('partial'); // the email is Medium
  });

  it('a minimal job is not identifiable', async () => {
    const r = await analyseFixture('synthetic-04-minimal');
    expect(r).toMatchObject({ verdict: 'not_identifiable', evidence: [], bestEvidenceId: null, distinctiveness: { score: 0 } });
  });

  it('S5: a client first name in two reviews, freelancers removed → partial', async () => {
    const r = await analyseFixture('synthetic-06-reviews');
    expect(r.evidence.map((e) => [e.source, e.value, e.mentions, e.confidence])).toEqual([['S5', 'Sarah', 2, 'medium']]);
    expect(r.verdict).toBe('partial');
  });

  it('an enterprise client with rich trust details is narrowable', async () => {
    const r = await analyseFixture('synthetic-07-enterprise');
    expect(r.evidence).toEqual([]);
    expect(r.distinctiveness?.score).toBeGreaterThanOrEqual(70);
    expect(r.verdict).toBe('narrowable');
    expect(r.profile).toMatchObject({ city: 'Seattle', memberSinceYear: 2014, companyId: '1100000000000000007' });
  });

  it('agreement across S1, S2 text and S2 props raises to High', async () => {
    const props: AttachmentProps[] = [
      { fileName: 'logo.docx', fileType: 'office', entries: [{ field: 'office.creator', value: 'Dana Whitfield', location: 'attachment logo.docx > docProps/core.xml > creator' }] },
    ];
    const r = await analyseFixture('synthetic-08-extra-fields', props);
    const dana = r.evidence.filter((e) => e.value === 'Dana Whitfield');
    expect(dana.map((e) => [e.source, e.confidence])).toEqual([
      ['S2-text', 'high'],
      ['S2-props', 'high'],
    ]);
    expect(r.verdict).toBe('identified');
  });

  it('no freelancer name is ever reported from reviews (Phase 2 gate)', async () => {
    for (const { name, body } of jobFixtures()) {
      const job = await readJobResponse(JOB_ID, jsonResponse(body));
      const freelancers = new Set(job.buyer.workHistory.map((w) => (w.contractorName ?? '').split(/\s+/)[0]?.toLowerCase()).filter(Boolean));
      const r = analyseJob({ job, url: URL, props: [], attachmentNotes: [], settings: DEFAULT_SETTINGS, now: NOW, newId: sequentialIds() });
      for (const e of r.evidence.filter((x) => x.source === 'S5')) {
        expect(freelancers.has(e.value.split(' ')[0]!.toLowerCase()), `${name}: ${e.value}`).toBe(false);
      }
    }
  });

  it('analyses a fetched job in under 500 ms (NFR-03)', async () => {
    for (const { body } of jobFixtures()) {
      const job = await readJobResponse(JOB_ID, jsonResponse(body));
      const t = performance.now();
      analyseJob({ job, url: URL, props: [], attachmentNotes: [], settings: DEFAULT_SETTINGS, now: NOW, newId: sequentialIds() });
      expect(performance.now() - t).toBeLessThan(500);
    }
  });
});

describe('checkJob attachments (FR-15)', () => {
  function client(downloads: string[]): UpworkClient {
    return {
      fetchJob: async () => readJobResponse(JOB_ID, jsonResponse(jobFixture('synthetic-05-attachments'))),
      downloadAttachment: async (a: AttachmentRef) => {
        downloads.push(a.fileName);
        if (a.length !== null && a.length > 10 * 1024 * 1024) throw new AttachError(a.fileName, 'the file is larger than 10 MB');
        return new Uint8Array([1]);
      },
    };
  }

  const parse = async (fileName: string): Promise<AttachmentProps> => {
    if (fileName === 'box-photo.jpg') throw new AttachError(fileName, 'the file could not be read');
    return { fileName, fileType: 'office', entries: fileName.startsWith('Tailspin') ? [{ field: 'office.Company', value: 'Tailspin Toys Ltd', location: `attachment ${fileName} > docProps/app.xml > Company` }] : [] };
  };

  it('downloads at most 5 supported files and notes the rest', async () => {
    const downloads: string[] = [];
    const r = await checkJob({ jobId: JOB_ID, url: URL }, DEFAULT_SETTINGS, { upwork: client(downloads), parseAttachment: parse, now: () => NOW, newId: sequentialIds() });
    expect(downloads).toEqual(['Tailspin_Toys_Catalogue_2026.docx', 'style-guide.pdf', 'box-photo.jpg', 'huge-scan.pdf', 'extra-1.pdf']);
    expect(r.attachmentNotes.map((n) => n.fileName)).toEqual(['notes.txt', 'extra-2.pdf', 'box-photo.jpg', 'huge-scan.pdf']);
    expect(r.attachmentNotes[0]?.message).toBe('This attachment could not be analysed: notes.txt. Reason: this file type is not analysed.');
    expect(r.evidence.find((e) => e.source === 'S2-props')).toMatchObject({ value: 'Tailspin Toys Ltd', confidence: 'high' }); // agrees with the file name
  });

  it('skips attachments when the setting is off', async () => {
    const downloads: string[] = [];
    const r = await checkJob({ jobId: JOB_ID, url: URL }, { ...DEFAULT_SETTINGS, attachmentsEnabled: false }, { upwork: client(downloads), parseAttachment: parse, now: () => NOW, newId: sequentialIds() });
    expect(downloads).toEqual([]);
    expect(r.attachmentNotes).toEqual([]);
  });

  it('passes job-level errors through', async () => {
    const failing: UpworkClient = { fetchJob: async () => Promise.reject(new CheckerError('E-AUTH')), downloadAttachment: async () => new Uint8Array() };
    await expect(checkJob({ jobId: JOB_ID, url: URL }, DEFAULT_SETTINGS, { upwork: failing, parseAttachment: parse, now: () => NOW, newId: sequentialIds() })).rejects.toMatchObject({ code: 'E-AUTH' });
  });

  it('rethrows unexpected attachment errors', async () => {
    const broken: UpworkClient = { ...client([]), downloadAttachment: async () => Promise.reject(new Error('bug')) };
    await expect(checkJob({ jobId: JOB_ID, url: URL }, DEFAULT_SETTINGS, { upwork: broken, parseAttachment: parse, now: () => NOW, newId: sequentialIds() })).rejects.toThrow('bug');
  });
});
