import type { Confidence, EvidenceKind, S3Attribute, SourceId, Verdict } from '../core/types';
import type { RowStatus } from '../runner/runner';

/** NFR-15: verdicts are always shown as text, never by colour alone. */
export const VERDICT_LABEL: Record<Verdict, string> = {
  identified: 'Identified before contact',
  partial: 'Partially identified',
  narrowable: 'Narrowable',
  not_identifiable: 'Not identifiable before contact',
  error: 'Error',
};

export const SOURCE_LABEL: Record<SourceId, string> = {
  S1: 'S1 · Company-name field',
  'S2-props': 'S2 · Attachment properties',
  'S2-text': 'S2 · Job post text',
  S5: 'S5 · Reviews',
  'S2-file': 'S2 · Attachment file names',
  S3: 'S3 · Trust details',
};

/** Card grouping order follows the best-evidence source order. */
export const SOURCE_ORDER: readonly SourceId[] = ['S1', 'S2-props', 'S2-text', 'S5', 'S2-file'];

export const KIND_LABEL: Record<EvidenceKind, string> = {
  company_name: 'Company name',
  person_full_name: 'Full name',
  person_first_name: 'First name',
  website: 'Website',
  email: 'Email',
  attribute: 'Attribute',
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = { high: 'High', medium: 'Medium', low: 'Low' };

export const S3_LABEL: Record<S3Attribute, string> = {
  city: 'City',
  industry: 'Industry',
  company_size: 'Company size',
  smallest_size: 'Smallest company size',
  member_since: 'Member since',
  open_jobs: '3 or more open jobs',
  past_jobs: '5 or more past jobs',
  enterprise: 'Enterprise client',
  spend_and_hires: 'Total spend and hires',
};

export const STATUS_LABEL: Record<RowStatus, string> = {
  queued: 'Waiting',
  running: 'Checking…',
  done: 'Done',
  error: 'Failed',
  earlier: 'Checked earlier',
};

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return 'less than a second';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (!m) return `${s} s`;
  return s ? `${m} min ${s} s` : `${m} min`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
