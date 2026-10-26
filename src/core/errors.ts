import type { ErrorCode } from './types';

/** Message shown for each error code (spec, "Error handling"). `detail` fills the placeholders. */
export function errorMessage(code: ErrorCode, detail?: string): string {
  switch (code) {
    case 'E-AUTH':
      return 'No Upwork token, or it has expired. In Settings, paste a fresh token from a logged-in job-details request, then press Run.';
    case 'E-SCOPE':
      return 'Upwork refused this request: the token lacks the needed permissions. In Settings, paste the token from a logged-in job-details request, then press Run.';
    case 'E-NOTFOUND':
      return 'Job not found, or not visible to your account.';
    case 'E-RATE':
      return `Upwork is limiting requests. Paused for ${detail ?? 'a few'} minutes.`;
    case 'E-FORMAT':
      return `Upwork's data format changed (field: ${detail ?? 'unknown'}). The extension needs an update.`;
    case 'E-NETWORK':
      return 'No connection to Upwork.';
    case 'E-STORAGE':
      return `Could not use the results database${detail ? ` (${detail})` : ''}. Check the connection and that you are signed in (Settings).`;
    case 'E-BLOCKED':
      return 'Upwork showed a check page. Complete it in the Upwork tab, then press Run.';
  }
}

/** Codes that stop checking (NFR-05, D-12). E-RATE stops only after the last backoff step. */
export const STOPPING_CODES: ReadonlySet<ErrorCode> = new Set(['E-AUTH', 'E-SCOPE', 'E-FORMAT', 'E-BLOCKED']);

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
