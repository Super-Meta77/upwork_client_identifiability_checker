export const UPWORK_ORIGIN = 'https://www.upwork.com';

/** FR-12. The ?alias= names the operation the way Upwork's own job page does (D-29). */
export const GRAPHQL_URL = `${UPWORK_ORIGIN}/api/graphql/v1?alias=gql-query-get-auth-job-details-v2`;

/** E-NETWORK: "No connection or timeout after 20 s". */
export const REQUEST_TIMEOUT_MS = 20_000;
