// D-31: watch an Upwork job-search tab. Each round makes the page search again (it types one more
// "/" into the search box, or reloads the page), reads the job links and checks every job not
// checked before with the batch runner, which handles pacing, errors and saving. Run does one round
// now; with auto-refresh on, rounds repeat every interval.
// It runs in the side panel and only while the user has asked for it (D-01, D-24).

import { errorMessage } from '../core/errors';
import type { ErrorCode } from '../core/types';
import { emptyState, type BatchRow, type QueueItem, type RunnerState } from '../runner/runner';
import { isSearchPageUrl, jobsFromLinks, nextSearch, searchUrl } from './search-page';
import { WatchError, type TabDriver } from './tabs';

/** Upwork restricts automated access; auto-refresh runs at most this often. */
export const MIN_WATCH_INTERVAL_MS = 30_000;

export type WatchPhase = 'idle' | 'refreshing' | 'checking' | 'waiting';

export interface WatchStop {
  code: ErrorCode | null;
  message: string;
}

export interface WatchState {
  phase: WatchPhase;
  /** Auto-refresh is on: rounds repeat every interval. */
  auto: boolean;
  /** Rounds since the panel opened. */
  rounds: number;
  /** Jobs on the page in the last round. */
  onPage: number;
  /** Jobs in the last round not checked before. */
  fresh: number;
  /** Jobs checked since the panel opened. */
  checked: number;
  /** The last round's search, and whether the page had to be reloaded for it. */
  lastSearch: { query: string; reloaded: boolean } | null;
  lastRoundAt: number | null;
  /** When the next round starts (epoch ms), while waiting. */
  nextRoundAt: number | null;
  /** Why the last run ended early; null when it ended normally or by Stop. */
  stopReason: WatchStop | null;
  /** The current round's batch. */
  batch: RunnerState;
  /** Rows of every round, newest round first. */
  rows: BatchRow[];
}

export interface WatchRunner {
  run(items: readonly QueueItem[]): Promise<RunnerState>;
  stop(): void;
}

/** What one run needs from the current settings. */
export interface WatchRun {
  createRunner(onChange: (state: RunnerState) => void): WatchRunner;
  dailyLimit: number;
  intervalMs: number;
}

export interface WatchDeps {
  tabs: TabDriver;
  /** The jobs among `jobIds` that already have a saved result. */
  checkedIds(jobIds: readonly string[]): Promise<ReadonlySet<string>>;
  dayCount(): Promise<number>;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  now(): number;
  onChange(state: WatchState): void;
}

const NO_TAB = 'Open the Upwork job search page (www.upwork.com/nx/search/jobs) in this window, then press Run.';
const MOVED = 'The search tab left the job search page, so watching stopped. Open the search page again, then press Run.';
const BLOCKED: WatchStop = { code: 'E-BLOCKED', message: errorMessage('E-BLOCKED') };
const limitReached = (limit: number) => `Today's limit of ${limit} jobs is reached, so watching stopped. You can raise it in Settings.`;

export function initialWatchState(): WatchState {
  return {
    phase: 'idle',
    auto: false,
    rounds: 0,
    onPage: 0,
    fresh: 0,
    checked: 0,
    lastSearch: null,
    lastRoundAt: null,
    nextRoundAt: null,
    stopReason: null,
    batch: emptyState(),
    rows: [],
  };
}

export class SearchWatcher {
  private state: WatchState = initialWatchState();
  private controller: AbortController | null = null;
  private runner: WatchRunner | null = null;
  private wake: (() => void) | null = null;
  private runRequested = false;
  /** Jobs met since the panel opened, checked or not; each is considered once. */
  private readonly seen = new Set<string>();
  private doneRows: BatchRow[] = [];

  constructor(private readonly deps: WatchDeps) {}

  getState(): WatchState {
    return this.state;
  }

  isActive(): boolean {
    return this.controller !== null;
  }

  /** Auto-refresh on or off. Off ends the run after the current round. */
  setAuto(on: boolean): void {
    this.update({ auto: on });
    if (!on) this.wake?.();
  }

  /** Run while auto-refresh waits: start the next round now. False when no run is waiting. */
  refreshNow(): boolean {
    if (this.state.phase !== 'waiting') return false;
    this.runRequested = true;
    this.wake?.();
    return true;
  }

  /** Ends the run after the request in flight, like the batch Stop (FR-13). */
  stop(): void {
    this.controller?.abort();
    this.runner?.stop();
  }

