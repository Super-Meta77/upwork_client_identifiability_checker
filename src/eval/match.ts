// FR-35 / D-19: which evidence matches the client name the user knows. Uses the same matching as the
// agreement rule, so "Acme Logistics Ltd", "acme-logistics.com" and "jo@acme-logistics.com" all count.

import type { Evidence, EvidenceKind, GroundTruth, Result } from '../core/types';
import { valuesAgree } from '../verdict/normalize';

function targets(gt: Omit<GroundTruth, 'matchedEvidenceIds'>): { kind: EvidenceKind; value: string }[] {
  const out: { kind: EvidenceKind; value: string }[] = [];
  const company = gt.companyName?.trim();
  const person = gt.personName?.trim();
  const website = gt.website?.trim();
  if (company) out.push({ kind: 'company_name', value: company });
  if (person) out.push({ kind: person.split(/\s+/).length >= 2 ? 'person_full_name' : 'person_first_name', value: person });
  if (website) out.push({ kind: 'website', value: website });
  return out;
}

export function hasGroundTruth(gt: GroundTruth | null | undefined): gt is GroundTruth {
  return !!gt && targets(gt).length > 0;
}

export function evidenceMatches(e: Evidence, gt: Omit<GroundTruth, 'matchedEvidenceIds'>): boolean {
  if (e.kind === 'attribute') return false;
  return targets(gt).some((t) => valuesAgree(e, t));
}

export function withMatches(result: Result, gt: Omit<GroundTruth, 'matchedEvidenceIds'>): GroundTruth {
  const clean = {
    personName: gt.personName?.trim() || undefined,
    companyName: gt.companyName?.trim() || undefined,
    website: gt.website?.trim() || undefined,
  };
  return { ...clean, matchedEvidenceIds: result.evidence.filter((e) => evidenceMatches(e, clean)).map((e) => e.id) };
}
