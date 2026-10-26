// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Result } from '../core/types';
import { errorResult } from '../pipeline/analyse';
import { emptyState, type BatchRow } from '../runner/runner';
import type { CheckSummary } from '../store/checks';
import { initialWatchState } from '../watch/watcher';
import { evidence } from '../../test/builders';
import { App } from './App';
import { BatchTable } from './components/BatchTable';
import { CheckView } from './components/CheckView';
import { DatabaseView } from './components/DatabaseView';
import { HistoryView, SEARCH_DELAY_MS } from './components/HistoryView';
import { ResultCard } from './components/ResultCard';
import { WatchView } from './components/WatchView';
import { formatDuration } from './labels';

afterEach(cleanup);

const result = (over: Partial<Result> = {}): Result => ({
  ...errorResult('~01abc', 'https://www.upwork.com/jobs/~01abc', 'E-NOTFOUND', '', new Date('2026-10-21T09:30:00Z')),
  verdict: 'has_potential',
  error: null,
  jobTitle: 'Logo for a bakery',
  ...over,
});

describe('ResultCard (FR-25, FR-28)', () => {
  const card = result({
    evidence: [
      evidence({ id: 's1', source: 'S1', reasonId: 'R-S1', value: 'Crumb & Co.', confidence: 'high', location: 'buyer.info.company.name', snippet: 'Crumb & Co.' }),
      evidence({ id: 'w', source: 'S2-file', reasonId: 'R-S2-file', kind: 'website', value: 'crumb.example', confidence: 'low', baseConfidence: 'low' }),
    ],
    bestEvidenceId: 's1',
  });

  it('shows the verdict and why, the title, link, time and evidence by source', () => {
    render(<ResultCard result={card} />);
    expect(screen.getByText('Has potential')).toBeTruthy();
    expect(screen.getByText(/Why:/).textContent).toBe('Why: Crumb & Co. (company name, High confidence, from company-name field).');
    expect(screen.getByRole('heading', { name: 'Logo for a bakery' })).toBeTruthy();
    expect(screen.getByRole('link').getAttribute('href')).toBe('https://www.upwork.com/jobs/~01abc');
    expect(screen.getByText(/Checked/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'S1 · Company-name field' })).toBeTruthy();
    expect(screen.getByText('buyer.info.company.name')).toBeTruthy();
    expect(screen.getByText(/includes the client's company name/)).toBeTruthy();
    expect(screen.getByText('High confidence')).toBeTruthy();
  });

  it('keeps Low findings under "Weak signals"', () => {
    render(<ResultCard result={card} />);
    expect(screen.getByText(/Weak signals \(1\)/)).toBeTruthy();
  });

  it('says why a posting has no potential', () => {
    render(<ResultCard result={result({ verdict: 'no_potential' })} />);
    expect(screen.getByText('No potential')).toBeTruthy();
    expect(screen.getByText('No name, website or email was found at Medium or High confidence.')).toBeTruthy();
  });

  it('renders Upwork text as text, never as HTML (NFR-10)', () => {
    const hostile = result({ jobTitle: '<img src=x onerror=alert(1)>', evidence: [evidence({ id: 'h', value: '<b>Acme</b>', snippet: 'we are <b>Acme</b>' })] });
    const { container } = render(<ResultCard result={hostile} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByRole('heading', { name: '<img src=x onerror=alert(1)>' })).toBeTruthy();
  });

  it('shows errors', () => {
    render(<ResultCard result={errorResult('~01x', 'u', 'E-NOTFOUND', 'Job not found, or not visible to your account.', new Date())} />);
    expect(screen.getByRole('alert').textContent).toContain('E-NOTFOUND');
  });
});

describe('BatchTable (FR-29)', () => {
  const rows: BatchRow[] = [
    { jobId: '~01a', url: 'u', status: 'done', result: result({ jobTitle: 'Zebra job', verdict: 'has_potential' }), error: null },
    { jobId: '~01b', url: 'u', status: 'done', result: result({ jobTitle: 'Alpha job', verdict: 'no_potential' }), error: null },
    { jobId: '~01c', url: 'https://www.upwork.com/jobs/~01c', status: 'error', result: null, error: { code: 'E-NOTFOUND', message: 'x' } },
  ];

  it('sorts by a column and opens a row', () => {
    const onOpen = vi.fn();
    render(<BatchTable rows={rows} onOpen={onOpen} />);
    const titles = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0]!.textContent);
    expect(titles()).toEqual(['Zebra job', 'Alpha job', 'https://www.upwork.com/jobs/~01c']);
    fireEvent.click(screen.getByRole('button', { name: /Job title/ }));
    expect(titles()).toEqual(['Alpha job', 'Zebra job', 'https://www.upwork.com/jobs/~01c']);
    fireEvent.click(screen.getByRole('button', { name: /Verdict/ }));
    fireEvent.click(screen.getByRole('button', { name: /Verdict/ }));
    expect(titles()[0]).toBe('Alpha job');
    expect(screen.getAllByRole('columnheader')[1]?.getAttribute('aria-sort')).toBe('descending');
    fireEvent.click(screen.getByRole('button', { name: 'Alpha job' }));
    expect(onOpen).toHaveBeenCalledWith(rows[1]);
  });
});

