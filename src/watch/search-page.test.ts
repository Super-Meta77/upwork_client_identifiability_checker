import { describe, expect, it } from 'vitest';
import { isSearchPageUrl, jobsFromLinks, MAX_SEARCH_LENGTH, nextSearch, searchUrl } from './search-page';

const SEARCH = 'https://www.upwork.com/nx/search/jobs/';

describe('search page URLs (D-31)', () => {
  it('recognises the job-search results page only', () => {
    expect(isSearchPageUrl('https://www.upwork.com/nx/search/jobs/?q=%2F&sort=recency')).toBe(true);
    expect(isSearchPageUrl('https://www.upwork.com/nx/search/jobs?q=react')).toBe(true);
    expect(isSearchPageUrl('https://www.upwork.com/nx/search/jobs/details/~021234567890abcdef')).toBe(false);
    expect(isSearchPageUrl('https://www.upwork.com/nx/find-work/')).toBe(false);
    expect(isSearchPageUrl('http://www.upwork.com/nx/search/jobs/')).toBe(false);
    expect(isSearchPageUrl('https://evil.example/nx/search/jobs/')).toBe(false);
    expect(isSearchPageUrl('not a url')).toBe(false);
    expect(isSearchPageUrl(undefined)).toBe(false);
  });

  it('types one more "/" each round, so the search always changes', () => {
    expect(nextSearch(`${SEARCH}?q=%2F`)).toEqual({ query: '//', reload: false });
    expect(nextSearch(`${SEARCH}?q=%2F%2F%2F&sort=recency`)).toEqual({ query: '////', reload: false });
  });

  it('starts from "/" when the page has another search or none', () => {
    expect(nextSearch(`${SEARCH}?q=react`)).toEqual({ query: '/', reload: false });
    expect(nextSearch(`${SEARCH}?q=%2F%2F%5C%5C%2F%2F`)).toEqual({ query: '/', reload: false });
    expect(nextSearch(SEARCH)).toEqual({ query: '/', reload: false });
  });

  it('reloads the page with "/" once the search is long', () => {
    expect(nextSearch(`${SEARCH}?q=${encodeURIComponent('/'.repeat(MAX_SEARCH_LENGTH - 1))}`)).toEqual({ query: '/'.repeat(MAX_SEARCH_LENGTH), reload: false });
    expect(nextSearch(`${SEARCH}?q=${encodeURIComponent('/'.repeat(MAX_SEARCH_LENGTH))}`)).toEqual({ query: '/', reload: true });
  });

  it('loads a search on page 1, keeping the sort order and every filter', () => {
    const params = new URL(searchUrl(`${SEARCH}?q=react&page=3&per_page=50&sort=recency&t=1`, '/')).searchParams;
    expect(params.get('q')).toBe('/');
    expect(params.get('page')).toBeNull();
    expect([params.get('per_page'), params.get('sort'), params.get('t')]).toEqual(['50', 'recency', '1']);
  });

  it('turns page links into unique jobs in page order', () => {
    const links = [
      'https://www.upwork.com/jobs/Greece-Nova-Check_~02198100000000000001/?referrer_url_path=%2Fnx%2Fsearch%2Fjobs%2F',
      'https://www.upwork.com/freelancers/~01aaaaaaaaaaaaaaaa',
      'https://www.upwork.com/jobs/Shopify-Expert_~02198100000000000002/',
      'https://www.upwork.com/jobs/Greece-Nova-Check_~02198100000000000001/',
      'https://www.upwork.com/nx/search/jobs/details/~02198100000000000003',
    ];
    expect(jobsFromLinks(links)).toEqual([
      { jobId: '~02198100000000000001', url: 'https://www.upwork.com/jobs/~02198100000000000001' },
      { jobId: '~02198100000000000002', url: 'https://www.upwork.com/jobs/~02198100000000000002' },
      { jobId: '~02198100000000000003', url: 'https://www.upwork.com/jobs/~02198100000000000003' },
    ]);
  });
});
