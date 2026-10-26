import type { JobData } from '../core/types';
import type { JobAuthDetails } from './schema';

const clean = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/** Validated response -> the JobData shape the extractors see (NFR-12). */
export function mapJob(jobId: string, d: JobAuthDetails): JobData {
  return {
    jobId,
    title: d.opening.job.info.title.trim(),
    description: d.opening.job.description ?? '',
    questions: (d.opening.questions ?? []).map((q) => q?.question?.trim() ?? '').filter(Boolean),
    attachmentNames: (d.opening.job.attachments ?? []).map((a) => clean(a?.fileName)).filter((name): name is string => !!name),
    buyer: {
      companyName: clean(d.buyer.info?.company?.name),
      workHistory: (d.buyer.workHistory ?? [])
        .filter((w): w is NonNullable<typeof w> => !!w)
        .map((w) => ({
          feedbackComment: clean(w.feedback?.comment),
          feedbackToClientComment: clean(w.feedbackToClient?.comment),
          contractorName: clean(w.contractorInfo?.contractorName),
        })),
    },
  };
}
