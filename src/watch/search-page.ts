// D-31: the Upwork job-search page the watcher refreshes. PROVISIONAL: the path and the search-box
// selector (page-scan.ts) are taken from the live search page; update them if Upwork changes them.

import { jobUrl, parseJobId } from '../links/parse';
import type { QueueItem } from '../runner/runner';

/** chrome.tabs.query pattern for open search tabs. */
export const SEARCH_PAGE_PATTERN = 'https://www.upwork.com/nx/search/jobs*';

/** The typed search grows by one "/" per round; at this length the page is reloaded with "/". */
export const MAX_SEARCH_LENGTH = 50;

const SEARCH_PATH = /^\/nx\/search\/jobs\/?$/;

/** True for the job-search results page, not for a job opened from it (/nx/search/jobs/details/~…). */
export function isSearchPageUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'www.upwork.com' && SEARCH_PATH.test(u.pathname);
  } catch {
    return false;
  }
}

export interface NextSearch {
  /** The text to search for. */
  query: string;
  /** Load the page with this search instead of typing it. */
  reload: boolean;
}

/**
 * Upwork re-runs the search only when the text changes, so each round types one more "/" than the
 * search on the page. Once that reaches MAX_SEARCH_LENGTH the page is reloaded with "/" instead,
 * which also clears anything Upwork cached for earlier searches.
 */
export function nextSearch(currentUrl: string): NextSearch {
  const current = new URL(currentUrl).searchParams.get('q') ?? '';
  if (!/^\/+$/.test(current)) return { query: '/', reload: false };
  if (current.length >= MAX_SEARCH_LENGTH) return { query: '/', reload: true };
  return { query: `${current}/`, reload: false };
}

/** The tab's own search with `query` and page 1. Every filter and the sort order stay as set. */
export function searchUrl(current: string, query: string): string {
  const u = new URL(current);
  u.searchParams.set('q', query);
  u.searchParams.delete('page');
  return u.href;
}

/** Links read from the page -> unique jobs in page order (newest first). Other links are ignored. */
export function jobsFromLinks(links: readonly string[]): QueueItem[] {
  const jobs: QueueItem[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    const jobId = parseJobId(link);
    if (!jobId || seen.has(jobId)) continue;
    seen.add(jobId);
    jobs.push({ jobId, url: jobUrl(jobId) });
  }
  return jobs;
}
