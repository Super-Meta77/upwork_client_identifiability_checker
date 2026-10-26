import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckerError } from '../core/errors';
import type { ErrorCode, Result } from '../core/types';
import { errorResult } from '../pipeline/analyse';
import { BatchRunner, sleep, withRunnerLock, type QueueItem, type RunnerDeps, type RunnerState } from './runner';

const item = (i: number): QueueItem => {
  const jobId = `~01${String(i).padStart(16, '0')}`;
  return { jobId, url: `https://www.upwork.com/jobs/${jobId}` };
};
const queueOf = (n: number): QueueItem[] => Array.from({ length: n }, (_, i) => item(i));

const okResult = (it: QueueItem): Result => ({ ...errorResult(it.jobId, it.url, 'E-NETWORK', '', new Date()), verdict: 'no_potential', error: null, jobTitle: 'Job' });

function setup(check: (item: QueueItem, attempt: number) => Promise<Result> | Result, delayMs = 3000) {
  const callTimes: number[] = [];
  const attempts = new Map<string, number>();
  const saved: Result[] = [];
  const states: RunnerState[] = [];
  const deps: RunnerDeps = {
    check: async (it) => {
      callTimes.push(Date.now());
      const n = (attempts.get(it.jobId) ?? 0) + 1;
      attempts.set(it.jobId, n);
      return check(it, n);
    },
    save: async (r) => void saved.push(r),
    errorResult: (it, code, message) => errorResult(it.jobId, it.url, code, message, new Date()),
    sleep,
    now: () => Date.now(),
    delayMs,
    onChange: (s) => states.push(s),
  };
  const runner = new BatchRunner(deps);
  return { runner, deps, callTimes, saved, states, attempts };
}

async function runToEnd(runner: BatchRunner, items: QueueItem[]) {
  const done = runner.run(items);
  await vi.runAllTimersAsync();
  return done;
}

