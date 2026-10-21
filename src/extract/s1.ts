import type { Finding, JobData } from '../core/types';
import { isPlaceholderCompanyName } from './lists/placeholders';

/** S1 (FR-16): the company-name field, unless empty or a placeholder (D-09). */
export function extractS1(job: JobData): Finding[] {
  const value = job.buyer.companyName?.replace(/\s+/g, ' ').trim() ?? '';
  if (isPlaceholderCompanyName(value)) return [];
  return [
    {
      source: 'S1',
      detector: 'S1-company',
      kind: 'company_name',
      location: 'buyer.info.company.name',
      value,
      snippet: value,
      mentions: 1,
    },
  ];
}
