// The confidence table. FR-24: this file is the only place where confidence is assigned.
// Rows are listed in docs/decisions.md ("Final confidence table").

import type { Confidence, Evidence, Finding, ReasonId, RuleId, SourceId } from '../core/types';

export interface RuleOutcome {
  ruleId: RuleId;
  confidence: Confidence;
}

export function ruleFor(f: Finding): RuleOutcome {
  switch (f.detector) {
    case 'S1-company':
      return { ruleId: 'C-S1', confidence: 'high' };
    case 'S2T-company-intro':
      return { ruleId: 'C-S2T-CO', confidence: 'medium' };
    case 'S2T-company-legal':
      return f.ownershipCue
        ? { ruleId: 'C-S2T-CO', confidence: 'medium' }
        : { ruleId: 'C-S2T-CO-NC', confidence: 'low' };
    case 'S2T-website':
      return f.ownershipCue
        ? { ruleId: 'C-S2T-WEB', confidence: 'medium' }
        : { ruleId: 'C-S2T-WEB-NC', confidence: 'low' };
    case 'S2T-email':
    case 'S2T-email-domain':
      return { ruleId: 'C-S2T-EMAIL', confidence: 'medium' };
    case 'S2T-person':
      return { ruleId: 'C-S2T-PERSON', confidence: f.kind === 'person_full_name' ? 'medium' : 'low' };
    case 'S2P-company':
      return { ruleId: 'C-S2P-CO', confidence: 'medium' };
    case 'S2P-person':
      return { ruleId: 'C-S2P-PERSON', confidence: f.kind === 'person_first_name' ? 'low' : 'medium' };
    case 'S2P-copyright':
      return { ruleId: 'C-S2P-COPY', confidence: f.kind === 'person_first_name' ? 'low' : 'medium' };
    case 'S2P-title':
      return { ruleId: 'C-S2P-TITLE', confidence: 'low' };
    case 'S2F-name':
      return { ruleId: 'C-S2F', confidence: 'low' };
    case 'S5-name':
      return {
        ruleId: f.kind === 'person_full_name' ? 'C-S5-FULL' : 'C-S5-FIRST',
        confidence: f.mentions >= 2 ? 'medium' : 'low',
      };
  }
}

export const REASON_BY_SOURCE: Record<Finding['source'], ReasonId> = {
  S1: 'R-S1',
  'S2-text': 'R-S2-text',
  'S2-file': 'R-S2-file',
  'S2-props': 'R-S2-props',
  S5: 'R-S5',
};

export const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/** Agreement rule: Low to Medium, Medium to High. */
export function raiseOneLevel(c: Confidence): Confidence {
  return c === 'low' ? 'medium' : 'high';
}

export function toEvidence(findings: readonly Finding[], newId: () => string): Evidence[] {
  return findings.map((f) => {
    const { ruleId, confidence } = ruleFor(f);
    return {
      id: newId(),
      source: f.source as SourceId,
      kind: f.kind,
      location: f.location,
      value: f.value,
      snippet: f.snippet,
      confidence,
      baseConfidence: confidence,
      reasonId: REASON_BY_SOURCE[f.source],
      mentions: f.mentions,
      ruleId,
      agreesWith: [],
    };
  });
}
