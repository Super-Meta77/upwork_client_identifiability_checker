// Batch orchestration in the side panel (D-01). One job at a time, a delay between jobs, a Stop
// button, the fixed batch behaviour per error code (spec "Error handling") and Resume (NFR-06).

import { CheckerError, errorMessage, STOPPING_CODES } from '../core/errors';
import type { ErrorCode, Result } from '../core/types';
import type { LinkError } from '../links/parse';
import type { QueueItem, SavedQueue } from '../store/local-state';

export const MIN_DELAY_MS = 3000;
/** E-RATE: pause 1, 2, 5, then 10 minutes; if Upwork still limits after that, stop. */
export const BACKOFF_MINUTES: readonly number[] = [1, 2, 5, 10];
/** E-NETWORK: retry once after 10 s. */
export const NETWORK_RETRY_MS = 10_000;
/** E-RATE also covers three server errors in a row. */
export const SERVER_ERRORS_FOR_RATE = 3;

export type RowStatus = 'queued' | 'running' | 'done' | 'error' | 'earlier';

export interface BatchRow {
  key: string;
  input: string;
  jobId: string | null;
  url: string | null;
  status: RowStatus;
  result: Result | null;
  error: { code: ErrorCode; message: string } | null;
}

export type RunnerPhase = 'idle' | 'running' | 'waiting' | 'paused' | 'stopped' | 'done';

export interface RunnerState {
  phase: RunnerPhase;
  rows: BatchRow[];
  /** Jobs in this batch (valid links only). */
  total: number;
  /** Jobs finished, with a result or an error. */
  completed: number;
  currentUrl: string | null;
  /** E-RATE pause end, epoch ms. */
  pausedUntil: number | null;
  stopReason: { code: ErrorCode; message: string } | null;
  /** FR-30: estimate based on the delay and the average job time. */
  secondsLeft: number;
  /** E-STORAGE: results are still shown but no longer saved. */
  savingDisabled: boolean;
}

export interface RunnerDeps {
  /** `signal` is aborted by Stop: the check then starts no new request (FR-13). */
  check(item: QueueItem, signal: AbortSignal): Promise<Result>;
  save(result: Result): Promise<void>;
  errorResult(item: QueueItem, code: ErrorCode, message: string): Result;
  saveQueue(queue: SavedQueue): Promise<void>;
  clearQueue(): Promise<void>;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  now(): number;
  delayMs: number;
  onChange(state: RunnerState): void;
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

type Outcome =
  | { kind: 'result'; result: Result }
  | { kind: 'error'; code: ErrorCode; message: string }
  | { kind: 'stop'; code: ErrorCode; message: string }
  | { kind: 'aborted' };

export function emptyState(): RunnerState {
  return { phase: 'idle', rows: [], total: 0, completed: 0, currentUrl: null, pausedUntil: null, stopReason: null, secondsLeft: 0, savingDisabled: false };
}

export class BatchRunner {
  private state: RunnerState = emptyState();
  private controller: AbortController | null = null;
  private serverErrorsInARow = 0;
  private backoffStep = 0;
  private jobTimes: number[] = [];

  constructor(private readonly deps: RunnerDeps) {}

  getState(): RunnerState {
    return this.state;
  }

  isActive(): boolean {
    return this.controller !== null;
  }

  /** FR-13: Stop. A request already in flight finishes; nothing new starts. */
  stop(): void {
    this.controller?.abort();
  }

