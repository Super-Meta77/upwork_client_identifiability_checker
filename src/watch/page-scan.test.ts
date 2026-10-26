// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSearchPage, toPageScan, toTypedSearch, typeSearch } from './page-scan';

const JOB_A = 'https://www.upwork.com/jobs/Job-A_~02198100000000000001/';
const JOB_B = 'https://www.upwork.com/jobs/Job-B_~02198100000000000002/';

function addLink(href: string, text = 'job') {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  document.body.append(a);
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-25T09:00:00Z') });
  document.title = 'Upwork';
  document.body.replaceChildren();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('reading the search page (D-31)', () => {
  it('returns the job links in page order once the list stops changing', async () => {
    addLink(JOB_A);
    addLink('https://www.upwork.com/nx/find-work/');
    addLink(JOB_B);
    const scan = readSearchPage(15_000, 1_000);
    await vi.advanceTimersByTimeAsync(1_250);
    expect(await scan).toEqual({ links: [JOB_A, JOB_B], blocked: false });
  });

  it('waits for jobs the page renders after loading', async () => {
    const scan = readSearchPage(15_000, 1_000);
    await vi.advanceTimersByTimeAsync(2_000);
    addLink(JOB_A);
    await vi.advanceTimersByTimeAsync(500);
    addLink(JOB_B);
    await vi.advanceTimersByTimeAsync(1_250);
    expect((await scan).links).toEqual([JOB_A, JOB_B]);
  });

  it('reports a Cloudflare check page', async () => {
    document.title = 'Just a moment...';
    expect(await readSearchPage(15_000, 1_000)).toEqual({ links: [], blocked: true });
  });

  it('gives up with no links after the timeout', async () => {
    const scan = readSearchPage(15_000, 1_000);
    await vi.advanceTimersByTimeAsync(15_250);
    expect(await scan).toEqual({ links: [], blocked: false });
  });

  it('still works when serialised the way chrome.scripting injects it', async () => {
    addLink(JOB_A);
    const injected = new Function(`return (${readSearchPage.toString()})`)() as typeof readSearchPage;
    const scan = injected(15_000, 1_000);
    await vi.advanceTimersByTimeAsync(1_250);
    expect((await scan).links).toEqual([JOB_A]);
  });

  it('accepts only a well-formed answer from the page', () => {
    expect(toPageScan({ links: [JOB_A, 3], blocked: false })).toEqual({ links: [JOB_A], blocked: false });
    expect(toPageScan({ links: [], blocked: true })).toEqual({ links: [], blocked: true });
    expect(toPageScan(null)).toBeNull();
    expect(toPageScan({ links: 'x' })).toBeNull();
    expect(toTypedSearch({ searched: true })).toEqual({ searched: true, blocked: false });
    expect(toTypedSearch({ searched: 'yes' })).toBeNull();
  });
});

describe('typing into the search box (D-31)', () => {
  /** The search box from the live page, and a stand-in for Upwork's code: Enter runs the search. */
  function searchPage({ runsSearch = true } = {}) {
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL('https://www.upwork.com/nx/search/jobs/?q=%2F');
    const form = document.createElement('div');
    form.setAttribute('data-test', 'SearchBar SearchForm');
    const box = document.createElement('input');
    box.type = 'search';
    box.className = 'air3-typeahead-input-main air3-input';
    box.id = 'typeahead-input-152';
    form.append(box);
    document.body.append(form);
    addLink(JOB_A);
    const typed: string[] = [];
    box.addEventListener('input', () => typed.push(box.value));
    box.addEventListener('keydown', (e) => {
      if (!runsSearch || (e as KeyboardEvent).key !== 'Enter') return;
      history.pushState(null, '', `?q=${encodeURIComponent(box.value)}`);
      setTimeout(() => addLink(JOB_B), 800);
    });
    return { box, typed };
  }

  it('types the search like a user, presses Enter and waits for the new list', async () => {
    const { box, typed } = searchPage();
    const result = typeSearch('//', 5_000, 5_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toEqual({ searched: true, blocked: false });
    expect(box.value).toBe('//');
    expect(typed).toEqual(['//']);
    expect(new URL(location.href).searchParams.get('q')).toBe('//');
    expect(document.querySelectorAll('a')).toHaveLength(2);
  });

  it('reports that typing did not start a search, so the round can reload the page', async () => {
    searchPage({ runsSearch: false });
    const result = typeSearch('//', 5_000, 5_000);
    await vi.advanceTimersByTimeAsync(5_250);
    expect(await result).toEqual({ searched: false, blocked: false });
  });

  it('reports a missing search box or a Cloudflare page', async () => {
    expect(await typeSearch('/', 5_000, 5_000)).toEqual({ searched: false, blocked: false });
    document.title = 'Just a moment...';
    expect(await typeSearch('/', 5_000, 5_000)).toEqual({ searched: false, blocked: true });
  });

  it('still works when serialised for injection', async () => {
    searchPage();
    const injected = new Function(`return (${typeSearch.toString()})`)() as typeof typeSearch;
    const result = injected('//', 5_000, 5_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await result).searched).toBe(true);
  });
});
