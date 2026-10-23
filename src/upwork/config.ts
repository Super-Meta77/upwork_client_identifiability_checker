// Values Phase 0 must confirm against real responses. Each one marked PROVISIONAL is a guess until
// docs/phase0-report.md says otherwise; update docs/decisions.md when one changes.

export const UPWORK_ORIGIN = 'https://www.upwork.com';

/** FR-12. The ?alias= names the operation the way Upwork's own job page does (D-29). */
export const GRAPHQL_URL = `${UPWORK_ORIGIN}/api/graphql/v1?alias=gql-query-get-auth-job-details-v2`;

/**
 * FR-08 / D-29. Cookies that may hold a token the job-details request accepts, best first, tried as
 * a fallback after the manually entered token (D-30). The 2026-10-22 probe showed
 * `oauth2_global_js_token` exists but lacks the scopes for buyer stats, jobs and reviews.
 * PROVISIONAL: confirmed and reordered from the Phase 0 probe.
 */
export const TOKEN_COOKIE_NAMES: readonly string[] = [
  'UniversalSearchNuxt_vt',
  'oauth2v2_token',
  'oauth2_global_js_token',
];

/** FR-08. The first candidate cookie; kept for the probe and the login-status line. */
export const TOKEN_COOKIE_NAME = TOKEN_COOKIE_NAMES[0]!;

/** Cookie names never tried as tokens: the visitor token has no buyer scopes (D-29). */
export const REJECTED_COOKIE_NAMES: ReadonlySet<string> = new Set(['visitor_gql_token']);

/**
 * Upwork sets some token cookies on narrow paths, so chrome.cookies.get(url:'/') misses them.
 * These are the paths the job and proposal flows use; the token lookup reads each one (D-29).
 */
export const TOKEN_COOKIE_PATHS: readonly string[] = [
  '/',
  '/nx/search/jobs/details/',
  '/nx/search/jobs/',
  '/nx/proposals/',
  '/ab/account-security/',
];

/** NFR-07. Phase 0 adds the attachment host here (and to the manifest) only if it differs. */
export const ALLOWED_HOSTS: readonly string[] = ['www.upwork.com'];

/** E-NETWORK: "No connection or timeout after 20 s". */
export const REQUEST_TIMEOUT_MS = 20_000;

/**
 * D-29: the most tokens one job-details check will try before giving up. The first token that works
 * is kept for the session, so after the first job a check normally makes a single request.
 */
export const MAX_TOKEN_ATTEMPTS = 6;

/** PROVISIONAL: whether the GraphQL id variable keeps the leading "~". */
export function toQueryId(jobId: string): string {
  return jobId;
}

/** PROVISIONAL: whether attachment downloads need the bearer token as well as the login cookies. */
export const ATTACHMENTS_NEED_TOKEN = true;