  async run(queue: SavedQueue, linkErrors: readonly LinkError[] = []): Promise<RunnerState> {
    if (this.controller) throw new Error('a batch is already running');
    const controller = new AbortController();
    this.controller = controller;
    this.serverErrorsInARow = 0;
    this.backoffStep = 0;

    const delayMs = Math.max(MIN_DELAY_MS, this.deps.delayMs);
    const rows: BatchRow[] = [
      ...linkErrors.map((e): BatchRow => ({ key: `line-${e.line}`, input: e.input, jobId: null, url: null, status: 'error', result: null, error: { code: e.code, message: e.message } })),
      ...queue.items.map((item, i): BatchRow => ({ key: item.jobId, input: item.url, jobId: item.jobId, url: item.url, status: i < queue.nextIndex ? 'earlier' : 'queued', result: null, error: null })),
    ];
    const rowFor = (i: number) => rows[linkErrors.length + i]!;
    this.update({ ...emptyState(), phase: 'running', rows, total: queue.items.length, completed: queue.nextIndex });

    try {
      await this.deps.saveQueue(queue);
      for (let i = queue.nextIndex; i < queue.items.length; i += 1) {
        if (controller.signal.aborted) break;
        if (i > queue.nextIndex) {
          this.update({ phase: 'waiting', currentUrl: null });
          await this.deps.sleep(delayMs, controller.signal);
          if (controller.signal.aborted) break;
        }

        const item = queue.items[i]!;
        const row = rowFor(i);
        row.status = 'running';
        this.update({ phase: 'running', currentUrl: item.url, rows: [...rows] });

        const started = this.deps.now();
        const outcome = await this.attempt(item, controller.signal);
        this.jobTimes.push(this.deps.now() - started);

        if (outcome.kind === 'aborted') {
          row.status = 'queued';
          break;
        }
        if (outcome.kind === 'stop') {
          row.status = 'error';
          row.error = { code: outcome.code, message: outcome.message };
          this.update({ phase: 'stopped', stopReason: { code: outcome.code, message: outcome.message }, rows: [...rows], currentUrl: null, pausedUntil: null });
          // The failed job stays next in the queue so Retry / Resume starts from it.
          await this.deps.saveQueue({ ...queue, nextIndex: i });
          return this.state;
        }

        const result = outcome.kind === 'result' ? outcome.result : this.deps.errorResult(item, outcome.code, outcome.message);
        row.status = outcome.kind === 'result' ? 'done' : 'error';
        row.result = result;
        row.error = outcome.kind === 'error' ? { code: outcome.code, message: outcome.message } : null;
        await this.persist(result);
        await this.deps.saveQueue({ ...queue, nextIndex: i + 1 });
        this.update({ completed: this.state.completed + 1, rows: [...rows], pausedUntil: null });
      }

      if (controller.signal.aborted) {
        this.update({ phase: 'stopped', currentUrl: null, pausedUntil: null, stopReason: null, rows: [...rows] });
      } else {
        await this.deps.clearQueue();
        this.update({ phase: 'done', currentUrl: null, pausedUntil: null });
      }
      return this.state;
    } finally {
      this.controller = null;
    }
  }

  private async attempt(item: QueueItem, signal: AbortSignal): Promise<Outcome> {
    let networkRetried = false;
    for (;;) {
      let error: CheckerError;
      try {
        const result = await this.deps.check(item, signal);
        this.serverErrorsInARow = 0;
        this.backoffStep = 0;
        return { kind: 'result', result };
      } catch (e) {
        // Stop during a job: it ends without another request and stays queued for Resume.
        if (signal.aborted) return { kind: 'aborted' };
        error = e instanceof CheckerError ? e : new CheckerError('E-NETWORK', 'unexpected');
      }

      let code = error.code;
      if (error.serverError) {
        this.serverErrorsInARow += 1;
        if (this.serverErrorsInARow >= SERVER_ERRORS_FOR_RATE) code = 'E-RATE';
      } else {
        this.serverErrorsInARow = 0;
      }

      if (code === 'E-RATE') {
        const minutes = BACKOFF_MINUTES[this.backoffStep];
        if (minutes === undefined) return { kind: 'stop', code, message: 'Upwork is still limiting requests. The batch stopped; try again later.' };
        this.backoffStep += 1;
        this.update({ phase: 'paused', pausedUntil: this.deps.now() + minutes * 60_000, stopReason: { code, message: errorMessage('E-RATE', String(minutes)) } });
        await this.deps.sleep(minutes * 60_000, signal);
        if (signal.aborted) return { kind: 'aborted' };
        this.serverErrorsInARow = 0;
        this.update({ phase: 'running', pausedUntil: null, stopReason: null });
        continue;
      }
      if (code === 'E-NETWORK') {
        if (networkRetried) return { kind: 'error', code, message: errorMessage(code) };
        networkRetried = true;
        await this.deps.sleep(NETWORK_RETRY_MS, signal);
        if (signal.aborted) return { kind: 'aborted' };
        continue;
      }
      if (STOPPING_CODES.has(code)) return { kind: 'stop', code, message: error.message };
      return { kind: 'error', code, message: error.message };
    }
  }

  private async persist(result: Result): Promise<void> {
    if (this.state.savingDisabled) return;
    try {
      await this.deps.save(result);
    } catch (e) {
      if (e instanceof CheckerError && e.code === 'E-STORAGE') this.update({ savingDisabled: true });
      else throw e;
    }
  }

  private update(patch: Partial<RunnerState>): void {
    const next = { ...this.state, ...patch };
    const remaining = Math.max(0, next.total - next.completed);
    const avg = this.jobTimes.length ? this.jobTimes.reduce((a, b) => a + b, 0) / this.jobTimes.length : 1500;
    const delay = Math.max(MIN_DELAY_MS, this.deps.delayMs);
    next.secondsLeft = remaining ? Math.round((remaining * avg + Math.max(0, remaining - 1) * delay) / 1000) : 0;
    this.state = next;
    this.deps.onChange(next);
  }
}

/** D-25: only one runner across all side-panel windows. Returns false when another window holds it. */
export async function withRunnerLock(work: () => Promise<void>): Promise<boolean> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (!locks) {
    await work();
    return true;
  }
  return locks.request('upwork-checker-batch', { ifAvailable: true }, async (lock) => {
    if (!lock) return false;
    await work();
    return true;
  });
}
