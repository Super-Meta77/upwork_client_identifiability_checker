// FR-36: per source, the share of ground-truth jobs with evidence (hit rate) and the share of that
// evidence matching the known name (precision). Counts are always shown next to the percentages.

import type { Confidence, Result, SourceId } from '../core/types';
import { escapeCell } from '../export/csv';
import { evidenceMatches, hasGroundTruth } from './match';

export const EVAL_SOURCES: readonly Exclude<SourceId, 'S3'>[] = ['S1', 'S2-text', 'S2-file', 'S2-props', 'S5'];
const LEVELS: readonly Confidence[] = ['high', 'medium', 'low'];

export interface SourceRow {
  source: Exclude<SourceId, 'S3'>;
  jobs: number;
  jobsWithEvidence: number;
  hitRate: number | null;
  evidence: number;
  matched: number;
  precision: number | null;
}

export interface LevelRow {
  level: Confidence;
  evidence: number;
  matched: number;
  precision: number | null;
}

export interface EvaluationReport {
  generatedAt: string;
  groundTruthJobs: number;
  sources: SourceRow[];
  levels: LevelRow[];
  notes: string[];
}

export const EVALUATION_NOTES: readonly string[] = [
  'Ground-truth jobs come from your own past clients. Upwork may show a hired freelancer more than a stranger, so these rates can be higher than for unknown clients.',
  'With few jobs a single result moves a percentage a lot; read the counts as well.',
  'There is no pass mark: the goal is an honest measurement of what is possible.',
];

const share = (part: number, whole: number): number | null => (whole ? part / whole : null);

export function buildEvaluationReport(results: readonly Result[], now: Date): EvaluationReport {
  const jobs = results.filter((r) => r.verdict !== 'error' && hasGroundTruth(r.groundTruth));
  const scored = jobs.flatMap((r) => r.evidence.filter((e) => e.source !== 'S3').map((e) => ({ e, matched: evidenceMatches(e, r.groundTruth!) })));

  const sources = EVAL_SOURCES.map((source): SourceRow => {
    const jobsWithEvidence = jobs.filter((r) => r.evidence.some((e) => e.source === source)).length;
    const own = scored.filter((s) => s.e.source === source);
    const matched = own.filter((s) => s.matched).length;
    return { source, jobs: jobs.length, jobsWithEvidence, hitRate: share(jobsWithEvidence, jobs.length), evidence: own.length, matched, precision: share(matched, own.length) };
  });

  const levels = LEVELS.map((level): LevelRow => {
    const own = scored.filter((s) => s.e.confidence === level);
    const matched = own.filter((s) => s.matched).length;
    return { level, evidence: own.length, matched, precision: share(matched, own.length) };
  });

  return { generatedAt: now.toISOString(), groundTruthJobs: jobs.length, sources, levels, notes: [...EVALUATION_NOTES] };
}

export function formatShare(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

export function reportToCsv(report: EvaluationReport): string {
  const lines = [
    'section,name,jobs,jobs_with_evidence,hit_rate,evidence,matched,precision',
    ...report.sources.map((s) => ['source', s.source, s.jobs, s.jobsWithEvidence, formatShare(s.hitRate), s.evidence, s.matched, formatShare(s.precision)].map(escapeCell).join(',')),
    ...report.levels.map((l) => ['confidence', l.level, '', '', '', l.evidence, l.matched, formatShare(l.precision)].map(escapeCell).join(',')),
  ];
  return `﻿${lines.join('\r\n')}\r\n`;
}
