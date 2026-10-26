import type { Evidence, EvidenceKind, SourceId, Verdict } from '../core/types';
import { CONFIDENCE_RANK } from './rules';

/**
 * Verdict (D-33): a posting has potential when a name, website or email was found at Medium or
 * High confidence. Low findings are shown as weak signals but never decide the verdict (D-02).
 */
export function decideVerdict(evidence: readonly Evidence[]): Verdict {
  return evidence.some((e) => CONFIDENCE_RANK[e.confidence] >= CONFIDENCE_RANK.medium) ? 'has_potential' : 'no_potential';
}

/** The verdict for a job that could not be fetched or validated. */
export function errorVerdict(): Verdict {
  return 'error';
}

const SOURCE_ORDER: readonly SourceId[] = ['S1', 'S2-text', 'S5', 'S2-file'];
const KIND_ORDER: readonly EvidenceKind[] = ['company_name', 'person_full_name', 'website', 'email', 'person_first_name'];

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
