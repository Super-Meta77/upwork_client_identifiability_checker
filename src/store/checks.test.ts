import { describe, expect, it } from 'vitest';
import { CheckerError } from '../core/errors';
import type { Result } from '../core/types';
import { errorResult } from '../pipeline/analyse';
import { evidence } from '../../test/builders';
import { fakeChrome } from '../../test/fakes/chrome';
import { createChecksStore, fromRow, searchFilter, toRow, type CheckRow } from './checks';
import type { Database, RestInit } from './supabase';

const JOB = '~0219810000000000001';

function result(over: Partial<Result> = {}): Result {
  return {
    ...errorResult(JOB, `https://www.upwork.com/jobs/${JOB}`, 'E-NOTFOUND', '', new Date('2026-10-25T09:00:00Z')),
    verdict: 'has_potential',
    error: null,
    jobTitle: 'Shopify Expert | Bulk CSV Product Upload',
    evidence: [
      evidence({ id: 'a', source: 'S5', kind: 'person_first_name', value: 'Lucas', confidence: 'low', snippet: 'Lucas', reasonId: 'R-S5' }),
      evidence({ id: 'b', source: 'S2-text', value: 'Bindex', confidence: 'high', baseConfidence: 'medium', snippet: '…we are Bindex, a studio…', mentions: 2, ruleId: 'C-S2T-CO', agreesWith: ['c'] }),
      evidence({ id: 'c', source: 'S2-file', value: 'Bindex', confidence: 'medium', baseConfidence: 'low', snippet: 'Bindex_brief.pdf', reasonId: 'R-S2-file' }),
    ],
    bestEvidenceId: 'b',
    ...over,
  };
}

function fakeDb(handler: (path: string, init: RestInit) => unknown = () => []) {
  const calls: { path: string; init: RestInit }[] = [];
  const db: Database = {
    configured: true,
    account: async () => ({ userId: 'u', email: 'me@example.com' }),
    signIn: async () => null,
    signOut: async () => {},
    rest: async <T,>(path: string, init: RestInit = {}) => {
      calls.push({ path: decodeURIComponent(path), init });
      return (await handler(path, init)) as T;
    },
  };
  return { db, calls, store: createChecksStore(db, fakeChrome().storage.local) };
}

const offline = () => {
  throw new CheckerError('E-STORAGE', 'no connection');
};

describe('history rows (D-32, D-33)', () => {
  it('stores the job, the verdict and the findings, best first', () => {
    const row = toRow(result())!;
    expect(Object.keys(row).sort()).toEqual(['checked_at', 'evidence', 'job_id', 'job_title', 'verdict']);
    expect(row).toMatchObject({ job_id: JOB, verdict: 'has_potential', job_title: 'Shopify Expert | Bulk CSV Product Upload' });
    expect(row.evidence).toEqual([
      { source: 'S2-text', kind: 'company_name', value: 'Bindex', confidence: 'high', raised_from: 'medium', location: 'opening.job.description', snippet: '…we are Bindex, a studio…', mentions: 2 },
      { source: 'S5', kind: 'person_first_name', value: 'Lucas', confidence: 'low', location: 'opening.job.description' },
      { source: 'S2-file', kind: 'company_name', value: 'Bindex', confidence: 'medium', raised_from: 'low', location: 'opening.job.description', snippet: 'Bindex_brief.pdf' },
    ]);
  });

  it('does not store failed checks', () => {
    expect(toRow(errorResult(JOB, 'u', 'E-NOTFOUND', 'gone', new Date()))).toBeNull();
  });

  it('rebuilds the card from a row', () => {
    const back = fromRow(toRow(result())!);
    expect(back).toMatchObject({ jobId: JOB, url: `https://www.upwork.com/jobs/${JOB}`, verdict: 'has_potential', bestEvidenceId: 'e0', error: null });
    expect(back.evidence[0]).toMatchObject({ id: 'e0', value: 'Bindex', confidence: 'high', baseConfidence: 'medium', reasonId: 'R-S2-text', mentions: 2 });
    expect(back.evidence[1]).toMatchObject({ value: 'Lucas', baseConfidence: 'low', snippet: 'Lucas', mentions: 1, reasonId: 'R-S5' });
  });

  it('builds the history search for job ID, title and verdict', () => {
    expect(searchFilter('  ')).toBeNull();
    expect(searchFilter('SEO')).toBe('(job_title.ilike."*seo*",job_id.ilike."*seo*")');
    expect(searchFilter('has potential')).toBe('(job_title.ilike."*has potential*",job_id.ilike."*has potential*",verdict.in.(has_potential))');
    expect(searchFilter('potential')).toContain('verdict.in.(has_potential,no_potential)');
    expect(searchFilter('a"b,c')).toBe('(job_title.ilike."*a\\"b,c*",job_id.ilike."*a\\"b,c*")');
  });
});

