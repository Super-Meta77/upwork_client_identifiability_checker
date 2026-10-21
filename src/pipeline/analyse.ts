// Pure analysis of one fetched job (NFR-03: under 500 ms).

import type { AttachmentNote, AttachmentProps, ErrorCode, JobData, Result } from '../core/types';
import { clientProfile, extractAll, scoreS3, type S3Points } from '../extract';
import { errorVerdict, judge } from '../verdict';

export interface AnalysisSettings {
  s3Points: S3Points;
  s3Threshold: number;
  extraGenericSites: readonly string[];
  extraLegalEndings: readonly string[];
}

export interface AnalyseInput {
  job: JobData;
  url: string;
  props: readonly AttachmentProps[];
  attachmentNotes: readonly AttachmentNote[];
  settings: AnalysisSettings;
  now: Date;
  newId: () => string;
}

export function analyseJob({ job, url, props, attachmentNotes, settings, now, newId }: AnalyseInput): Result {
  const findings = extractAll(job, props, settings);
  const distinctiveness = scoreS3(job, settings.s3Points);
  const { evidence, verdict, bestEvidenceId } = judge(findings, distinctiveness.score, settings.s3Threshold, newId);
  return {
    jobId: job.jobId,
    url,
    checkedAt: now.toISOString(),
    jobTitle: job.title,
    verdict,
    bestEvidenceId,
    distinctiveness,
    evidence,
    error: null,
    groundTruth: null,
    attachmentNotes: [...attachmentNotes],
    profile: clientProfile(job),
  };
}

export function errorResult(jobId: string, url: string, code: ErrorCode, message: string, now: Date): Result {
  return {
    jobId,
    url,
    checkedAt: now.toISOString(),
    jobTitle: null,
    verdict: errorVerdict(),
    bestEvidenceId: null,
    distinctiveness: null,
    evidence: [],
    error: { code, message },
    groundTruth: null,
    attachmentNotes: [],
    profile: null,
  };
}
