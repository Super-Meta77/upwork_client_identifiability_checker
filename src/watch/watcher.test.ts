import { describe, expect, it, vi } from 'vitest';
import { emptyState, type BatchRow, type RunnerState } from '../runner/runner';
import type { SavedQueue } from '../store/local-state';
import type { PageScan } from './page-scan';
import { MAX_SEARCH_LENGTH, searchUrl } from './search-page';
import { WatchError, type TabDriver } from './tabs';
import { MIN_WATCH_INTERVAL_MS, SearchWatcher, type WatchDeps, type WatchRun, type WatchState } from './watcher';

const SEARCH = 'https://www.upwork.com/nx/search/jobs/?q=%2F&sort=recency';
const jobId = (n: number) => `~02${String(n).padStart(17, '0')}`;
const link = (n: number) => `https://www.upwork.com/jobs/Job-${n}_${jobId(n)}/?referrer_url_path=%2Fnx%2Fsearch%2Fjobs%2F`;
/** A page listing jobs newest first, as Upwork does. */
const page = (...jobs: number[]): PageScan => ({ links: jobs.map(link), blocked: false });
const queryOf = (url: string) => new URL(url).searchParams.get('q');

interface Options {
  deps?: Partial<WatchDeps>;
  run?: Partial<WatchRun>;
  /** Typing starts a search (the page URL takes the new query). */
  typing?: boolean;
  startUrl?: string;
  /** Overrides the state a round's batch ends with. */
  outcome?: (queue: SavedQueue) => Partial<RunnerState>;
  /** Called on each wait between auto-refresh rounds. */
  onSleep?: (count: number, watcher: SearchWatcher) => void;
}

function setup(pages: (PageScan | Error)[], { deps = {}, run = {}, typing = true, startUrl = SEARCH, outcome, onSleep }: Options = {}) {
  const typed: string[] = [];
  const loads: string[] = [];
  const batches: string[][] = [];
  const sleeps: number[] = [];
  const states: WatchState[] = [];
  const runnerStop = vi.fn();
  let tabUrl: string | null = startUrl;
  let scans = 0;

  const tabs: TabDriver = {
    find: async () => ({ id: 7, url: startUrl }),
    url: async () => tabUrl,
    type: async (_id, query) => {
      typed.push(query);
      if (!typing) return { searched: false, blocked: false };
      tabUrl = searchUrl(tabUrl!, query);
      return { searched: true, blocked: false };
    },
    load: async (_id, url) => {
      loads.push(url);
      tabUrl = url;
    },
    scan: async () => {
      const next = pages[scans++] ?? page();
      if (next instanceof Error) throw next;
      return next;
    },
  };

  const watcher: SearchWatcher = new SearchWatcher({
    tabs,
    checkedIds: async () => new Set(),
    dayCount: async () => 0,
    sleep: async (ms) => {
      sleeps.push(ms);
      onSleep?.(sleeps.length, watcher);
    },
    now: () => 0,
    newId: () => 'q',
    onChange: (s) => states.push(s),
    ...deps,
  });

  const config: WatchRun = {
    createRunner: (onChange) => ({
      run: async (queue) => {
        batches.push(queue.items.map((i) => i.jobId));
        const rows: BatchRow[] = queue.items.map((i) => ({ key: i.jobId, input: i.url, jobId: i.jobId, url: i.url, status: 'done', result: null, error: null }));
        const state: RunnerState = { ...emptyState(), phase: 'done', rows, total: rows.length, completed: rows.length, ...outcome?.(queue) };
        onChange(state);
        return state;
      },
      stop: runnerStop,
    }),
    dailyLimit: 200,
    intervalMs: 60_000,
    ...run,
  };
  return { watcher, config, typed, loads, batches, sleeps, states, runnerStop, moveTab: (url: string | null) => (tabUrl = url) };
}

describe('Run: one refresh now (D-31)', () => {
  it('types one more "/" into the search, then checks the jobs not checked before', async () => {
    const { watcher, config, typed, loads, batches, sleeps } = setup([page(3, 2, 1)]);
    const final = await watcher.run(config);
    expect(typed).toEqual(['//']);
    expect(loads).toEqual([]);
    expect(batches).toEqual([[jobId(3), jobId(2), jobId(1)]]);
    expect(sleeps).toEqual([]);
    expect(final).toMatchObject({ phase: 'idle', auto: false, stopReason: null, rounds: 1, onPage: 3, fresh: 3, checked: 3, lastSearch: { query: '//', reloaded: false } });
  });

  it('skips jobs that are already saved', async () => {
    const { watcher, config, batches } = setup([page(3, 2, 1)], { deps: { checkedIds: async () => new Set([jobId(2)]) } });
    await watcher.run(config);
    expect(batches).toEqual([[jobId(3), jobId(1)]]);
  });

  it('keeps the jobs it met and the rows it checked between runs', async () => {
    const { watcher, config, typed, batches } = setup([page(2, 1), page(3, 2, 1)]);
    await watcher.run(config);
    const second = await watcher.run(config);
    expect(typed).toEqual(['//', '///']);
    expect(batches).toEqual([[jobId(2), jobId(1)], [jobId(3)]]);
    expect(second.rows.map((r) => r.jobId)).toEqual([jobId(3), jobId(2), jobId(1)]);
    expect(second).toMatchObject({ rounds: 2, checked: 3 });
  });

  it('reloads the page with the search when typing does not start one', async () => {
    const { watcher, config, loads } = setup([page(1)], { typing: false });
    const final = await watcher.run(config);
    expect(loads.map(queryOf)).toEqual(['//']);
    expect(final.lastSearch).toEqual({ query: '//', reloaded: true });
  });

  it('reloads with "/" instead of typing once the search is long', async () => {
    const long = searchUrl(SEARCH, '/'.repeat(MAX_SEARCH_LENGTH));
    const { watcher, config, typed, loads } = setup([page(1)], { startUrl: long });
    await watcher.run(config);
    expect(typed).toEqual([]);
    expect(loads.map(queryOf)).toEqual(['/']);
  });
});

