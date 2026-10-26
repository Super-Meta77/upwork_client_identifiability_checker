import { describe, expect, it } from 'vitest';
import { CheckerError } from '../core/errors';
import type { Result } from '../core/types';
import { errorResult } from '../pipeline/analyse';
import { evidence } from '../../test/builders';
import { fakeChrome } from '../../test/fakes/chrome';
import { createChecksStore, fromRow, searchFilter, toRow, type CheckRow } from './checks';
import { LEGACY_DB } from './legacy';
import type { Database, RestInit } from './supabase';

const JOB = '~0219810000000000001';

function result(over: Partial<Result> = {}): Result {
  return {
    ...errorResult(JOB, `https://www.upwork.com/jobs/${JOB}`, 'E-NOTFOUND', '', new Date('2026-10-25T09:00:00Z')),
    verdict: 'partial',
    error: null,
    jobTitle: 'Shopify Expert | Bulk CSV Product Upload',
    distinctiveness: { score: 35, attributes: ['city', 'member_since'], details: [{ attribute: 'city', value: 'Austin', points: 25 }, { attribute: 'member_since', value: '2019-03-01', points: 10 }] },
    profile: { companyId: 'c1', country: 'United States', city: 'Austin', industry: 'Tech', size: '10', memberSinceYear: 2019 },
    evidence: [
      evidence({ id: 'a', source: 'S5', kind: 'person_first_name', value: 'Lucas', confidence: 'low', snippet: 'Lucas', reasonId: 'R-S5' }),
      evidence({ id: 'b', source: 'S2-text', value: 'Bindex', confidence: 'high', baseConfidence: 'medium', snippet: '…we are Bindex, a studio…', mentions: 2, ruleId: 'C-S2T-CO', agreesWith: ['c'] }),
      evidence({ id: 'c', source: 'S2-file', value: 'Bindex', confidence: 'medium', baseConfidence: 'low', snippet: 'Bindex_brief.pdf', reasonId: 'R-S2-file' }),
    ],
    bestEvidenceId: 'b',
    attachmentNotes: [{ fileName: 'notes.txt', code: 'E-ATTACH', message: 'not analysed' }],
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

describe('history rows (D-32)', () => {
  it('stores only what the panel uses, best finding first', () => {
    const row = toRow(result())!;
    expect(Object.keys(row).sort()).toEqual(
      ['best_value', 'checked_at', 'client_city', 'client_company_id', 'client_country', 'client_industry', 'client_since', 'client_size', 'evidence', 'job_id', 'job_title', 's3_details', 's3_score', 'verdict'].sort(),
    );
    expect(row).toMatchObject({ job_id: JOB, verdict: 'partial', best_value: 'Bindex', s3_score: 35, client_city: 'Austin', client_since: 2019 });
    expect(row.evidence).toEqual([
      { source: 'S2-text', kind: 'company_name', value: 'Bindex', confidence: 'high', raised_from: 'medium', location: 'opening.job.description', snippet: '…we are Bindex, a studio…', mentions: 2 },
      { source: 'S5', kind: 'person_first_name', value: 'Lucas', confidence: 'low', location: 'opening.job.description' },
      { source: 'S2-file', kind: 'company_name', value: 'Bindex', confidence: 'medium', raised_from: 'low', location: 'opening.job.description', snippet: 'Bindex_brief.pdf' },
    ]);
  });

  it('adds the known client name only when asked', () => {
    const gt = { companyName: 'Bindex', matchedEvidenceIds: ['b'] };
    expect(toRow(result({ groundTruth: gt }))).not.toHaveProperty('known_company');
    expect(toRow(result({ groundTruth: gt }), true)).toMatchObject({ known_company: 'Bindex', known_person: null, known_website: null });
  });

  it('does not store failed checks', () => {
    expect(toRow(errorResult(JOB, 'u', 'E-NOTFOUND', 'gone', new Date()))).toBeNull();
  });

  it('rebuilds the card from a row, with matches for a known name worked out again', () => {
    const back = fromRow({ ...toRow(result())!, known_company: 'Bindex' });
    expect(back).toMatchObject({ jobId: JOB, url: `https://www.upwork.com/jobs/${JOB}`, verdict: 'partial', bestEvidenceId: 'e0', error: null, attachmentNotes: [] });
    expect(back.distinctiveness?.attributes).toEqual(['city', 'member_since']);
    expect(back.profile).toEqual(result().profile);
    expect(back.evidence[0]).toMatchObject({ id: 'e0', value: 'Bindex', confidence: 'high', baseConfidence: 'medium', reasonId: 'R-S2-text', mentions: 2 });
    expect(back.evidence[1]).toMatchObject({ value: 'Lucas', baseConfidence: 'low', snippet: 'Lucas', mentions: 1, reasonId: 'R-S5' });
    expect(back.groundTruth).toEqual({ companyName: 'Bindex', personName: undefined, website: undefined, matchedEvidenceIds: ['e0', 'e2'] });
  });

  it('builds the history search for job ID, title and verdict', () => {
    expect(searchFilter('  ')).toBeNull();
    expect(searchFilter('SEO')).toBe('(job_title.ilike."*seo*",job_id.ilike."*seo*")');
    expect(searchFilter('partially')).toBe('(job_title.ilike."*partially*",job_id.ilike."*partially*",verdict.in.(partial))');
    expect(searchFilter('identified')).toContain('verdict.in.(identified,partial)');
    expect(searchFilter('not identifiable')).toContain('verdict.in.(not_identifiable)');
    expect(searchFilter('a"b,c')).toBe('(job_title.ilike."*a\\"b,c*",job_id.ilike."*a\\"b,c*")');
  });
});

describe('history store (D-32)', () => {
  it('saves with an upsert that keeps the known name, and skips failed checks', async () => {
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

  it('lists summaries newest first, a page at a time', async () => {
    const summary = { job_id: JOB, job_title: 'T', verdict: 'partial', checked_at: '2026-10-25T09:00:00+00:00', best_value: 'Bindex', s3_score: 35 };
    const { store, calls } = fakeDb(() => Array.from({ length: 3 }, () => summary));
    const page = await store.list('seo', 100, 2);
    expect(page.more).toBe(true);
    expect(page.rows).toEqual([
      { jobId: JOB, jobTitle: 'T', verdict: 'partial', checkedAt: '2026-10-25T09:00:00+00:00', bestValue: 'Bindex', s3Score: 35 },
      { jobId: JOB, jobTitle: 'T', verdict: 'partial', checkedAt: '2026-10-25T09:00:00+00:00', bestValue: 'Bindex', s3Score: 35 },
    ]);
    expect(calls[0]!.path).toBe(
      'job_checks?select=job_id,job_title,verdict,checked_at,best_value,s3_score&or=(job_title.ilike."*seo*",job_id.ilike."*seo*")&order=checked_at.desc&offset=100&limit=3',
    );
  });

  it('asks the database which jobs are already checked', async () => {
    const { store, calls } = fakeDb(() => [{ job_id: JOB }]);
    expect(await store.checkedIds([JOB, '~02x0000000'])).toEqual(new Set([JOB]));
    expect(calls[0]!.path).toBe(`job_checks?select=job_id&job_id=in.("${JOB}","~02x0000000")`);
    expect(await store.checkedIds([])).toEqual(new Set());
  });

  it('opens, deletes, and sets the known name of one check', async () => {
    const row = toRow(result())!;
    const { store, calls } = fakeDb((_path, init) => (init.method === 'DELETE' ? undefined : [row]));
    expect((await store.get(JOB))?.evidence[0]?.value).toBe('Bindex');
    expect((await store.setKnownClient(JOB, { personName: 'Lucas', matchedEvidenceIds: [] }))?.jobId).toBe(JOB);
    await store.remove(JOB);
    await store.removeAll();
    expect(calls.map((c) => [c.init.method ?? 'GET', c.path])).toEqual([
      ['GET', `job_checks?select=*&job_id=eq.${JOB}`],
      ['PATCH', `job_checks?job_id=eq.${JOB}`],
      ['DELETE', `job_checks?job_id=eq.${JOB}`],
      ['DELETE', 'job_checks?job_id=not.is.null'],
    ]);
    expect(calls[1]!.init).toMatchObject({ body: { known_person: 'Lucas', known_company: null, known_website: null }, prefer: 'return=representation' });
  });

  it('fetches every check for an export, 1000 rows per request', async () => {
    const row = toRow(result())!;
    const { store, calls } = fakeDb((path) => (path.includes('offset=0') ? Array.from({ length: 1000 }, () => row) : [row]));
    expect(await store.fetch('all')).toHaveLength(1001);
    expect(calls).toHaveLength(2);
    expect((await store.withKnownClient()).length).toBe(1001);
    expect(calls[2]!.path).toContain('or=(known_person.not.is.null,known_company.not.is.null,known_website.not.is.null)');
    await store.fetch([JOB]);
    expect(calls.at(-1)!.path).toContain(`job_id=in.("${JOB}")`);
  });

  it('gets peer counts from the database', async () => {
    const { store, calls } = fakeDb(() => [{ country: 4, city: 1, industry: null, size: 0, member_since: 2 }]);
    expect(await store.peers(JOB)).toEqual({ country: 4, city: 1, industry: null, size: 0, memberSinceYear: 2 });
    expect(calls[0]).toEqual({ path: 'rpc/peer_counts', init: { method: 'POST', body: { p_job_id: JOB } } });
    const empty = fakeDb(() => []);
    expect(await empty.store.peers(JOB)).toEqual({ country: null, city: null, industry: null, size: null, memberSinceYear: null });
  });
});

describe('moving the old browser history (D-32)', () => {
  async function createLegacy(results: Result[]) {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open(LEGACY_DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore('results', { keyPath: 'jobId' });
      open.onsuccess = () => {
        const tx = open.result.transaction('results', 'readwrite');
        for (const r of results) tx.objectStore('results').put(r);
        tx.oncomplete = () => {
          open.result.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }

  it('uploads saved checks once with their known names, then deletes the old database', async () => {
    await createLegacy([result({ groundTruth: { companyName: 'Bindex', matchedEvidenceIds: [] } }), errorResult('~0219810000000000404', 'u', 'E-NOTFOUND', '', new Date())]);
    const { store, calls } = fakeDb();
    expect(await store.moveLegacyHistory()).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.body).toEqual([toRow(result({ groundTruth: { companyName: 'Bindex', matchedEvidenceIds: [] } }), true)]);
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain(LEGACY_DB);
    expect(await store.moveLegacyHistory()).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it('keeps the old database when the upload fails', async () => {
    await createLegacy([result()]);
    const { store } = fakeDb(offline);
    await expect(store.moveLegacyHistory()).rejects.toMatchObject({ code: 'E-STORAGE' });
    expect((await indexedDB.databases()).map((d) => d.name)).toContain(LEGACY_DB);
  });
});
