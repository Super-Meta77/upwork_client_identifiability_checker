import type { JobData } from '../core/types';
import type { JobAuthDetails } from './schema';

const clean = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

/** Validated response -> the JobData shape the extractors see (NFR-12). */
export function mapJob(jobId: string, d: JobAuthDetails): JobData {
  const info = d.buyer.info;
  const company = info?.company;
  return {
    jobId,
    title: d.opening.job.info.title.trim(),
    description: d.opening.job.description ?? '',
    questions: (d.opening.questions ?? []).map((q) => q?.question?.trim() ?? '').filter(Boolean),
    attachments: (d.opening.job.attachments ?? [])
      .filter((a): a is NonNullable<typeof a> => !!a && !!clean(a.fileName))
      .map((a) => ({ fileName: clean(a.fileName)!, uri: clean(a.uri), length: a.length })),
    buyer: {
      companyName: clean(company?.name),
      companyId: clean(company?.companyId),
      contractDate: clean(company?.contractDate),
      industry: clean(company?.profile?.industry),
      size: clean(company?.profile?.size),
      enterprise: d.buyer.enterprise ?? null,
      city: clean(info?.location?.city),
      country: clean(info?.location?.country),
      countryTimezone: clean(info?.location?.countryTimezone),
      totalCharges: info?.stats?.totalCharges?.amount ?? null,
      totalAssignments: info?.stats?.totalAssignments ?? null,
      feedbackCount: info?.stats?.feedbackCount ?? null,
      postedCount: info?.jobs?.postedCount ?? null,
      openJobTitles: (info?.jobs?.openJobs ?? []).map((j) => clean(j?.title)).filter((t): t is string => !!t),
      workHistory: (d.buyer.workHistory ?? [])
        .filter((w): w is NonNullable<typeof w> => !!w)
        .map((w) => ({
          jobTitle: clean(w.jobInfo?.title),
          feedbackComment: clean(w.feedback?.comment),
          feedbackToClientComment: clean(w.feedbackToClient?.comment),
          contractorName: clean(w.contractorInfo?.contractorName),
        })),
    },
  };
}
