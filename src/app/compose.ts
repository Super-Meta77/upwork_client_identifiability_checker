// Wires the real modules together for the side panel. Tests call the same function with a fake fetch.

import { newId as defaultNewId } from '../core/ids';
import type { ErrorCode, Result } from '../core/types';
import { parseAttachment } from '../extract/props/parse';
import { errorResult } from '../pipeline/analyse';
import { checkJob } from '../pipeline/check';
import { sleep, type RunnerDeps, type RunnerState } from '../runner/runner';
import { saveResult } from '../store/db';
import { clearQueue, incrementDayCount, saveQueue, type QueueItem } from '../store/local-state';
import type { Settings } from '../store/settings';
import { chromeUpworkDeps, createUpworkClient, type UpworkClient } from '../upwork';

export interface ComposeOptions {
  fetch?: typeof fetch;
  now?: () => Date;
  newId?: () => string;
}

export interface Checker {
  upwork: UpworkClient;
  check(item: QueueItem): Promise<Result>;
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
  const check = (item: QueueItem) => checkJob(item, settings, { upwork, parseAttachment, now, newId });
  return {
    upwork,
    check,
    runnerDeps: (onChange) => ({
      check,
      save: saveResult,
      errorResult: (item: QueueItem, code: ErrorCode, message: string) => errorResult(item.jobId, item.url, code, message, now()),
      saveQueue,
      clearQueue,
      sleep,
      now: () => Date.now(),
      delayMs: settings.delaySeconds * 1000,
      onChange,
    }),
  };
}
