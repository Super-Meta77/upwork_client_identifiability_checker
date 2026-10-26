// Wires the real modules together for the side panel. Tests call the same function with a fake fetch.

import { newId as defaultNewId } from '../core/ids';
import type { ErrorCode, Result } from '../core/types';
import { errorResult } from '../pipeline/analyse';
import { checkJob } from '../pipeline/check';
import { sleep, type QueueItem, type RunnerDeps, type RunnerState } from '../runner/runner';
import { checksStore } from '../store/checks';
import { incrementDayCount } from '../store/local-state';
import type { Settings } from '../store/settings';
import { chromeUpworkDeps, createUpworkClient, type UpworkClient } from '../upwork';

export interface ComposeOptions {
  fetch?: typeof fetch;
  now?: () => Date;
  newId?: () => string;
  /** Where results go; the Supabase history by default (D-32). */
  save?: (result: Result) => Promise<void>;
}

export interface Checker {
  upwork: UpworkClient;
  check(item: QueueItem, signal?: AbortSignal): Promise<Result>;
  runnerDeps(onChange: (state: RunnerState) => void): RunnerDeps;
}

export function createChecker(settings: Settings, options: ComposeOptions = {}): Checker {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? defaultNewId;
  const upwork = createUpworkClient(
    chromeUpworkDeps({
      ...(options.fetch ? { fetch: options.fetch } : {}),
      onJobRequest: async () => {
        await incrementDayCount(now());
      },
    }),
  );
  const check = (item: QueueItem, signal?: AbortSignal) => checkJob(item, settings, { upwork, now, newId }, signal);
  return {
    upwork,
    check,
    runnerDeps: (onChange) => ({
      check,
      save: options.save ?? ((result) => checksStore().save(result)),
      errorResult: (item: QueueItem, code: ErrorCode, message: string) => errorResult(item.jobId, item.url, code, message, now()),
      sleep,
      now: () => Date.now(),
      delayMs: settings.delaySeconds * 1000,
      onChange,
    }),
  };
}
