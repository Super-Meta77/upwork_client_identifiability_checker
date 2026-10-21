import type { ErrorCode } from './types';

/** Message shown for each error code (spec, "Error handling"). `detail` fills the placeholders. */
export function errorMessage(code: ErrorCode, detail?: string): string {
  switch (code) {
    case 'E-LINK':
      return 'Not an Upwork job link. Paste a link that contains /jobs/ and a ~ID.';
    case 'E-AUTH':
      return 'Log in to Upwork in this Chrome profile, then press Retry.';
    case 'E-SCOPE':
      return 'Upwork refused this request with the current login. Open any Upwork job page once, then press Retry.';
    case 'E-NOTFOUND':
      return 'Job not found, or not visible to your account.';
    case 'E-RATE':
      return `Upwork is limiting requests. Paused for ${detail ?? 'a few'} minutes.`;
    case 'E-FORMAT':
      return `Upwork's data format changed (field: ${detail ?? 'unknown'}). The extension needs an update.`;
    case 'E-ATTACH':
      return `This attachment could not be analysed: ${detail ?? 'unknown file'}.`;
    case 'E-NETWORK':
      return 'No connection to Upwork.';
    case 'E-STORAGE':
      return 'Could not save results. Export them, then delete old results.';
    case 'E-BLOCKED':
      return 'Upwork showed a check page. Open upwork.com in a tab, complete it, then press Retry.';
  }
}

/** Codes that stop a batch (NFR-05, D-12). E-RATE stops only after the last backoff step. */
export const STOPPING_CODES: ReadonlySet<ErrorCode> = new Set(['E-AUTH', 'E-SCOPE', 'E-FORMAT', 'E-BLOCKED']);

/** E-ATTACH: one attachment could not be analysed. The job continues without it. */
export class AttachError extends Error {
  readonly fileName: string;
  readonly reason: string;
  constructor(fileName: string, reason: string) {
    super(`${fileName}: ${reason}`);
    this.name = 'AttachError';
    this.fileName = fileName;
    this.reason = reason;
  }
}

export class CheckerError extends Error {
  readonly code: ErrorCode;
  readonly detail: string | undefined;
  /** Set for HTTP 5xx so the runner can count "3 server errors in a row" as E-RATE. */
  readonly serverError: boolean;

  constructor(code: ErrorCode, detail?: string, options: { serverError?: boolean } = {}) {
    super(errorMessage(code, detail));
    this.name = 'CheckerError';
    this.code = code;
    this.detail = detail;
    this.serverError = options.serverError ?? false;
  }
}
