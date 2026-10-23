// D-30 (implements FR-10): capture the bearer token that Upwork's own job page sends, so a check can
// use a token with the scopes the cookie token lacks (Phase 0, 2026-10-22). The service worker only
// *reads* the Authorization header of requests the Upwork page itself makes to its GraphQL endpoint,
// and keeps the token in chrome.storage.session (memory). It blocks nothing, sends nothing, and the
// token is never logged (NFR-08). This needs the `webRequest` permission (see manifest, NFR-09).

import { GRAPHQL_PATH_PREFIX, UPWORK_ORIGIN } from './config';
import { isTokenShaped } from './token';

const CAPTURED_KEY = 'upworkCapturedToken';

interface HeaderLike {
  name: string;
  value?: string;
}

interface RequestDetailsLike {
  url: string;
  /** Who initiated the request; set by Chrome for page requests. */
  initiator?: string;
  requestHeaders?: HeaderLike[];
}

/** The bearer token in these headers, if it is token-shaped; otherwise null. No value is logged. */
export function bearerFrom(headers: readonly HeaderLike[] | undefined): string | null {
  const header = headers?.find((h) => h.name.toLowerCase() === 'authorization');
  const token = /^\s*bearer\s+(.+)$/i.exec(header?.value ?? '')?.[1]?.trim();
  return token && isTokenShaped(token) ? token : null;
}

/** True for a GraphQL request to Upwork, whatever the ?alias query string. */
export function isGraphqlRequest(url: string): boolean {
  return url.startsWith(GRAPHQL_PATH_PREFIX);
}

/**
 * The token to capture from one request, or null. Only requests the Upwork page itself made are
 * considered, so the extension never captures (and re-stores) its own request's token.
 */
export function tokenFromRequest(details: RequestDetailsLike): string | null {
  if (!isGraphqlRequest(details.url)) return null;
  if (details.initiator && !details.initiator.startsWith(UPWORK_ORIGIN)) return null;
  return bearerFrom(details.requestHeaders);
}

async function storeCaptured(token: string): Promise<void> {
  const current = await chrome.storage.session.get(CAPTURED_KEY);
  if (current[CAPTURED_KEY] === token) return;
  await chrome.storage.session.set({ [CAPTURED_KEY]: token });
}

/**
 * Registers the read-only listener in the service worker. Safe to call when webRequest is missing
 * (e.g. in tests or a build without the permission): it does nothing.
 */
export function registerTokenCapture(): void {
  const onSendHeaders = (chrome as typeof chrome & { webRequest?: typeof chrome.webRequest })
    .webRequest?.onSendHeaders;
  if (!onSendHeaders) return;

  onSendHeaders.addListener(
    (details) => {
      const token = tokenFromRequest(details);
      if (token) void storeCaptured(token).catch(() => undefined);
    },
    { urls: [`${GRAPHQL_PATH_PREFIX}/*`] },
    ['requestHeaders', 'extraHeaders'],
  );
}
