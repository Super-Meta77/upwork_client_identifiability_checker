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
import { EvalView } from './components/EvalView';
import { HistoryView, SEARCH_DELAY_MS } from './components/HistoryView';
import { ResultCard } from './components/ResultCard';
import { WatchView } from './components/WatchView';
import { formatDuration } from './labels';

afterEach(cleanup);

const result = (over: Partial<Result> = {}): Result => ({
  ...errorResult('~01abc', 'https://www.upwork.com/jobs/~01abc', 'E-NOTFOUND', '', new Date('2026-10-21T09:30:00Z')),
  verdict: 'identified',
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
    distinctiveness: { score: 35, attributes: ['city'], details: [{ attribute: 'city', value: 'Bristol', points: 25 }] },
  });

  it('shows the verdict as text, the title, link, time and evidence by source', () => {
    render(<ResultCard result={card} peers={null} />);
    expect(screen.getByText('Identified before contact')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Logo for a bakery' })).toBeTruthy();
    expect(screen.getByRole('link').getAttribute('href')).toBe('https://www.upwork.com/jobs/~01abc');
    expect(screen.getByText(/Checked/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'S1 · Company-name field' })).toBeTruthy();
    expect(screen.getByText('buyer.info.company.name')).toBeTruthy();
    expect(screen.getByText(/includes the client's company name/)).toBeTruthy();
    expect(screen.getByText('High confidence')).toBeTruthy();
  });

  it('keeps Low findings under "Weak signals" and labels S3 as an estimate', () => {
    render(<ResultCard result={card} peers={null} />);
    expect(screen.getByText(/Weak signals \(1\)/)).toBeTruthy();
    expect(screen.getByText(/an estimate, not a measurement/)).toBeTruthy();
    expect(screen.getByText(/City: Bristol/)).toBeTruthy();
  });

  it('renders Upwork text as text, never as HTML (NFR-10)', () => {
    const hostile = result({ jobTitle: '<img src=x onerror=alert(1)>', evidence: [evidence({ id: 'h', value: '<b>Acme</b>', snippet: 'we are <b>Acme</b>' })] });
    const { container } = render(<ResultCard result={hostile} peers={null} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByRole('heading', { name: '<img src=x onerror=alert(1)>' })).toBeTruthy();
  });

  it('saves a known client name with its matching evidence (FR-35)', () => {
    const onSave = vi.fn();
    render(<ResultCard result={card} peers={null} onGroundTruth={onSave} />);
    fireEvent.input(screen.getByLabelText('Company name'), { target: { value: 'Crumb and Co' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save known name' }).closest('form')!);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ companyName: 'Crumb and Co', matchedEvidenceIds: ['s1'] }));
  });

  it('shows errors', () => {
    render(<ResultCard result={errorResult('~01x', 'u', 'E-NOTFOUND', 'Job not found, or not visible to your account.', new Date())} peers={null} />);
    expect(screen.getByRole('alert').textContent).toContain('E-NOTFOUND');
  });
});

describe('BatchTable (FR-29)', () => {
  const rows: BatchRow[] = [
    { key: 'a', input: 'a', jobId: '~01a', url: 'u', status: 'done', result: result({ jobTitle: 'Zebra job', verdict: 'partial', distinctiveness: { score: 10, attributes: [], details: [] } }), error: null },
    { key: 'b', input: 'b', jobId: '~01b', url: 'u', status: 'done', result: result({ jobTitle: 'Alpha job', verdict: 'narrowable', distinctiveness: { score: 80, attributes: [], details: [] } }), error: null },
    { key: 'c', input: 'not a link', jobId: null, url: null, status: 'error', result: null, error: { code: 'E-LINK', message: 'x' } },
  ];

  it('sorts by a column and opens a row', () => {
    const onOpen = vi.fn();
    render(<BatchTable rows={rows} onOpen={onOpen} />);
    const titles = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0]!.textContent);
    expect(titles()).toEqual(['Zebra job', 'Alpha job', 'not a link']);
    fireEvent.click(screen.getByRole('button', { name: /Job title/ }));
    expect(titles()).toEqual(['Alpha job', 'not a link', 'Zebra job']);
    fireEvent.click(screen.getByRole('button', { name: /S3/ }));
    fireEvent.click(screen.getByRole('button', { name: /S3/ }));
    expect(titles()[0]).toBe('Alpha job');
    expect(screen.getAllByRole('columnheader')[4]?.getAttribute('aria-sort')).toBe('descending');
    fireEvent.click(screen.getByRole('button', { name: 'Alpha job' }));
    expect(onOpen).toHaveBeenCalledWith(rows[1]);
  });
});

describe('CheckView (FR-01, FR-27, FR-30)', () => {
  const props = { state: emptyState(), running: false, resumable: null, parseNote: null, onStop: vi.fn(), onResume: vi.fn(), onDiscard: vi.fn(), onOpenRow: vi.fn() };

  it('runs a single link on Enter and a batch on Ctrl+Enter', () => {
    const onCheck = vi.fn();
    render(<CheckView {...props} onCheck={onCheck} />);
    const box = screen.getByLabelText(/Upwork job links/);
    fireEvent.input(box, { target: { value: 'https://www.upwork.com/jobs/~01abcdefgh12' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onCheck).toHaveBeenCalledTimes(1);
    fireEvent.input(box, { target: { value: 'a\nb' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onCheck).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    expect(onCheck).toHaveBeenCalledTimes(2);
  });

  it('shows progress with the current link and time left, and a Stop button', () => {
    const onStop = vi.fn();
    const state = { ...emptyState(), phase: 'running' as const, total: 5, completed: 2, currentUrl: 'https://www.upwork.com/jobs/~01c', secondsLeft: 125 };
    render(<CheckView {...props} state={state} running onStop={onStop} onCheck={vi.fn()} />);
    expect(screen.getByText('Job 3 of 5')).toBeTruthy();
    expect(screen.getByText(/Checking https:\/\/www.upwork.com\/jobs\/~01c/)).toBeTruthy();
    expect(screen.getByText('About 2 min 5 s left')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers Resume for an unfinished batch (NFR-06)', () => {
    const onResume = vi.fn();
    const resumable = { id: 'q', createdAt: '', items: [{ jobId: 'a', url: 'a' }, { jobId: 'b', url: 'b' }, { jobId: 'c', url: 'c' }], nextIndex: 1 };
    render(<CheckView {...props} resumable={resumable} onResume={onResume} onCheck={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume from link 2' }));
    expect(onResume).toHaveBeenCalled();
  });

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('less than a second');
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(120)).toBe('2 min');
  });
});

describe('ResultCard peer counts (FR-22)', () => {
  it('shows how many saved clients share each detail', () => {
    const card = result({ distinctiveness: { score: 25, attributes: ['city'], details: [] }, profile: { companyId: 'c', country: 'Norway', city: 'Oslo', industry: null, size: null, memberSinceYear: null } });
    render(<ResultCard result={card} peers={{ country: 2, city: 1, industry: null, size: null, memberSinceYear: null }} />);
    expect(screen.getByText(/2 other clients share this country; 1 other client share this city/)).toBeTruthy();
  });
});

describe('WatchView (D-31)', () => {
  const props = { busy: false, intervalSeconds: 60, onRun: vi.fn(), onAuto: vi.fn(), onStop: vi.fn() };

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

  it('shows why watching stopped, and disables the controls while a batch runs', () => {
    const watch = { ...initialWatchState(), stopReason: { code: 'E-SCOPE' as const, message: 'Upwork refused this request.' } };
    render(<WatchView {...props} busy watch={watch} />);
    expect(screen.getByRole('alert').textContent).toBe('Upwork refused this request.');
    expect((screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText(/Auto-refresh/) as HTMLInputElement).disabled).toBe(true);
  });
});

describe('App (FR-27)', () => {
  it('has Check, History, Accuracy and Settings tabs, usable by keyboard', async () => {
    render(<App />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Check', 'History', 'Accuracy', 'Settings']);
    expect(screen.getByRole('button', { name: 'Check' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Run' })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(await screen.findByText(/0 results shown/)).toBeTruthy();

    fireEvent.keyDown(screen.getByRole('tab', { name: 'History' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Accuracy' }).getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(await screen.findByLabelText(/Delay between jobs/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete all data' })).toBeTruthy();
    expect(screen.getByText(/results database is not set up/)).toBeTruthy();
  });

  it('starts no check until the results database is set up (D-32)', async () => {
    render(<App />);
    fireEvent.input(screen.getByLabelText(/Upwork job links/), { target: { value: 'https://www.upwork.com/jobs/~01abcdefgh12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
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

describe('HistoryView and EvalView (FR-32, FR-33, FR-36)', () => {
  const rows: CheckSummary[] = [
    { jobId: '~01a', jobTitle: 'Logo design', verdict: 'partial', checkedAt: '2026-10-25T09:00:00Z', bestValue: 'Crumb & Co.', s3Score: 10 },
    { jobId: '~01b', jobTitle: 'SEO audit', verdict: 'narrowable', checkedAt: '2026-10-24T09:00:00Z', bestValue: null, s3Score: 80 },
  ];

  it('searches the database after typing stops, opens, selects, exports, deletes and loads more', () => {
    vi.useFakeTimers();
    const handlers = { onSearch: vi.fn(), onMore: vi.fn(), onOpen: vi.fn(), onDelete: vi.fn(), onExport: vi.fn() };
    render(<HistoryView rows={rows} more loading={false} {...handlers} />);
    expect(screen.getByText('2 results shown, more below.')).toBeTruthy();
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

  it('shows the evaluation report with counts', () => {
    const withTruth = [result({ groundTruth: { companyName: 'Acme', matchedEvidenceIds: [] }, evidence: [evidence({ source: 'S1', value: 'Acme', confidence: 'high' })] })];
    render(<EvalView saved={withTruth} onExport={vi.fn()} />);
    expect(screen.getByText(/the v1 evaluation needs at least 20/)).toBeTruthy();
    const s1 = screen.getByRole('rowheader', { name: 'S1 · Company-name field' }).closest('tr')!;
    expect(s1.textContent).toContain('100%');
    expect(s1.textContent).toContain('(1/1 jobs)');
  });
});
