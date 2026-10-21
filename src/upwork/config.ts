// Values Phase 0 must confirm against real responses. Each one marked PROVISIONAL is a guess until
// docs/phase0-report.md says otherwise; update docs/decisions.md when one changes.

export const UPWORK_ORIGIN = 'https://www.upwork.com';

/** FR-12 */
export const GRAPHQL_URL = `${UPWORK_ORIGIN}/api/graphql/v1`;

/** FR-08. PROVISIONAL: the cookie that holds a token accepted by the job-details request. */
export const TOKEN_COOKIE_NAME = 'oauth2_global_js_token';

/** NFR-07. Phase 0 adds the attachment host here (and to the manifest) only if it differs. */
export const ALLOWED_HOSTS: readonly string[] = ['www.upwork.com'];

/** E-NETWORK: "No connection or timeout after 20 s". */
export const REQUEST_TIMEOUT_MS = 20_000;

/** PROVISIONAL: whether the GraphQL id variable keeps the leading "~". */
export function toQueryId(jobId: string): string {
  return jobId;
}

/** PROVISIONAL: whether attachment downloads need the bearer token as well as the login cookies. */
export const ATTACHMENTS_NEED_TOKEN = true;