describe('CheckView (FR-29, FR-30)', () => {
  it('shows the progress of a round with the current job and time left', () => {
    const batch = { ...emptyState(), phase: 'running' as const, total: 5, completed: 2, currentUrl: 'https://www.upwork.com/jobs/~01c', secondsLeft: 125 };
    render(<CheckView watch={{ ...initialWatchState(), phase: 'checking', batch }} onOpenRow={vi.fn()} />);
    expect(screen.getByText('Job 3 of 5')).toBeTruthy();
    expect(screen.getByText(/Checking https:\/\/www.upwork.com\/jobs\/~01c/)).toBeTruthy();
    expect(screen.getByText('About 2 min 5 s left')).toBeTruthy();
  });

  it('shows an E-RATE pause, and no progress between rounds', () => {
    const paused = { ...emptyState(), phase: 'paused' as const, total: 2, stopReason: { code: 'E-RATE' as const, message: 'Upwork is limiting requests. Paused for 1 minutes.' } };
    render(<CheckView watch={{ ...initialWatchState(), phase: 'checking', batch: paused }} onOpenRow={vi.fn()} />);
    expect(screen.getByText(/Paused for 1 minutes/)).toBeTruthy();
    cleanup();
    render(<CheckView watch={{ ...initialWatchState(), phase: 'waiting', batch: paused }} onOpenRow={vi.fn()} />);
    expect(screen.queryByText(/Paused/)).toBeNull();
  });

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('less than a second');
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(120)).toBe('2 min');
  });
});

