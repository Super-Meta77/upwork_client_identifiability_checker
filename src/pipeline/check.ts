// One check: fetch the job, then run the analysis.

import type { Result } from '../core/types';
import type { ExtractSettings } from '../extract';
import type { UpworkClient } from '../upwork';
import { analyseJob } from './analyse';

export interface CheckDeps {
  upwork: UpworkClient;
  now: () => Date;
  newId: () => string;
}

/** Throws CheckerError for job-level failures. After Stop (`signal`), no request is sent (FR-13). */
export async function checkJob(link: { jobId: string; url: string }, settings: ExtractSettings, deps: CheckDeps, signal?: AbortSignal): Promise<Result> {
  const job = await deps.upwork.fetchJob(link.jobId, signal);
  return analyseJob({ job, url: link.url, settings, now: deps.now(), newId: deps.newId });
}
