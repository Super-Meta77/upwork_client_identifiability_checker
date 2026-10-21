// Shared records. Field names follow the "Data requirements" section of the spec.

export type SourceId = 'S1' | 'S2-text' | 'S2-file' | 'S2-props' | 'S3' | 'S5';

export type EvidenceKind =
  | 'company_name'
  | 'person_full_name'
  | 'person_first_name'
  | 'website'
  | 'email'
  | 'attribute';

export type Confidence = 'high' | 'medium' | 'low';

export type ReasonId = 'R-S1' | 'R-S2-text' | 'R-S2-file' | 'R-S2-props' | 'R-S3' | 'R-S5';

export type Verdict = 'identified' | 'partial' | 'narrowable' | 'not_identifiable' | 'error';

export type ErrorCode =
  | 'E-LINK'
  | 'E-AUTH'
  | 'E-SCOPE'
  | 'E-NOTFOUND'
  | 'E-RATE'
  | 'E-FORMAT'
  | 'E-ATTACH'
  | 'E-NETWORK'
  | 'E-STORAGE'
  | 'E-BLOCKED';

/** Rows of the confidence table (docs/decisions.md, "Final confidence table"). */
export type RuleId =
  | 'C-S1'
  | 'C-S2T-CO'
  | 'C-S2T-CO-NC'
  | 'C-S2T-WEB'
  | 'C-S2T-WEB-NC'
  | 'C-S2T-EMAIL'
  | 'C-S2T-PERSON'
  | 'C-S2P-CO'
  | 'C-S2P-PERSON'
  | 'C-S2P-COPY'
  | 'C-S2P-TITLE'
  | 'C-S2F'
  | 'C-S5-FIRST'
  | 'C-S5-FULL';

/** Which detector produced a finding. The verdict rules map a detector to a rule row. */
export type Detector =
  | 'S1-company'
  | 'S2T-company-intro'
  | 'S2T-company-legal'
  | 'S2T-website'
  | 'S2T-email'
  | 'S2T-email-domain'
  | 'S2T-person'
  | 'S2P-company'
  | 'S2P-person'
  | 'S2P-copyright'
  | 'S2P-title'
  | 'S2F-name'
  | 'S5-name';

/**
 * What an extractor reports. It carries no confidence: only src/verdict/rules.ts sets that (FR-24).
 */
export interface Finding {
  source: Exclude<SourceId, 'S3'>;
  detector: Detector;
  kind: Exclude<EvidenceKind, 'attribute'>;
  /** Field path, or "attachment <file> > <part> > <field>". */
  location: string;
  value: string;
  /** Up to 60 characters of context on each side of the value. */
  snippet: string;
  mentions: number;
  /** S2 text: an ownership phrase ("our website", "we are"…) appears near the value (D-04). */
  ownershipCue?: boolean;
}

/** Evidence record (FR-23). `ruleId`, `baseConfidence` and `agreesWith` extend the spec's schema. */
export interface Evidence {
  id: string;
  source: SourceId;
  kind: EvidenceKind;
  location: string;
  value: string;
  snippet: string;
  confidence: Confidence;
  reasonId: ReasonId;
  mentions: number;
  ruleId: RuleId;
  /** Confidence before the agreement rule raised it. */
  baseConfidence: Confidence;
  /** Ids of evidence from other sources whose value agrees with this one. */
  agreesWith: string[];
}

export interface S3Detail {
  attribute: S3Attribute;
  value: string;
  points: number;
}

export type S3Attribute =
  | 'city'
  | 'industry'
  | 'company_size'
  | 'smallest_size'
  | 'member_since'
  | 'open_jobs'
  | 'past_jobs'
  | 'enterprise'
  | 'spend_and_hires';

export interface Distinctiveness {
  score: number;
  attributes: S3Attribute[];
  details: S3Detail[];
}

/** Trust details kept for FR-22 peer counts (D-20: never used to pool evidence across jobs). */
export interface ClientProfile {
  companyId: string | null;
  country: string | null;
  city: string | null;
  industry: string | null;
  size: string | null;
  memberSinceYear: number | null;
}

/** D-19: one field per kind of name, so precision can be scored per evidence kind. */
export interface GroundTruth {
  personName?: string;
  companyName?: string;
  website?: string;
  matchedEvidenceIds: string[];
}

export interface AttachmentNote {
  fileName: string;
  code: 'E-ATTACH';
  message: string;
}

export interface Result {
  jobId: string;
  url: string;
  checkedAt: string;
  jobTitle: string | null;
  verdict: Verdict;
  bestEvidenceId: string | null;
  distinctiveness: Distinctiveness | null;
  evidence: Evidence[];
  error: { code: ErrorCode; message: string } | null;
  groundTruth: GroundTruth | null;
  attachmentNotes: AttachmentNote[];
  profile: ClientProfile | null;
}

/** Job data after schema validation and mapping (NFR-12: extractors only see this shape). */
export interface JobData {
  jobId: string;
  title: string;
  description: string;
  questions: string[];
  attachments: AttachmentRef[];
  buyer: BuyerData;
}

export interface AttachmentRef {
  fileName: string;
  uri: string | null;
  length: number | null;
}

export interface BuyerData {
  companyName: string | null;
  companyId: string | null;
  contractDate: string | null;
  industry: string | null;
  size: string | null;
  enterprise: boolean | null;
  city: string | null;
  country: string | null;
  countryTimezone: string | null;
  totalCharges: number | null;
  totalAssignments: number | null;
  feedbackCount: number | null;
  postedCount: number | null;
  openJobTitles: string[];
  workHistory: WorkHistoryItem[];
}

export interface WorkHistoryItem {
  jobTitle: string | null;
  feedbackComment: string | null;
  feedbackToClientComment: string | null;
  contractorName: string | null;
}

/** Properties read from one attachment (FR-19). */
export interface AttachmentProps {
  fileName: string;
  fileType: 'pdf' | 'office' | 'jpeg';
  entries: AttachmentPropEntry[];
}

export type AttachmentField =
  | 'pdf.Author'
  | 'pdf.Creator'
  | 'pdf.Title'
  | 'office.creator'
  | 'office.lastModifiedBy'
  | 'office.title'
  | 'office.Company'
  | 'office.Manager'
  | 'exif.Artist'
  | 'exif.Copyright';

export interface AttachmentPropEntry {
  field: AttachmentField;
  /** e.g. "attachment brief.docx > docProps/app.xml > Company" */
  location: string;
  value: string;
}