  /** One round, then another every interval while auto-refresh is on. */
  async run(config: WatchRun): Promise<WatchState> {
    if (this.controller) throw new Error('already watching');
    const controller = new AbortController();
    this.controller = controller;
    const { signal } = controller;
    this.runner = config.createRunner((batch) => this.update({ batch, rows: [...batch.rows, ...this.doneRows] }));
    this.update({ stopReason: null });

    try {
      const tab = await this.deps.tabs.find();
      if (!tab) return this.finish({ code: null, message: NO_TAB });
      for (;;) {
        const stop = await this.round(tab.id, config, signal);
        if (stop) return this.finish(stop);
        if (signal.aborted || !this.state.auto) break;
        if (!(await this.waitForNextRound(config.intervalMs, signal))) break;
      }
      return this.finish(null);
    } catch (error) {
      return this.finish({ code: null, message: error instanceof WatchError ? error.message : 'Watching stopped because the search page could not be read.' });
    } finally {
      this.controller = null;
      this.runner = null;
    }
  }

  /** Waits for the interval, or for Run. False when the run should end instead (Stop, auto off). */
  private async waitForNextRound(intervalMs: number, signal: AbortSignal): Promise<boolean> {
    const interval = Math.max(MIN_WATCH_INTERVAL_MS, intervalMs);
    const wait = new AbortController();
    const end = () => wait.abort();
    signal.addEventListener('abort', end, { once: true });
    this.wake = end;
    this.runRequested = false;
    this.update({ phase: 'waiting', nextRoundAt: this.deps.now() + interval });
    try {
      await this.deps.sleep(interval, wait.signal);
    } finally {
      signal.removeEventListener('abort', end);
      this.wake = null;
    }
    return !signal.aborted && (this.state.auto || this.runRequested);
  }

  /** Searches again, then checks the new jobs. Returns why watching must stop, or null to carry on. */
  private async round(tabId: number, config: WatchRun, signal: AbortSignal): Promise<WatchStop | null> {
    const { deps } = this;
    if ((await deps.dayCount()) >= config.dailyLimit) return { code: null, message: limitReached(config.dailyLimit) };
    const current = await deps.tabs.url(tabId);
    if (!isSearchPageUrl(current)) return { code: null, message: MOVED };

    const next = nextSearch(current);
    this.update({ phase: 'refreshing', rounds: this.state.rounds + 1, nextRoundAt: null });
    let reloaded = next.reload;
    if (!reloaded) {
      const typed = await deps.tabs.type(tabId, next.query);
      if (typed.blocked) return BLOCKED;
      // Typing did not start a search (no search box, or the page ignored it): load that search.
      reloaded = !typed.searched;
    }
    if (reloaded) {
      await deps.tabs.load(tabId, searchUrl(current, next.query), signal);
      if (signal.aborted) return null;
    }
    const page = await deps.tabs.scan(tabId);
    if (page.blocked) return BLOCKED;

    const jobs = jobsFromLinks(page.links);
    const unseen = jobs.filter((job) => !this.seen.has(job.jobId));
    const saved = await deps.checkedIds(unseen.map((job) => job.jobId));
    for (const job of unseen) this.seen.add(job.jobId);
    const fresh = unseen.filter((job) => !saved.has(job.jobId));
    this.update({ onPage: jobs.length, fresh: fresh.length, lastSearch: { query: next.query, reloaded }, lastRoundAt: deps.now() });

    // NFR-02: never go past the daily limit; the next round stops once it is reached.
    const left = config.dailyLimit - (await deps.dayCount());
    const items = fresh.slice(0, Math.max(0, left));
    if (!items.length || signal.aborted) return null;

    this.update({ phase: 'checking' });
    const final = await this.runner!.run(items);
    this.doneRows = [...final.rows, ...this.doneRows];
    this.update({ checked: this.state.checked + final.completed, rows: this.doneRows });
    // A stopping error (E-AUTH, E-SCOPE, E-BLOCKED, E-FORMAT, lasting E-RATE) ends watching too.
    return final.phase === 'stopped' && final.stopReason ? final.stopReason : null;
  }

  /** Every run ends with auto-refresh off, so the switch always shows what is happening. */
  private finish(stopReason: WatchStop | null): WatchState {
    this.update({ phase: 'idle', auto: false, stopReason, nextRoundAt: null });
    return this.state;
  }

  private update(patch: Partial<WatchState>): void {
    this.state = { ...this.state, ...patch };
    this.deps.onChange(this.state);
  }
}
