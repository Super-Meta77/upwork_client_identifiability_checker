import type { Evidence, EvidenceKind, SourceId, Verdict } from '../core/types';
import { CONFIDENCE_RANK } from './rules';

const NAME_OR_CONTACT: ReadonlySet<EvidenceKind> = new Set([
  'company_name',
  'person_full_name',
  'person_first_name',
  'website',
  'email',
]);

export interface VerdictInput {
  evidence: readonly Evidence[];
  s3Score: number | null;
  narrowableThreshold: number;
  failed: boolean;
}

/** Verdict rules, first match wins (spec "Verdict rules", D-02). */
export function decideVerdict({ evidence, s3Score, narrowableThreshold, failed }: VerdictInput): Verdict {
  if (failed) return 'error';
  if (evidence.some((e) => e.confidence === 'high' && (e.kind === 'company_name' || e.kind === 'person_full_name'))) {
    return 'identified';
  }
  if (evidence.some((e) => NAME_OR_CONTACT.has(e.kind) && CONFIDENCE_RANK[e.confidence] >= CONFIDENCE_RANK.medium)) {
    return 'partial';
  }
  if (s3Score !== null && s3Score >= narrowableThreshold) return 'narrowable';
  return 'not_identifiable';
}

/** The verdict for a job that could not be fetched or validated (rule 1). */
export function errorVerdict(): Verdict {
  return decideVerdict({ evidence: [], s3Score: null, narrowableThreshold: 0, failed: true });
}

const SOURCE_ORDER: readonly SourceId[] = ['S1', 'S2-props', 'S2-text', 'S5', 'S2-file', 'S3'];
const KIND_ORDER: readonly EvidenceKind[] = [
  'company_name',
  'person_full_name',
  'website',
  'email',
  'person_first_name',
  'attribute',
];

/**
 * Best evidence (D-08): highest confidence; then the spec's source order; then kind; then most
 * mentions; then the earliest finding. Low findings count, so a weak-only job still shows one.
 */
export function bestEvidence(evidence: readonly Evidence[]): Evidence | null {
  let best: Evidence | null = null;
  let bestIndex = -1;
  for (let index = 0; index < evidence.length; index += 1) {
    const e = evidence[index]!;
    if (!best || compare(e, index, best, bestIndex) < 0) {
      best = e;
      bestIndex = index;
    }
  }
  return best;
}

function compare(a: Evidence, ai: number, b: Evidence, bi: number): number {
  return (
    CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] ||
    SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source) ||
    KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
    b.mentions - a.mentions ||
    ai - bi
  );
}
