import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSearchPage, typeSearch } from './page-scan';
import { chromeTabDriver, LOAD_TIMEOUT_MS, TYPE_CHANGE_MS, TYPE_SEARCH_MS, WatchError } from './tabs';

const SEARCH = 'https://www.upwork.com/nx/search/jobs/?q=%2F&sort=recency';

interface FakeTab {
  id: number;
  url?: string;
  active?: boolean;
}

type Listener = (...args: unknown[]) => void;

/** chrome.tabs and chrome.scripting stand-ins, installed on the fake chrome from test/setup.ts. */
function install(tabs: FakeTab[], scan: () => Promise<unknown> = async () => [{ result: { links: [], blocked: false } }]) {
  const byId = new Map(tabs.map((t) => [t.id, t]));
  const updated = new Set<Listener>();
  const removed = new Set<Listener>();
  const events = (set: Set<Listener>) => ({ addListener: (f: Listener) => set.add(f), removeListener: (f: Listener) => set.delete(f) });
  const api = {
    query: vi.fn(async (q: { active?: boolean; url?: string }) => (q.active ? tabs.filter((t) => t.active) : tabs.filter((t) => t.url?.startsWith('https://www.upwork.com/nx/search/jobs')))),
    get: async (id: number) => {
      const tab = byId.get(id);
      if (!tab) throw new Error('No tab with id');
      return tab;
    },
    update: vi.fn(async (id: number, props: { url: string }) => {
      byId.get(id)!.url = props.url;
    }),
    reload: vi.fn(async () => {}),
    onUpdated: events(updated),
    onRemoved: events(removed),
  };
  const executeScript = vi.fn(scan);
  Object.assign(globalThis.chrome, { tabs: api, scripting: { executeScript } });
  return {
    api,
    executeScript,
    fireUpdated: (id: number, status: string) => updated.forEach((f) => f(id, { status })),
    fireRemoved: (id: number) => removed.forEach((f) => f(id)),
    listenerCount: () => updated.size + removed.size,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('search tab driver (D-31)', () => {
  it('finds the active search tab, else any open search tab', async () => {
    install([{ id: 1, url: 'https://example.com', active: true }, { id: 2, url: SEARCH }]);
    expect(await chromeTabDriver().find()).toEqual({ id: 2, url: SEARCH });
    install([{ id: 3, url: SEARCH, active: true }]);
    expect(await chromeTabDriver().find()).toEqual({ id: 3, url: SEARCH });
    install([{ id: 4, url: 'https://www.upwork.com/nx/search/jobs/details/~02198100000000000001', active: true }]);
    expect(await chromeTabDriver().find()).toBeNull();
  });

  it("reads a tab's URL, or null once it is gone", async () => {
    install([{ id: 1, url: SEARCH }]);
    expect(await chromeTabDriver().url(1)).toBe(SEARCH);
    expect(await chromeTabDriver().url(9)).toBeNull();
  });

  it('navigates to a new URL and resolves once that tab has loaded', async () => {
    const fake = install([{ id: 1, url: 'https://www.upwork.com/nx/search/jobs/?q=react' }]);
    let loaded = false;
    const load = chromeTabDriver()
      .load(1, SEARCH, new AbortController().signal)
      .then(() => (loaded = true));
    await vi.waitFor(() => expect(fake.api.update).toHaveBeenCalledWith(1, { url: SEARCH }));
    fake.fireUpdated(2, 'complete');
    fake.fireUpdated(1, 'loading');
    await Promise.resolve();
    expect(loaded).toBe(false);
    fake.fireUpdated(1, 'complete');
    await load;
    expect(fake.listenerCount()).toBe(0);
  });

  it('reloads when the tab already shows the URL', async () => {
    const fake = install([{ id: 1, url: SEARCH }]);
    const load = chromeTabDriver().load(1, SEARCH, new AbortController().signal);
    await vi.waitFor(() => expect(fake.api.reload).toHaveBeenCalledWith(1));
    expect(fake.api.update).not.toHaveBeenCalled();
    fake.fireUpdated(1, 'complete');
    await load;
  });

  it('fails when the tab is closed or the page is too slow, and returns at once on Stop', async () => {
    const fake = install([{ id: 1, url: SEARCH }]);
    const closed = chromeTabDriver().load(1, SEARCH, new AbortController().signal);
    fake.fireRemoved(1);
    await expect(closed).rejects.toBeInstanceOf(WatchError);

    vi.useFakeTimers();
    const slow = expect(chromeTabDriver().load(1, SEARCH, new AbortController().signal)).rejects.toThrow(/took longer than 30 s/);
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS);
    await slow;

    const stop = new AbortController();
    const stopped = chromeTabDriver().load(1, SEARCH, stop.signal);
    stop.abort();
    await stopped;
    stop.abort();
    await chromeTabDriver().load(1, SEARCH, stop.signal);
    expect(fake.listenerCount()).toBe(0);
  });

  it('fails when the tab cannot be navigated', async () => {
    install([]);
    await expect(chromeTabDriver().load(5, SEARCH, new AbortController().signal)).rejects.toBeInstanceOf(WatchError);
  });

  it('reads the job links with an injected, read-only scan', async () => {
    const fake = install([{ id: 1, url: SEARCH }], async () => [{ result: { links: ['https://www.upwork.com/jobs/~02198100000000000001'], blocked: false } }]);
    expect(await chromeTabDriver().scan(1)).toEqual({ links: ['https://www.upwork.com/jobs/~02198100000000000001'], blocked: false });
    expect(fake.executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 1 }, func: readSearchPage }));
  });

  it('types the search into the page with an injected function', async () => {
    const fake = install([{ id: 1, url: SEARCH }], async () => [{ result: { searched: true, blocked: false } }]);
    expect(await chromeTabDriver().type(1, '//')).toEqual({ searched: true, blocked: false });
    expect(fake.executeScript).toHaveBeenCalledWith({ target: { tabId: 1 }, func: typeSearch, args: ['//', TYPE_SEARCH_MS, TYPE_CHANGE_MS] });
    install([{ id: 1, url: SEARCH }], async () => [{ result: undefined }]);
    await expect(chromeTabDriver().type(1, '//')).rejects.toBeInstanceOf(WatchError);
  });

  it('fails when the page cannot be read', async () => {
    install([{ id: 1, url: SEARCH }], async () => {
      throw new Error('Cannot access contents of the page');
    });
    await expect(chromeTabDriver().scan(1)).rejects.toBeInstanceOf(WatchError);
    install([{ id: 1, url: SEARCH }], async () => [{ result: null }]);
    await expect(chromeTabDriver().scan(1)).rejects.toBeInstanceOf(WatchError);
  });
});
