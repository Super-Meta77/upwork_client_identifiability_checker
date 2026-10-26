// Small builders for findings, evidence and job data used across tests.

import type { BuyerData, Evidence, Finding, JobData } from '../src/core/types';

export function finding(partial: Partial<Finding> & Pick<Finding, 'detector'>): Finding {
  return {
    source: 'S2-text',
    kind: 'company_name',
    location: 'opening.job.description',
    value: 'Acme Ltd',
    snippet: '…Acme Ltd…',
    mentions: 1,
    ...partial,
  };
}

let counter = 0;
export function sequentialIds(prefix = 'e'): () => string {
  counter = 0;
  return () => `${prefix}${(counter += 1)}`;
}

export function evidence(partial: Partial<Evidence>): Evidence {
  return {
    id: `id-${Math.random().toString(36).slice(2)}`,
    source: 'S2-text',
    kind: 'company_name',
    location: 'opening.job.description',
    value: 'Acme Ltd',
    snippet: '',
    confidence: 'medium',
    baseConfidence: partial.confidence ?? 'medium',
    reasonId: 'R-S2-text',
    mentions: 1,
    ruleId: 'C-S2T-CO',
    agreesWith: [],
    ...partial,
  };
}

export function emptyBuyer(overrides: Partial<BuyerData> = {}): BuyerData {
  return { companyName: null, workHistory: [], ...overrides };
}

export function job(overrides: Partial<Omit<JobData, 'buyer'>> & { buyer?: Partial<BuyerData> } = {}): JobData {
  const { buyer, ...rest } = overrides;
  return {
    jobId: '~01a2b3c4d5e6f7a8b9',
    title: 'Build a landing page',
    description: '',
    questions: [],
    attachmentNames: [],
    ...rest,
    buyer: emptyBuyer(buyer),
  };
}