const gaps = (times: number[]) => times.slice(1).map((t, i) => t - times[i]!);

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-21T09:00:00Z') });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('batch runner (FR-13, NFR-01, NFR-05)', () => {
  it('finishes a 50-job batch with the delay respected and survives one failing job', async () => {
    const { runner, callTimes, saved } = setup((it) => {
      if (it.jobId === item(17).jobId) throw new CheckerError('E-NOTFOUND');
      return okResult(it);
    });
    const final = await runToEnd(runner, queueOf(50));
    expect(final.phase).toBe('done');
    expect(callTimes).toHaveLength(50);
    expect(Math.min(...gaps(callTimes))).toBeGreaterThanOrEqual(3000);
    expect(saved).toHaveLength(50);
    expect(saved[17]).toMatchObject({ verdict: 'error', error: { code: 'E-NOTFOUND' } });
    expect(final.rows.filter((r) => r.status === 'done')).toHaveLength(49);
    expect(final.completed).toBe(50);
  });

  it('uses the configured delay and never less than 3 s', async () => {
    const slow = setup(okResult, 10_000);
    await runToEnd(slow.runner, queueOf(3));
    expect(gaps(slow.callTimes)).toEqual([10_000, 10_000]);
    const fast = setup(okResult, 500);
    await runToEnd(fast.runner, queueOf(3));
    expect(gaps(fast.callTimes)).toEqual([3000, 3000]);
  });

  it('stops on Stop; the remaining jobs stay queued', async () => {
    const { runner, callTimes } = setup(okResult);
    const done = runner.run(queueOf(5));
    await vi.advanceTimersByTimeAsync(1000);
    expect(runner.isActive()).toBe(true);
    runner.stop();
    const final = await done;
    expect(final.phase).toBe('stopped');
    expect(callTimes).toHaveLength(1);
    expect(final.rows.map((r) => r.status)).toEqual(['done', 'queued', 'queued', 'queued', 'queued']);
    expect(runner.isActive()).toBe(false);
  });

  it('Stop during a job keeps that job queued and saves nothing for it (FR-13)', async () => {
    let stop = () => {};
    const { runner, saved } = setup(async (it) => {
      if (it.jobId === item(1).jobId) {
        stop();
        throw new DOMException('stopped', 'AbortError');
      }
      return okResult(it);
    });
    stop = () => runner.stop();
    const final = await runToEnd(runner, queueOf(3));
    expect(final.phase).toBe('stopped');
    expect(final.stopReason).toBeNull();
    expect(saved).toHaveLength(1);
    expect(final.rows.map((r) => r.status)).toEqual(['done', 'queued', 'queued']);
  });

  it.each<ErrorCode>(['E-AUTH', 'E-SCOPE', 'E-FORMAT', 'E-BLOCKED'])('%s stops the batch and does not retry other jobs (FR-11)', async (code) => {
    const { runner, callTimes, saved } = setup((it) => {
      if (it.jobId === item(1).jobId) throw new CheckerError(code, 'x');
      return okResult(it);
    });
    const final = await runToEnd(runner, queueOf(4));
    expect(final.phase).toBe('stopped');
    expect(final.stopReason?.code).toBe(code);
    expect(callTimes).toHaveLength(2);
    expect(saved).toHaveLength(1);
  });

  it('E-NETWORK: retries once after 10 s, then marks the job failed and continues', async () => {
    const { runner, callTimes, saved } = setup((it) => {
      if (it.jobId === item(0).jobId) throw new CheckerError('E-NETWORK');
      return okResult(it);
    });
    const final = await runToEnd(runner, queueOf(2));
    expect(gaps(callTimes)).toEqual([10_000, 3000]);
    expect(saved[0]).toMatchObject({ error: { code: 'E-NETWORK' } });
    expect(final.phase).toBe('done');
  });

  it('E-NETWORK: a successful retry counts as success', async () => {
    const { runner, saved } = setup((it, attempt) => {
      if (attempt === 1) throw new CheckerError('E-NETWORK');
      return okResult(it);
    });
    await runToEnd(runner, queueOf(1));
    expect(saved[0]?.error).toBeNull();
  });

  it('E-RATE: pauses 1, 2, 5 and 10 minutes, then stops', async () => {
    const { runner, callTimes, states } = setup(() => {
      throw new CheckerError('E-RATE');
    });
    const final = await runToEnd(runner, queueOf(3));
    expect(gaps(callTimes)).toEqual([60_000, 120_000, 300_000, 600_000]);
    expect(final.phase).toBe('stopped');
    expect(final.stopReason?.code).toBe('E-RATE');
    expect(states.some((s) => s.phase === 'paused' && s.stopReason?.message.includes('Paused for 5 minutes'))).toBe(true);
  });

  it('E-RATE: resumes after a pause and resets the back-off after a success', async () => {
    const { runner, callTimes } = setup((it, attempt) => {
      if (attempt === 1) throw new CheckerError('E-RATE');
      return okResult(it);
    });
    await runToEnd(runner, queueOf(2));
    expect(gaps(callTimes)).toEqual([60_000, 3000, 60_000]);
  });

  it('treats three server errors in a row as E-RATE', async () => {
    const { runner, callTimes } = setup((it, attempt) => {
      const failing = it.jobId === item(0).jobId ? attempt <= 2 : attempt === 1;
      if (failing) throw new CheckerError('E-NETWORK', 'HTTP 502', { serverError: true });
      return okResult(it);
    });
    await runToEnd(runner, queueOf(2));
    // job 0: 502, retry after 10 s: 502 -> failed; job 1 after 3 s: third 502 in a row -> pause 1 min.
    expect(gaps(callTimes)).toEqual([10_000, 3000, 60_000]);
  });

  it('treats an unexpected exception like a network failure', async () => {
    const { runner, saved } = setup(() => {
      throw new Error('bug');
    });
    const final = await runToEnd(runner, queueOf(1));
    expect(final.phase).toBe('done');
    expect(saved[0]?.error?.code).toBe('E-NETWORK');
  });

  it('E-STORAGE: keeps showing results but stops saving', async () => {
    const { runner, deps } = setup(okResult);
    let saves = 0;
    deps.save = async () => {
      saves += 1;
      throw new CheckerError('E-STORAGE');
    };
    const final = await runToEnd(runner, queueOf(3));
    expect(final.savingDisabled).toBe(true);
    expect(saves).toBe(1);
    expect(final.rows.every((r) => r.result)).toBe(true);
    expect(final.phase).toBe('done');
  });

  it('reports progress: current job and time left (FR-30)', async () => {
    const { runner, states } = setup(okResult, 5000);
    await runToEnd(runner, queueOf(3));
    const running = states.filter((s) => s.phase === 'running' && s.currentUrl);
    expect(running[0]?.currentUrl).toBe(item(0).url);
    expect(running[0]?.secondsLeft).toBeGreaterThan(10);
    expect(states.at(-1)?.secondsLeft).toBe(0);
  });

  it('refuses a second run while one is active', async () => {
    const { runner } = setup(okResult);
    const first = runner.run(queueOf(2));
    await expect(runner.run(queueOf(1))).rejects.toThrow('already running');
    await vi.runAllTimersAsync();
    await first;
  });
});

describe('runner helpers', () => {
  it('sleep resolves early on abort', async () => {
    const c = new AbortController();
    const s = sleep(60_000, c.signal);
    c.abort();
    await expect(s).resolves.toBeUndefined();
    await expect(sleep(1, c.signal)).resolves.toBeUndefined();
  });

  it('runs the work without navigator.locks', async () => {
    let ran = false;
    await expect(withRunnerLock(async () => void (ran = true))).resolves.toBe(true);
    expect(ran).toBe(true);
  });
});
