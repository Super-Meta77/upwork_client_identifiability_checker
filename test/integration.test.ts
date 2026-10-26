// Full stack, offline: links read from the search page -> runner -> Upwork client -> analysis ->
// saved history rows -> exports, with only fetch, chrome.* and the database faked. Covers NFR-01,
// NFR-05, NFR-07 and NFR-08.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChecker } from '../src/app/compose';
import type { Result } from '../src/core/types';
import { toCsv } from '../src/export/csv';
import { toJson } from '../src/export/json';
import { BatchRunner } from '../src/runner/runner';
import { toRow } from '../src/store/checks';
import { getDayCount } from '../src/store/local-state';
import { DEFAULT_SETTINGS } from '../src/store/settings';
import { TOKEN_KEY } from '../src/upwork/token';
import { jobsFromLinks } from '../src/watch/search-page';
import { fakeChrome } from './fakes/chrome';
import { createGuardedFetch, jsonResponse, type RecordedCall } from './fakes/fetch';
import { errorFixture, jobFixture } from './fixtures';

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

async function handler(call: RecordedCall): Promise<Response> {
  await new Promise((r) => setTimeout(r, 50));
  const { variables } = JSON.parse(call.body ?? '{}') as { variables: { id: string } };
  const fixture = JOBS[variables.id];
  return jsonResponse(fixture ? jobFixture(fixture) : errorFixture('not-found'));
}

/** Advances fake time until the promise settles. */
async function drive<T>(promise: Promise<T>): Promise<T> {
  let settled = false;
  void promise.finally(() => (settled = true)).catch(() => undefined);
  while (!settled) {
    await vi.advanceTimersByTimeAsync(500);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return promise;
}

/** The job links a search page shows, newest first, among other links. */
const pageLinks = [
  ...Object.keys(JOBS).map((id) => `https://www.upwork.com/jobs/Some-title_${id}/?referrer_url_path=%2Fnx%2Fsearch%2Fjobs%2F`),
  `https://www.upwork.com/jobs/${MISSING}`,
  'https://www.upwork.com/freelancers/~01aaaaaaaaaaaaaaaa',
  'https://www.upwork.com/nx/find-work/',
];

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: new Date('2026-10-21T09:00:00Z') });
  await fakeChrome().storage.session.set({ [TOKEN_KEY]: SENTINEL });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('full round, offline', () => {
  it('checks the jobs of a search page end to end within every request and data-handling limit', async () => {
    const consoleOutput: string[] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void consoleOutput.push(args.map(String).join(' ')));
    }

    const guarded = createGuardedFetch(handler);
    const results: Result[] = [];
    const checker = createChecker(DEFAULT_SETTINGS, { fetch: guarded.fetch, save: async (r) => void results.push(r) });
    const savedCounts: number[] = [];
    const deps = checker.runnerDeps(() => {});
    const runner = new BatchRunner({
      ...deps,
      save: async (r) => {
        await deps.save(r);
        savedCounts.push(results.length);
      },
    });

    const final = await drive(runner.run(jobsFromLinks(pageLinks)));

    // NFR-05: one failing job (not found) never stops the round; other links are ignored.
    expect(final.phase).toBe('done');
    expect(final.rows.map((r) => r.status)).toEqual(['done', 'done', 'done', 'done', 'done', 'done', 'error']);
    // NFR-05: each result is saved as soon as its job finishes.
    expect(savedCounts).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // NFR-01: one request in flight; NFR-07: only the job-details endpoint was contacted, no downloads.
    expect(guarded.maxInFlight()).toBe(1);
    expect(new Set(guarded.calls.map((c) => new URL(c.url).pathname))).toEqual(new Set(['/api/graphql/v1']));
    expect(guarded.calls).toHaveLength(7);
    // NFR-02: the daily count tracks job-details requests.
    expect(await getDayCount(new Date())).toBe(7);

    const byId = Object.fromEntries(results.map((r) => [r.jobId, r]));
    expect(byId['~0100000000000000001']?.verdict).toBe('has_potential');
    expect(byId['~0100000000000000007']?.verdict).toBe('no_potential');
    expect(byId['~0100000000000000005']?.evidence.map((e) => [e.source, e.value, e.confidence])).toEqual([['S2-file', 'Tailspin Toys', 'low']]);
    expect(byId[MISSING]).toMatchObject({ verdict: 'error', error: { code: 'E-NOTFOUND' } });

    // NFR-08: the token exists only in chrome.storage.session.
    const chrome = fakeChrome();
    const everywhereElse = [
      JSON.stringify(results),
      JSON.stringify(results.map((r) => toRow(r))),
      JSON.stringify(chrome.storage.local.dump()),
      toCsv(results),
      toJson(results, new Date()),
      JSON.stringify(final),
      consoleOutput.join('\n'),
    ].join('\n');
    expect(everywhereElse).not.toContain(SENTINEL);
    expect(chrome.storage.session.dump()).toEqual({ [TOKEN_KEY]: SENTINEL });
  });

  it('stops at E-AUTH without a token, before any request', async () => {
    await fakeChrome().storage.session.clear();
    const guarded = createGuardedFetch(handler);
    const runner = new BatchRunner(createChecker(DEFAULT_SETTINGS, { fetch: guarded.fetch, save: async () => {} }).runnerDeps(() => {}));
    const final = await drive(runner.run(jobsFromLinks(pageLinks)));
    expect(final).toMatchObject({ phase: 'stopped', stopReason: { code: 'E-AUTH' } });
    expect(guarded.calls).toHaveLength(0);
  });
});
