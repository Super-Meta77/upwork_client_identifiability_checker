import { ALLOWED_HOSTS, UPWORK_ORIGIN } from './config';

/** NFR-07: the only hosts the extension may contact. */
export function isAllowedUrl(url: URL): boolean {
  return url.protocol === 'https:' && ALLOWED_HOSTS.includes(url.hostname);
}

/** Resolves a possibly relative Upwork URL; returns null when it points anywhere else. */
export function resolveAllowedUrl(location: string): URL | null {
  try {
    const url = new URL(location, UPWORK_ORIGIN);
    return isAllowedUrl(url) ? url : null;
  } catch {
    return null;
  }
}
