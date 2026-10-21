import type { Evidence, Finding, Verdict } from '../core/types';
import { applyAgreement } from './agreement';
import { toEvidence } from './rules';
import { bestEvidence, decideVerdict } from './verdict';

export interface Judgement {
  evidence: Evidence[];
  verdict: Verdict;
  bestEvidenceId: string | null;
}

/** Findings in, evidence with confidence, verdict and best evidence out. */
export function judge(
  findings: readonly Finding[],
  s3Score: number | null,
  narrowableThreshold: number,
  newId: () => string,
): Judgement {
  const evidence = applyAgreement(toEvidence(findings, newId));
  const verdict = decideVerdict({ evidence, s3Score, narrowableThreshold, failed: false });
  return { evidence, verdict, bestEvidenceId: bestEvidence(evidence)?.id ?? null };
}

export { REASON_TEXT } from './reasons';
export { CONFIDENCE_RANK } from './rules';
export { errorVerdict } from './verdict';
