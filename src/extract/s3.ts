// S3 (FR-21): a distinctiveness estimate from the trust details. Never a name, never an outside call.

import type { ClientProfile, Distinctiveness, JobData, S3Attribute, S3Detail } from '../core/types';
import { isSmallestCompanySize } from './lists/company-sizes';

export type S3Points = Record<S3Attribute, number>;

/** Spec defaults. They are settings and are calibrated in Phase 4 (D-22). */
export const DEFAULT_S3_POINTS: S3Points = {
  city: 25,
  industry: 15,
  company_size: 10,
  smallest_size: 10,
  member_since: 10,
  open_jobs: 10,
  past_jobs: 10,
  enterprise: 5,
  spend_and_hires: 5,
};

export const DEFAULT_S3_THRESHOLD = 70;

const present = (v: string | null | undefined): v is string => typeof v === 'string' && v.trim().length > 0;

export function memberSinceYear(contractDate: string | null): number | null {
  const year = Number(/\b(19|20)\d{2}\b/.exec(contractDate ?? '')?.[0]);
  return Number.isFinite(year) && year > 0 ? year : null;
}

export function scoreS3(job: JobData, points: S3Points = DEFAULT_S3_POINTS): Distinctiveness {
  const b = job.buyer;
  const details: S3Detail[] = [];
  const add = (attribute: S3Attribute, value: string) => details.push({ attribute, value, points: points[attribute] });

  if (present(b.city)) add('city', b.city);
  if (present(b.industry)) add('industry', b.industry);
  if (present(b.size)) add('company_size', b.size);
  if (isSmallestCompanySize(b.size)) add('smallest_size', b.size ?? '');
  if (present(b.contractDate)) add('member_since', b.contractDate);
  const openTitles = b.openJobTitles.filter(present);
  if (openTitles.length >= 3) add('open_jobs', `${openTitles.length} open job titles`);
  const pastTitles = b.workHistory.map((w) => w.jobTitle).filter(present);
  if (pastTitles.length >= 5) add('past_jobs', `${pastTitles.length} past job titles`);
  if (b.enterprise === true) add('enterprise', 'Enterprise client');
  if (b.totalCharges !== null && b.totalAssignments !== null) {
    add('spend_and_hires', `$${Math.round(b.totalCharges).toLocaleString('en-US')} spent, ${b.totalAssignments} hires`);
  }

  const score = Math.min(100, details.reduce((sum, d) => sum + d.points, 0));
  return { score, attributes: details.map((d) => d.attribute), details };
}

export function clientProfile(job: JobData): ClientProfile {
  const b = job.buyer;
  return {
    companyId: b.companyId,
    country: b.country,
    city: b.city,
    industry: b.industry,
    size: b.size,
    memberSinceYear: memberSinceYear(b.contractDate),
  };
}