describe('WatchView (D-31)', () => {
  const props = { intervalSeconds: 60, onRun: vi.fn(), onAuto: vi.fn(), onStop: vi.fn() };

  it('offers Run for one refresh and an Auto-refresh switch', () => {
    const onRun = vi.fn();
    const onAuto = vi.fn();
    render(<WatchView {...props} watch={initialWatchState()} onRun={onRun} onAuto={onAuto} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(onRun).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Auto-refresh every 1 min'));
    expect(onAuto).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('button', { name: 'Stop watching' })).toBeNull();
  });

  it('shows the last search and the next refresh while auto-refresh waits', () => {
    const onStop = vi.fn();
    const watch = { ...initialWatchState(), phase: 'waiting' as const, auto: true, onPage: 10, fresh: 3, checked: 13, lastSearch: { query: '///', reloaded: false }, nextRoundAt: Date.now() + 60_000 };
    render(<WatchView {...props} watch={watch} onStop={onStop} />);
    expect(screen.getByRole('status').textContent).toMatch(/10 jobs on the page, 3 new \(searched "\/\/\/"\)\. Next refresh at .+ 13 jobs checked since the panel opened\./);
    expect((screen.getByLabelText(/Auto-refresh/) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Stop watching' }));
    expect(onStop).toHaveBeenCalled();
  });

  it('disables Run during a round, and says when the page had to be reloaded', () => {
    render(<WatchView {...props} watch={{ ...initialWatchState(), phase: 'checking', fresh: 2 }} />);
    expect((screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Checking 2 new jobs…');
    cleanup();
    render(<WatchView {...props} watch={{ ...initialWatchState(), lastRoundAt: Date.now(), onPage: 1, lastSearch: { query: '//', reloaded: true } }} />);
    expect(screen.getByRole('status').textContent).toMatch(/Last refresh at .+: 1 job on the page, 0 new \(searched "\/\/", page reloaded\)\./);
  });

  it('shows why watching stopped', () => {
    const watch = { ...initialWatchState(), stopReason: { code: 'E-SCOPE' as const, message: 'Upwork refused this request.' } };
    render(<WatchView {...props} watch={watch} />);
    expect(screen.getByRole('alert').textContent).toBe('Upwork refused this request.');
  });
});

describe('App (FR-27)', () => {
  it('has Check, History and Settings tabs, usable by keyboard', async () => {
    render(<App />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Check', 'History', 'Settings']);
    expect(screen.getByRole('button', { name: 'Run' })).toBeTruthy();
    expect(screen.queryByLabelText(/Upwork job links/)).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(await screen.findByText(/0 results shown/)).toBeTruthy();

    fireEvent.keyDown(screen.getByRole('tab', { name: 'History' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Settings' }).getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByLabelText(/Delay between jobs/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete all data' })).toBeTruthy();
    expect(screen.getByText(/results database is not set up/)).toBeTruthy();
    expect(await screen.findByText('No Upwork token set. Paste one below.')).toBeTruthy();
  });

  it('starts no check until the results database is set up (D-32)', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(await screen.findByText('Set up the results database first (see Settings).')).toBeTruthy();
  });
});

describe('DatabaseView (D-32)', () => {
  it('signs in with email and password, and shows the account once signed in', async () => {
    const onSignIn = vi.fn(async () => 'Invalid login credentials');
    render(<DatabaseView configured account={null} onSignIn={onSignIn} onSignOut={vi.fn()} />);
    fireEvent.input(screen.getByLabelText('Email'), { target: { value: 'me@example.com' } });
    fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'secret' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }).closest('form')!);
    expect(onSignIn).toHaveBeenCalledWith('me@example.com', 'secret');
    expect((await screen.findByRole('alert')).textContent).toBe('Invalid login credentials');
    cleanup();
    const onSignOut = vi.fn();
    render(<DatabaseView configured account={{ userId: 'u', email: 'me@example.com' }} onSignIn={onSignIn} onSignOut={onSignOut} />);
    expect(screen.getByText(/Signed in as me@example.com/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalled();
  });
});

describe('HistoryView (FR-32, FR-33)', () => {
  const rows: CheckSummary[] = [
    { jobId: '~01a', jobTitle: 'Logo design', verdict: 'has_potential', checkedAt: '2026-10-25T09:00:00Z', bestValue: 'Crumb & Co.' },
    { jobId: '~01b', jobTitle: 'SEO audit', verdict: 'no_potential', checkedAt: '2026-10-24T09:00:00Z', bestValue: null },
  ];

  it('searches the database after typing stops, opens, selects, exports, deletes and loads more', () => {
    vi.useFakeTimers();
    const handlers = { onSearch: vi.fn(), onMore: vi.fn(), onOpen: vi.fn(), onDelete: vi.fn(), onExport: vi.fn() };
    render(<HistoryView rows={rows} more loading={false} {...handlers} />);
    expect(screen.getByText('2 results shown, more below.')).toBeTruthy();
    expect(screen.getByText('Has potential')).toBeTruthy();
    fireEvent.input(screen.getByLabelText(/Search/), { target: { value: 'seo' } });
    expect(handlers.onSearch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SEARCH_DELAY_MS);
    expect(handlers.onSearch).toHaveBeenCalledWith('seo');
    vi.useRealTimers();

    fireEvent.click(screen.getByRole('button', { name: 'Export all (not only the search) as JSON' }));
    expect(handlers.onExport).toHaveBeenCalledWith('all', 'json');
    fireEvent.click(screen.getByLabelText('Select SEO audit'));
    fireEvent.click(screen.getByRole('button', { name: 'Export 1 selected as CSV' }));
    expect(handlers.onExport).toHaveBeenCalledWith(['~01b'], 'csv');
    fireEvent.click(screen.getByRole('button', { name: 'SEO audit' }));
    expect(handlers.onOpen).toHaveBeenCalledWith('~01b');
    fireEvent.click(screen.getByRole('button', { name: 'Delete SEO audit' }));
    expect(handlers.onDelete).toHaveBeenCalledWith(rows[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(handlers.onMore).toHaveBeenCalled();
  });
});