describe('history store (D-32)', () => {
  it('saves with an upsert, and skips failed checks', async () => {
    const { store, calls } = fakeDb();
    await store.save(result());
    await store.save(errorResult(JOB, 'u', 'E-NETWORK', 'x', new Date()));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe('job_checks?on_conflict=user_id,job_id');
    expect(calls[0]!.init).toMatchObject({ method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal' });
    expect(calls[0]!.init.body).toEqual([toRow(result())]);
  });

  it('keeps a result it cannot upload in the outbox and sends it with the next save', async () => {
    let online = false;
    const { store, calls } = fakeDb(() => (online ? [] : offline()));
    await store.save(result());
    expect(await store.pending()).toBe(1);
    expect(await store.checkedIds([JOB, '~02other0000'])).toEqual(new Set([JOB]));
    expect((await store.get(JOB))?.jobTitle).toBe(result().jobTitle);

    online = true;
    calls.length = 0;
    await store.save(result({ jobId: '~0219810000000000002' }));
    expect(calls.map((c) => (c.init.body as CheckRow[]).map((r) => r.job_id))).toEqual([['~0219810000000000002'], [JOB]]);
    expect(await store.pending()).toBe(0);
  });

  it('lists summaries newest first, a page at a time, with the best finding read from the JSON', async () => {
    const summary = { job_id: JOB, job_title: 'T', verdict: 'has_potential', checked_at: '2026-10-25T09:00:00+00:00', best_value: 'Bindex' };
    const { store, calls } = fakeDb(() => Array.from({ length: 3 }, () => summary));
    const page = await store.list('seo', 100, 2);
    expect(page.more).toBe(true);
    expect(page.rows).toEqual([
      { jobId: JOB, jobTitle: 'T', verdict: 'has_potential', checkedAt: '2026-10-25T09:00:00+00:00', bestValue: 'Bindex' },
      { jobId: JOB, jobTitle: 'T', verdict: 'has_potential', checkedAt: '2026-10-25T09:00:00+00:00', bestValue: 'Bindex' },
    ]);
    expect(calls[0]!.path).toBe(
      'job_checks?select=job_id,job_title,verdict,checked_at,best_value:evidence->0->>value&or=(job_title.ilike."*seo*",job_id.ilike."*seo*")&order=checked_at.desc&offset=100&limit=3',
    );
  });

  it('asks the database which jobs are already checked', async () => {
    const { store, calls } = fakeDb(() => [{ job_id: JOB }]);
    expect(await store.checkedIds([JOB, '~02x0000000'])).toEqual(new Set([JOB]));
    expect(calls[0]!.path).toBe(`job_checks?select=job_id&job_id=in.("${JOB}","~02x0000000")`);
    expect(await store.checkedIds([])).toEqual(new Set());
  });

  it('opens and deletes one check, and deletes all', async () => {
    const row = toRow(result())!;
    const { store, calls } = fakeDb((_path, init) => (init.method === 'DELETE' ? undefined : [row]));
    expect((await store.get(JOB))?.evidence[0]?.value).toBe('Bindex');
    await store.remove(JOB);
    await store.removeAll();
    expect(calls.map((c) => [c.init.method ?? 'GET', c.path])).toEqual([
      ['GET', `job_checks?select=*&job_id=eq.${JOB}`],
      ['DELETE', `job_checks?job_id=eq.${JOB}`],
      ['DELETE', 'job_checks?job_id=not.is.null'],
    ]);
  });

  it('fetches every check for an export, 1000 rows per request', async () => {
    const row = toRow(result())!;
    const { store, calls } = fakeDb((path) => (path.includes('offset=0') ? Array.from({ length: 1000 }, () => row) : [row]));
    expect(await store.fetch('all')).toHaveLength(1001);
    expect(calls).toHaveLength(2);
    await store.fetch([JOB]);
    expect(calls.at(-1)!.path).toContain(`job_id=in.("${JOB}")`);
  });
});
