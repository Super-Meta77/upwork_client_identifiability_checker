// D-31: the only code that touches the user's tabs. It types into the watched search tab's search
// box (or reloads it), and reads its job links with chrome.scripting, only during a watch round.

import { readSearchPage, toPageScan, toTypedSearch, typeSearch, type PageScan, type TypedSearch } from './page-scan';
import { isSearchPageUrl, SEARCH_PAGE_PATTERN } from './search-page';

export const LOAD_TIMEOUT_MS = 30_000;
export const SCAN_TIMEOUT_MS = 15_000;
export const SCAN_SETTLE_MS = 1_000;
/** How long typing may take to start the search, and then to change the job list. */
export const TYPE_SEARCH_MS = 5_000;
export const TYPE_CHANGE_MS = 5_000;

/** A tab problem that ends watching; the message is shown to the user. */
export class WatchError extends Error {
  override name = 'WatchError';
}

export interface SearchTab {
  id: number;
  url: string;
}

export interface TabDriver {
  /** The search tab to watch: the active tab when it is one, else any open search tab. */
  find(): Promise<SearchTab | null>;
  /** The tab's current URL, or null when the tab is gone or shows a page we may not read. */
  url(tabId: number): Promise<string | null>;
  /** Types `query` into the page's search box and presses Enter. */
  type(tabId: number, query: string): Promise<TypedSearch>;
  /** Loads `url` in the tab; resolves once it has loaded, or straight away on abort. */
  load(tabId: number, url: string, signal: AbortSignal): Promise<void>;
  /** Reads the job links on the page. */
  scan(tabId: number): Promise<PageScan>;
}

const CLOSED = 'The search tab was closed, so watching stopped.';
const SLOW = `The search page took longer than ${LOAD_TIMEOUT_MS / 1000} s to load, so watching stopped.`;
const UNREADABLE = 'The search page could not be read, so watching stopped. Reload it, then press Run.';

function toSearchTab(tab: chrome.tabs.Tab | undefined): SearchTab | null {
  return tab?.id !== undefined && isSearchPageUrl(tab.url) ? { id: tab.id, url: tab.url } : null;
}

export function chromeTabDriver(): TabDriver {
  return {
    async find() {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      const own = toSearchTab(active);
      if (own) return own;
      for (const tab of await chrome.tabs.query({ url: SEARCH_PAGE_PATTERN })) {
        const found = toSearchTab(tab);
        if (found) return found;
      }
      return null;
    },

    async url(tabId) {
      try {
        return (await chrome.tabs.get(tabId)).url ?? null;
      } catch {
        return null;
      }
    },

    load(tabId, url, signal) {
      return new Promise<void>((resolve, reject) => {
        if (signal.aborted) return resolve();
        const timer = setTimeout(() => done(new WatchError(SLOW)), LOAD_TIMEOUT_MS);
        const onUpdated = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
          if (id === tabId && info.status === 'complete') done();
        };
        const onRemoved = (id: number) => {
          if (id === tabId) done(new WatchError(CLOSED));
        };
        const onAbort = () => done();
        function done(error?: WatchError) {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(onUpdated);
          chrome.tabs.onRemoved.removeListener(onRemoved);
          signal.removeEventListener('abort', onAbort);
          if (error) reject(error);
          else resolve();
        }
        chrome.tabs.onUpdated.addListener(onUpdated);
        chrome.tabs.onRemoved.addListener(onRemoved);
        signal.addEventListener('abort', onAbort, { once: true });

        const navigate = async () => {
          // Loading the URL the tab already shows is a reload; tabs.update is used only to change it.
          const tab = await chrome.tabs.get(tabId);
          if (tab.url === url) await chrome.tabs.reload(tabId);
          else await chrome.tabs.update(tabId, { url });
        };
        navigate().catch(() => done(new WatchError(CLOSED)));
      });
    },

    async type(tabId, query) {
      const typed = toTypedSearch(await inject(() => chrome.scripting.executeScript({ target: { tabId }, func: typeSearch, args: [query, TYPE_SEARCH_MS, TYPE_CHANGE_MS] })));
      if (!typed) throw new WatchError(UNREADABLE);
      return typed;
    },

    async scan(tabId) {
      const page = toPageScan(await inject(() => chrome.scripting.executeScript({ target: { tabId }, func: readSearchPage, args: [SCAN_TIMEOUT_MS, SCAN_SETTLE_MS] })));
      if (!page) throw new WatchError(UNREADABLE);
      return page;
    },
  };
}

/** Runs one injection and returns what the function returned in the page. */
async function inject(run: () => Promise<{ result?: unknown }[]>): Promise<unknown> {
  try {
    return (await run())[0]?.result;
  } catch {
    throw new WatchError(UNREADABLE);
  }
}
