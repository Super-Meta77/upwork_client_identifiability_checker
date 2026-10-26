import { UPWORK_ORIGIN } from './config';

const UPWORK_HOST = new URL(UPWORK_ORIGIN).hostname;

/** NFR-07: www.upwork.com is the only Upwork host the extension may contact. */
export function isAllowedUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.hostname === UPWORK_HOST;
}
