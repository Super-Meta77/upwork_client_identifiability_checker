// One check: fetch the job, analyse its attachments (FR-15), then run the analysis.

import { AttachError, errorMessage } from '../core/errors';
import type { AttachmentNote, AttachmentProps, Result } from '../core/types';
import { expectedKind, MAX_ATTACHMENTS_PER_JOB } from '../extract/props/sniff';
import type { UpworkClient } from '../upwork';
import { analyseJob, type AnalysisSettings } from './analyse';

export interface CheckSettings extends AnalysisSettings {
  attachmentsEnabled: boolean;
}

export interface CheckDeps {
  upwork: UpworkClient;
  parseAttachment: (fileName: string, bytes: Uint8Array) => Promise<AttachmentProps>;
  now: () => Date;
  newId: () => string;
}

function note(fileName: string, reason: string): AttachmentNote {
  return { fileName, code: 'E-ATTACH', message: `${errorMessage('E-ATTACH', fileName)} Reason: ${reason}.` };
}

/** Throws CheckerError for job-level failures; attachment failures become notes on the card. */
export async function checkJob(link: { jobId: string; url: string }, settings: CheckSettings, deps: CheckDeps): Promise<Result> {
  const job = await deps.upwork.fetchJob(link.jobId);
  const props: AttachmentProps[] = [];
  const notes: AttachmentNote[] = [];

  if (settings.attachmentsEnabled) {
    const supported = job.attachments.filter((a) => expectedKind(a.fileName));
    for (const a of job.attachments) {
      if (!expectedKind(a.fileName)) notes.push(note(a.fileName, 'this file type is not analysed'));
    }
    supported.slice(MAX_ATTACHMENTS_PER_JOB).forEach((a) => notes.push(note(a.fileName, `only the first ${MAX_ATTACHMENTS_PER_JOB} files of a job are analysed`)));

    for (const attachment of supported.slice(0, MAX_ATTACHMENTS_PER_JOB)) {
      try {
        const bytes = await deps.upwork.downloadAttachment(attachment);
        props.push(await deps.parseAttachment(attachment.fileName, bytes));
      } catch (error) {
        if (!(error instanceof AttachError)) throw error;
        notes.push(note(attachment.fileName, error.reason));
      }
      // Files stay in memory only until this job's analysis ends (FR-15).
    }
  }

  return analyseJob({ job, url: link.url, props, attachmentNotes: notes, settings, now: deps.now(), newId: deps.newId });
}