describe('auto-refresh (D-31)', () => {
  it('repeats every interval, searching anew and checking only new jobs', async () => {
    const { watcher, config, typed, batches, sleeps } = setup([page(3, 2, 1), page(5, 4, 3, 2, 1), page(5, 4, 3, 2, 1)], {
      onSleep: (n, w) => n >= 3 && w.setAuto(false),
    });
    watcher.setAuto(true);
    const final = await watcher.run(config);
    expect(typed).toEqual(['//', '///', '////']);
    expect(batches).toEqual([[jobId(3), jobId(2), jobId(1)], [jobId(5), jobId(4)]]);
    expect(sleeps).toEqual([60_000, 60_000, 60_000]);
    expect(final).toMatchObject({ phase: 'idle', auto: false, rounds: 3, checked: 5, stopReason: null });
  });

  it('refreshes no more often than every 30 s', async () => {
    const { watcher, config, sleeps } = setup([page(1)], { run: { intervalMs: 1_000 }, onSleep: (_n, w) => w.setAuto(false) });
    watcher.setAuto(true);
    await watcher.run(config);
    expect(sleeps).toEqual([MIN_WATCH_INTERVAL_MS]);
  });

  it('Run during the wait starts the next round at once', async () => {
    const { watcher, config, typed } = setup([page(1), page(2)], {
      onSleep: (n, w) => {
        if (n > 1) return;
        expect(w.getState().phase).toBe('waiting');
        expect(w.refreshNow()).toBe(true);
        w.setAuto(false);
      },
    });
    expect(watcher.refreshNow()).toBe(false);
    watcher.setAuto(true);
    const final = await watcher.run(config);
    expect(typed).toEqual(['//', '///']);
    expect(final.rounds).toBe(2);
  });

  it('Stop ends the wait and the batch in progress; a second run is refused meanwhile', async () => {
    const { watcher, config, runnerStop } = setup([page(1), page(2)], { onSleep: (_n, w) => w.stop() });
    watcher.setAuto(true);
    const running = watcher.run(config);
    expect(watcher.isActive()).toBe(true);
    await expect(watcher.run(config)).rejects.toThrow('already watching');
    const final = await running;
    expect(runnerStop).toHaveBeenCalled();
    expect(final).toMatchObject({ phase: 'idle', auto: false, stopReason: null, rounds: 1 });
    expect(watcher.isActive()).toBe(false);
  });
});

describe('watching stops by itself (D-31)', () => {
  it('on a Cloudflare page, while typing or reading', async () => {
    const onScan = setup([{ links: [], blocked: true }]);
    expect((await onScan.watcher.run(onScan.config)).stopReason?.code).toBe('E-BLOCKED');
    const onType = setup([page(1)]);
    const tabs = (onType.watcher as unknown as { deps: { tabs: TabDriver } }).deps.tabs;
    tabs.type = async () => ({ searched: false, blocked: true });
    expect((await onType.watcher.run(onType.config)).stopReason?.code).toBe('E-BLOCKED');
    expect(onType.batches).toEqual([]);
  });

  it('when a round stops on a login or permission error, and turns auto-refresh off', async () => {
    const { watcher, config, sleeps } = setup([page(2, 1)], {
      outcome: () => ({ phase: 'stopped', completed: 0, stopReason: { code: 'E-SCOPE', message: 'Upwork refused this request.' } }),
    });
    watcher.setAuto(true);
    const final = await watcher.run(config);
    expect(final).toMatchObject({ auto: false, stopReason: { code: 'E-SCOPE', message: 'Upwork refused this request.' } });
    expect(sleeps).toEqual([]);
  });

  it('when the tab leaves the search page', async () => {
    const { watcher, config, moveTab, typed } = setup([page(1), page(2)], {
      onSleep: () => moveTab('https://www.upwork.com/nx/search/jobs/details/~02198100000000000009'),
    });
    watcher.setAuto(true);
    const final = await watcher.run(config);
    expect(final.stopReason?.message).toMatch(/left the job search page/);
    expect(typed).toHaveLength(1);
  });

  it('at the daily limit, never going past it', async () => {
    let used = 1;
    const { watcher, config, batches } = setup([page(5, 4, 3, 2, 1), page(6)], {
      deps: { dayCount: async () => used },
      run: { dailyLimit: 3 },
      outcome: (q) => {
        used += q.items.length;
        return {};
      },
    });
    watcher.setAuto(true);
    const final = await watcher.run(config);
    expect(batches).toEqual([[jobId(5), jobId(4)]]);
    expect(final.stopReason?.message).toMatch(/limit of 3 jobs is reached/);
  });

  it('when no search page is open, or the tab cannot be used', async () => {
    const none = setup([page(1)]);
    (none.watcher as unknown as { deps: { tabs: TabDriver } }).deps.tabs.find = async () => null;
    expect((await none.watcher.run(none.config)).stopReason?.message).toMatch(/Open the Upwork job search page/);

    const closed = setup([new WatchError('The search tab was closed, so watching stopped.')]);
    expect((await closed.watcher.run(closed.config)).stopReason?.message).toBe('The search tab was closed, so watching stopped.');
    const broken = setup([new Error('boom')]);
    expect((await broken.watcher.run(broken.config)).stopReason?.message).toMatch(/could not be read/);
  });
});
