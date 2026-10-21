import type { ReasonId } from '../core/types';

/** "Why" text shown on the card for each evidence record (spec, "Explanation texts"). */
export const REASON_TEXT: Record<ReasonId, string> = {
  'R-S1':
    "Upwork includes the client's company name in the job data it sends to logged-in freelancers. The client entered this value.",
  'R-S2-text': 'The client wrote this in the job post.',
  'R-S2-file': 'The name of a file the client attached contains this.',
  'R-S2-props':
    'A file the client attached stores this in its properties. Office and PDF software usually fills these in automatically.',
  'R-S3':
    'Upwork shows these details so freelancers can judge clients. Together they fit few clients, but they do not reveal a name.',
  'R-S5': "A review published on this job page mentions this name. Freelancers' own names were removed.",
};
