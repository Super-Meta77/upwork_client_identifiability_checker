import type { Evidence } from '../core/types';
import { valuesAgree } from './normalize';
import { raiseOneLevel } from './rules';

/**
 * Agreement rule (D-03): when findings from two different sources match, raise both by one level.
 * A finding is raised at most once, from its starting confidence, however many findings agree with it.
 */
export function applyAgreement(evidence: readonly Evidence[]): Evidence[] {
  const partners = new Map<string, string[]>();
  for (let i = 0; i < evidence.length; i += 1) {
    for (let j = i + 1; j < evidence.length; j += 1) {
      const a = evidence[i]!;
      const b = evidence[j]!;
      if (a.source === b.source) continue;
      if (!valuesAgree(a, b)) continue;
      partners.set(a.id, [...(partners.get(a.id) ?? []), b.id]);
      partners.set(b.id, [...(partners.get(b.id) ?? []), a.id]);
    }
  }
  return evidence.map((e) => {
    const agreesWith = partners.get(e.id);
    if (!agreesWith) return e;
    return { ...e, agreesWith, confidence: raiseOneLevel(e.baseConfidence) };
  });
}
