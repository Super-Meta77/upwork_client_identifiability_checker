// D-31: the functions the watcher injects into the search tab with chrome.scripting, in the
// extension's isolated world, so they cannot see the page's own scripts or tokens. `typeSearch`
// types into the search box and presses Enter; `readSearchPage` only reads links and the title.

export interface PageScan {
  /** Absolute hrefs of links that may be job links, in page order. */
  links: string[];
  /** The tab shows a Cloudflare check instead of the search results. */
  blocked: boolean;
}

/**
 * Waits until the job list has rendered and stopped changing for `settleMs`, or `timeoutMs` has
 * passed, then returns the links. Chrome serialises this function before injecting it, so it must
 * stay self-contained: no imports and no variables from outside its body.
 */
export async function readSearchPage(timeoutMs: number, settleMs: number): Promise<PageScan> {
  const isBlocked = () => /just a moment|attention required|challenge/i.test(document.title);
  const read = () => Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="~"]'), (a) => a.href);
  const started = Date.now();
  let last = '';
  let stableSince = started;
  for (;;) {
    if (isBlocked()) return { links: [], blocked: true };
    const links = read();
    const key = links.join('\n');
    const now = Date.now();
    if (key !== last) {
      last = key;
      stableSince = now;
    }
    if ((links.length > 0 && now - stableSince >= settleMs) || now - started >= timeoutMs) return { links, blocked: false };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export interface TypedSearch {
  /** The search box was found and the page URL now carries the typed search. */
  searched: boolean;
  /** The tab shows a Cloudflare check instead of the search results. */
  blocked: boolean;
}

/**
 * Types `query` into Upwork's search box and presses Enter, as the user would, then waits up to
 * `searchMs` for the page URL to carry the new search and up to `changeMs` more for the job list
 * to change (it stays the same when no job was posted). readSearchPage then reads the list.
 * Self-contained for injection, like readSearchPage. The box selector comes from the live page.
 */
export async function typeSearch(query: string, searchMs: number, changeMs: number): Promise<TypedSearch> {
  const isBlocked = () => /just a moment|attention required|challenge/i.test(document.title);
  const list = () => Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="~"]'), (a) => a.href).join('\n');
  const pause = () => new Promise((resolve) => setTimeout(resolve, 250));
  if (isBlocked()) return { searched: false, blocked: true };
  const box =
    document.querySelector<HTMLInputElement>('[data-test~="SearchForm"] input[type="search"]') ??
    document.querySelector<HTMLInputElement>('input.air3-typeahead-input-main[type="search"]');
  if (!box) return { searched: false, blocked: false };

  const before = list();
  box.focus();
  // The page's own code listens for input events; set the value the way typing does.
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setValue) setValue.call(box, query);
  else box.value = query;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  for (const type of ['keydown', 'keypress', 'keyup']) {
    box.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
  }

  const started = Date.now();
  while (new URL(location.href).searchParams.get('q') !== query) {
    if (Date.now() - started >= searchMs) return { searched: false, blocked: isBlocked() };
    await pause();
  }
  const changed = Date.now();
  while (list() === before && Date.now() - changed < changeMs) await pause();
  return { searched: true, blocked: isBlocked() };
}

/** Checks the value the injected function returned; anything else counts as an unreadable page. */
export function toPageScan(value: unknown): PageScan | null {
  const v = value as Partial<PageScan> | null | undefined;
  if (!v || !Array.isArray(v.links)) return null;
  return { links: v.links.filter((l): l is string => typeof l === 'string'), blocked: v.blocked === true };
}

/** Same check for typeSearch's answer. */
export function toTypedSearch(value: unknown): TypedSearch | null {
  const v = value as Partial<TypedSearch> | null | undefined;
  if (!v || typeof v.searched !== 'boolean') return null;
  return { searched: v.searched, blocked: v.blocked === true };
}
