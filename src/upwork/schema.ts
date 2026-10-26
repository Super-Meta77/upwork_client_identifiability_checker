// FR-14 / D-10: validate the response before use. Unknown fields are stripped; only the job title and
// the buyer object are required, because every other field is legitimately empty for some clients.

import { z } from 'zod';

const text = z.string().nullish();
const comment = z.object({ comment: text }).nullish();

export const jobAuthDetailsSchema = z.object({
  opening: z.object({
    job: z.object({
      info: z.object({ title: z.string() }),
      description: text,
      attachments: z.array(z.object({ fileName: text }).nullable()).nullish(),
    }),
    questions: z.array(z.object({ question: text }).nullable()).nullish(),
  }),
  buyer: z.object({
    info: z.object({ company: z.object({ name: text }).nullish() }).nullish(),
    workHistory: z
      .array(
        z
          .object({
            feedback: comment,
            feedbackToClient: comment,
            contractorInfo: z.object({ contractorName: text }).nullish(),
          })
          .nullable(),
      )
      .nullish(),
  }),
});

export type JobAuthDetails = z.infer<typeof jobAuthDetailsSchema>;
