// Shared records. Field names follow the "Data requirements" section of the spec.

export type SourceId = 'S1' | 'S2-text' | 'S2-file' | 'S5';

export type EvidenceKind = 'company_name' | 'person_full_name' | 'person_first_name' | 'website' | 'email';

export type Confidence = 'high' | 'medium' | 'low';

export type ReasonId = 'R-S1' | 'R-S2-text' | 'R-S2-file' | 'R-S5';

/** D-33: a posting has potential when a Medium or High name, website or email was found. */
export type Verdict = 'has_potential' | 'no_potential' | 'error';

export type ErrorCode = 'E-AUTH' | 'E-SCOPE' | 'E-NOTFOUND' | 'E-RATE' | 'E-FORMAT' | 'E-NETWORK' | 'E-STORAGE' | 'E-BLOCKED';

/** Rows of the confidence table (docs/decisions.md, "Confidence table"). */
export type RuleId =
  | 'C-S1'
  | 'C-S2T-CO'
  | 'C-S2T-CO-NC'
  | 'C-S2T-WEB'
  | 'C-S2T-WEB-NC'
  | 'C-S2T-EMAIL'
  | 'C-S2T-PERSON'
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
  | 'S2F-name'
  | 'S5-name';

/**
 * What an extractor reports. It carries no confidence: only src/verdict/rules.ts sets that (FR-24).
 */
export interface Finding {
  source: SourceId;
  detector: Detector;
  kind: EvidenceKind;
  /** Field path, or "attachment <file> > file name". */
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
  /** Set when the check runs; not stored in the history (D-32). */
  ruleId?: RuleId;
  /** Confidence before the agreement rule raised it. */
  baseConfidence: Confidence;
  /** Ids of evidence from other sources whose value agrees with this one. */
  agreesWith: string[];
}

export interface Result {
  jobId: string;
  url: string;
  checkedAt: string;
  jobTitle: string | null;
  verdict: Verdict;
  bestEvidenceId: string | null;
  evidence: Evidence[];
  error: { code: ErrorCode; message: string } | null;
}

/** Job data after schema validation and mapping (NFR-12: extractors only see this shape). */
export interface JobData {
  jobId: string;
  title: string;
  description: string;
  questions: string[];
  /** File names of the job's attachments (S2-file). The files themselves are never downloaded. */
  attachmentNames: string[];
  buyer: BuyerData;
}

export interface BuyerData {
  companyName: string | null;
  workHistory: WorkHistoryItem[];
}

export interface WorkHistoryItem {
  feedbackComment: string | null;
  feedbackToClientComment: string | null;
  contractorName: string | null;
}
