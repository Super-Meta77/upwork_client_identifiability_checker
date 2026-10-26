// Pure analysis of one fetched job (NFR-03: under 500 ms).

import type { ErrorCode, JobData, Result } from '../core/types';
import { extractAll, type ExtractSettings } from '../extract';
import { errorVerdict, judge } from '../verdict';

export interface AnalyseInput {
  job: JobData;
  url: string;
  settings: ExtractSettings;
  now: Date;
  newId: () => string;
}

export function analyseJob({ job, url, settings, now, newId }: AnalyseInput): Result {
  const { evidence, verdict, bestEvidenceId } = judge(extractAll(job, settings), newId);
  return { jobId: job.jobId, url, checkedAt: now.toISOString(), jobTitle: job.title, verdict, bestEvidenceId, evidence, error: null };
}

export function errorResult(jobId: string, url: string, code: ErrorCode, message: string, now: Date): Result {
  return { jobId, url, checkedAt: now.toISOString(), jobTitle: null, verdict: errorVerdict(), bestEvidenceId: null, evidence: [], error: { code, message } };
}
