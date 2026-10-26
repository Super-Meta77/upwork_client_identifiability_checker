// D-11 / D-12: turn an HTTP response into job data or a coded error. GraphQL errors are classified
// before schema validation, so a permission error is never mistaken for "no evidence".
// The patterns cover the real error bodies in test/fixtures/errors (probe-2026-10-22-*).

import { CheckerError } from '../core/errors';
import type { JobData } from '../core/types';
import { mapJob } from './mapper';
import { jobAuthDetailsSchema } from './schema';

interface GraphqlError {
  message?: unknown;
  path?: unknown;
  extensions?: { code?: unknown; classification?: unknown } | null;
}

const AUTH = /unauthenticated|invalid (?:access )?token|token (?:has )?expired|not logged in|login required|authentication required/i;
const FORMAT = /cannot query field|unknown (?:type|argument|field)|syntax error|validation (?:error|failed)|is not defined (?:by|on) type|must have a selection|cannot be (?:null|non-null) .*variable|variable "\$?\w+".*invalid/i;
const SCOPE = /permission|not (?:authorized|allowed)|forbidden|\bscope\b|access denied|does not have (?:the )?(?:required )?(?:access|permission)|oauth2? client/i;
const NOT_FOUND = /not found|does not exist|no such|private|invite[- ]only|is not available|no longer available|has been (?:removed|closed|deleted)/i;

function describe(e: GraphqlError): { message: string; code: string; path: string } {
  return {
    message: typeof e.message === 'string' ? e.message : '',
    code: String(e.extensions?.code ?? e.extensions?.classification ?? ''),
    path: Array.isArray(e.path) ? e.path.join('.') : '',
  };
}

export function classifyGraphqlErrors(errors: readonly GraphqlError[], hasData: boolean): CheckerError {
  const all = errors.map(describe);
  const any = (code: RegExp, message: RegExp) => all.find((e) => code.test(e.code) || message.test(e.message));

  if (any(/UNAUTHENTICATED/i, AUTH)) return new CheckerError('E-AUTH');
  const format = any(/GRAPHQL_(?:VALIDATION|PARSE)_FAILED|^ValidationError$/i, FORMAT);
  if (format) {
    // Upwork: "Validation error (FieldUndefined@[jobAuthDetails/buyer/…/contractorName]) : Field '…' is undefined"
    const at = /@\[([\w/]+)\]/.exec(format.message)?.[1]?.replace(/\//g, '.');
    const field = /field ["'`]?([\w.]+)["'`]?/i.exec(format.message)?.[1];
    return new CheckerError('E-FORMAT', format.path || at || field || 'query');
  }
  const notFound = any(/NOT_FOUND/i, NOT_FOUND);
  if (notFound && !hasData) return new CheckerError('E-NOTFOUND');
  if (any(/FORBIDDEN|PERMISSION|ACCESS_DENIED|UNAUTHORI[SZ]ED/i, SCOPE)) return new CheckerError('E-SCOPE');
  if (notFound) return new CheckerError('E-NOTFOUND');
  const first = all[0];
  return new CheckerError('E-FORMAT', first?.path || `unexpected error: ${(first?.message ?? '').slice(0, 80)}`);
}

function isJson(response: Response): boolean {
  return /json/i.test(response.headers.get('content-type') ?? '');
}

const CHALLENGE_PAGE = /\/cdn-cgi\/challenge-platform\/|<title>[^<]*(?:just a moment|attention required)[^<]*<\/title>/i;

/**
 * D-12 (revised after the Phase 0 probe): Upwork answers an invalid token with a 403 HTML page, so a
 * 403 page is a bot check only when it carries Cloudflare's challenge markers.
 */
export function isChallengePage(response: Response, body: string): boolean {
  return /challenge/i.test(response.headers.get('cf-mitigated') ?? '') || CHALLENGE_PAGE.test(body);
}

/** Reads one job-details response. Throws CheckerError with the code from the "Error handling" table. */
export async function readJobResponse(jobId: string, response: Response): Promise<JobData> {
  if (response.status === 401) throw new CheckerError('E-AUTH');
  if (response.status === 403) {
    if (isJson(response)) throw new CheckerError('E-AUTH');
    const page = await response.text().catch(() => '');
    throw new CheckerError(isChallengePage(response, page) ? 'E-BLOCKED' : 'E-AUTH');
  }
  if (response.status === 429) throw new CheckerError('E-RATE');
  if (response.status >= 500) throw new CheckerError('E-NETWORK', `HTTP ${response.status}`, { serverError: true });

  let body: { data?: { jobAuthDetails?: unknown } | null; errors?: GraphqlError[] } | null;
  try {
    body = JSON.parse(await response.text()) as typeof body;
  } catch {
    throw new CheckerError('E-FORMAT', 'response is not JSON');
  }
  if (!body || typeof body !== 'object') throw new CheckerError('E-FORMAT', 'response body');

  const details = body.data?.jobAuthDetails ?? null;
  if (Array.isArray(body.errors) && body.errors.length) throw classifyGraphqlErrors(body.errors, details !== null);
  if (response.status >= 400) throw new CheckerError('E-FORMAT', `HTTP ${response.status}`);
  if (details === null) throw new CheckerError('E-NOTFOUND');

  const parsed = jobAuthDetailsSchema.safeParse(details);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new CheckerError('E-FORMAT', issue?.path.join('.') || 'jobAuthDetails');
  }
  return mapJob(jobId, parsed.data);
}
