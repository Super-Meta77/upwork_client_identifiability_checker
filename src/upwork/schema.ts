// FR-14 / D-10: validate the response before use. Unknown fields are stripped; only the job title and
// the buyer object are required, because every other field is legitimately empty for some clients.

import { z } from 'zod';

const text = z.string().nullish();
const number = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  });
const id = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v === null || v === undefined ? null : String(v)));

export const jobAuthDetailsSchema = z.object({
  opening: z.object({
    job: z.object({
      info: z.object({ title: z.string() }),
      description: text,
      attachments: z.array(z.object({ fileName: text, uri: text, length: number }).nullable()).nullish(),
    }),
    questions: z.array(z.object({ question: text }).nullable()).nullish(),
  }),
  buyer: z.object({
    enterprise: z.boolean().nullish(),
    info: z
      .object({
        company: z
          .object({
            name: text,
            companyId: id,
            contractDate: text,
            profile: z.object({ industry: text, size: id }).nullish(),
          })
          .nullish(),
        location: z.object({ city: text, country: text, countryTimezone: text }).nullish(),
        stats: z
          .object({
            totalCharges: z.object({ amount: number }).nullish(),
            totalAssignments: number,
            feedbackCount: number,
          })
          .nullish(),
        jobs: z
          .object({
            postedCount: number,
            openJobs: z.array(z.object({ title: text }).nullable()).nullish(),
          })
          .nullish(),
      })
      .nullish(),
    workHistory: z
      .array(
        z
          .object({
            jobInfo: z.object({ title: text }).nullish(),
            feedback: z.object({ comment: text }).nullish(),
            feedbackToClient: z.object({ comment: text }).nullish(),
            contractorInfo: z.object({ contractorName: text }).nullish(),
          })
          .nullable(),
      )
      .nullish(),
  }),
});

export type JobAuthDetails = z.infer<typeof jobAuthDetailsSchema>;
