// FR-07–FR-09, NFR-08: the auth token comes from the user's own Upwork login cookie and is kept
// only in chrome.storage.session (memory). It is never logged, saved elsewhere or exported.

import { TOKEN_COOKIE_NAME, UPWORK_ORIGIN } from './config';

export interface TokenSource {
  /** Last token that worked (FR-09). */
  getSession(): Promise<string | null>;
  setSession(token: string): Promise<void>;
  clearSession(): Promise<void>;
  /** FR-08: the named Upwork cookie. */
  getCookie(): Promise<string | null>;
}

const SESSION_KEY = 'upworkToken';

export function chromeTokenSource(): TokenSource {
  return {
    async getSession() {
      const items = await chrome.storage.session.get(SESSION_KEY);
      const value = items[SESSION_KEY];
      return typeof value === 'string' && value ? value : null;
    },
    async setSession(token) {
      await chrome.storage.session.set({ [SESSION_KEY]: token });
    },
    async clearSession() {
      await chrome.storage.session.remove(SESSION_KEY);
    },
    async getCookie() {
      const cookie = await chrome.cookies.get({ url: UPWORK_ORIGIN, name: TOKEN_COOKIE_NAME });
      const value = cookie?.value ? decodeURIComponent(cookie.value) : '';
      return value || null;
    },
  };
}

/** Tokens to try, in order: the last one that worked, then the cookie (if different). */
export async function candidateTokens(source: TokenSource): Promise<string[]> {
  const [session, cookie] = await Promise.all([source.getSession(), source.getCookie()]);
  return [...new Set([session, cookie].filter((t): t is string => !!t))];
}
