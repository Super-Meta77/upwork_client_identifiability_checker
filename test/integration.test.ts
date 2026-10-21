// Full stack, offline: link parser -> runner -> Upwork client -> attachments -> analysis -> IndexedDB
// -> exports, with only fetch and chrome.* faked. Covers NFR-01, NFR-05, NFR-07 and NFR-08.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChecker } from '../src/app/compose';
import { parseLinks } from '../src/links/parse';
import { BatchRunner } from '../src/runner/runner';
import { listResults } from '../src/store/db';
import { getDayCount, loadQueue } from '../src/store/local-state';
import { DEFAULT_SETTINGS } from '../src/store/settings';
import { toCsv } from '../src/export/csv';
import { toJson } from '../src/export/json';
import { TOKEN_COOKIE_NAME } from '../src/upwork/config';
import { fakeChrome } from './fakes/chrome';
import { createGuardedFetch, jsonResponse, type RecordedCall } from './fakes/fetch';
import { errorFixture, jobFixture } from './fixtures';
import { makeOffice, makePdf } from './synthetic/attachments';

const SENTINEL = 'TOKEN-SENTINEL-7f3a9c1e5b2d4f60';

const JOBS: Record<string, string> = {
  '~0100000000000000001': 'synthetic-01-s1-company',
  '~0100000000000000002': 'synthetic-02-intro-and-website',
  '~0100000000000000003': 'synthetic-03-third-party',
  '~0100000000000000005': 'synthetic-05-attachments',
  '~0100000000000000006': 'synthetic-06-reviews',
  '~0100000000000000007': 'synthetic-07-enterprise',
};
const MISSING = '~0100000000000000404';

let attachments: Record<string, Uint8Array> = {};

async function handler(call: RecordedCall): Promise<Response> {
  await new Promise((r) => setTimeout(r, 50));
  if (call.url.endsWith('/api/graphql/v1')) {
    const { variables } = JSON.parse(call.body ?? '{}') as { variables: { id: string } };
    const fixture = JOBS[variables.id];
    return jsonResponse(fixture ? jobFixture(fixture) : errorFixture('not-found'));
  }
  const name = Object.keys(attachments).find((k) => call.url.includes(k));
  return name ? new Response(new Uint8Array(attachments[name]!), { status: 200 }) : new Response('', { status: 404 });
}

/** Advances fake time until the promise settles, letting real IndexedDB callbacks run in between. */
async function drive<T>(promise: Promise<T>): Promise<T> {
  let settled = false;
  void promise.finally(() => (settled = true)).catch(() => undefined);
  while (!settled) {
    await vi.advanceTimersByTimeAsync(500);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return promise;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: new Date('2026-10-21T09:00:00Z') });
  fakeChrome()._cookies.set(TOKEN_COOKIE_NAME, SENTINEL);
  attachments = {
    '/aaaa/': makeOffice('word/document.xml', { creator: 'Maria Lopez', company: 'Tailspin Toys Ltd' }),
    '/bbbb/': await makePdf({ author: 'User' }),
  };
});
afterEach(() => {
  vi.useRealTimers();
});

describe('full batch, offline', () => {
  it('checks a batch end to end within every request and data-handling limit', async () => {
    const consoleOutput: string[] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void consoleOutput.push(args.map(String).join(' ')));
    }

    const guarded = createGuardedFetch(handler);
    const checker = createChecker(DEFAULT_SETTINGS, { fetch: guarded.fetch });
    const savedCounts: number[] = [];
    const deps = checker.runnerDeps(() => {});
    const runner = new BatchRunner({
      ...deps,
      save: async (r) => {
        await deps.save(r);
        savedCounts.push((await listResults()).length);
      },
    });

    const text = [
      ...Object.keys(JOBS).map((id) => `https://www.upwork.com/jobs/${id}`),
      `https://www.upwork.com/jobs/${MISSING}`,
      'https://www.upwork.com/freelancers/~01aaaaaaaaaaaaaaaa',
    ].join('\n');
    const parsed = parseLinks(text);
    const final = await drive(runner.run({ id: 'b1', createdAt: '', items: parsed.links.map(({ jobId, url }) => ({ jobId, url })), nextIndex: 0 }, parsed.errors));

    // NFR-05: one failing link (not found) and one invalid link never stop the batch.
    expect(final.phase).toBe('done');
    expect(final.rows.map((r) => r.status)).toEqual(['error', 'done', 'done', 'done', 'done', 'done', 'done', 'error']);
    // NFR-05: each result is saved as soon as its job finishes.
    expect(savedCounts).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // NFR-01: one request in flight; NFR-07: only www.upwork.com was contacted.
    expect(guarded.maxInFlight()).toBe(1);
    expect(new Set(guarded.calls.map((c) => new URL(c.url).hostname))).toEqual(new Set(['www.upwork.com']));
    // NFR-02: the daily count tracks job-details requests.
    expect(await getDayCount(new Date())).toBe(7);
    expect(await loadQueue()).toBeNull();

    const results = await listResults();
    const byId = Object.fromEntries(results.map((r) => [r.jobId, r]));
    expect(byId['~0100000000000000001']?.verdict).toBe('identified');
    expect(byId['~0100000000000000007']?.verdict).toBe('narrowable');
    expect(byId[MISSING]).toMatchObject({ verdict: 'error', error: { code: 'E-NOTFOUND' } });
    const withFiles = byId['~0100000000000000005']!;
    expect(withFiles.evidence.find((e) => e.source === 'S2-props' && e.kind === 'company_name')).toMatchObject({ value: 'Tailspin Toys Ltd', confidence: 'high' });
    expect(withFiles.evidence.some((e) => e.value === 'User')).toBe(false);
    expect(withFiles.attachmentNotes.map((n) => n.fileName)).toEqual(['notes.txt', 'extra-2.pdf', 'box-photo.jpg', 'huge-scan.pdf', 'extra-1.pdf']);

    // NFR-08: the token exists only in chrome.storage.session.
    const chrome = fakeChrome();
    const everywhereElse = [
      JSON.stringify(results),
      JSON.stringify(chrome.storage.local.dump()),
      toCsv(results),
      toJson(results, new Date()),
      JSON.stringify(final),
      consoleOutput.join('\n'),
    ].join('\n');
    expect(everywhereElse).not.toContain(SENTINEL);
    expect(chrome.storage.session.dump()).toEqual({ upworkToken: SENTINEL });
  });

  it('stops at E-AUTH without trying the remaining links', async () => {
    fakeChrome()._cookies.clear();
    const guarded = createGuardedFetch(handler);
    const runner = new BatchRunner(createChecker(DEFAULT_SETTINGS, { fetch: guarded.fetch }).runnerDeps(() => {}));
    const items = Object.keys(JOBS).map((jobId) => ({ jobId, url: `https://www.upwork.com/jobs/${jobId}` }));
    const final = await drive(runner.run({ id: 'b2', createdAt: '', items, nextIndex: 0 }));
    expect(final).toMatchObject({ phase: 'stopped', stopReason: { code: 'E-AUTH' } });
    expect(guarded.calls).toHaveLength(0);
    expect((await loadQueue())?.nextIndex).toBe(0);
  });
});
