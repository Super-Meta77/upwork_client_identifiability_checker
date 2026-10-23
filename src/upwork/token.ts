// FR-07–FR-09, D-29, NFR-08: the auth token comes from the user's own Upwork login, and is kept
// only in chrome.storage.session (memory). It is never logged, saved to disk, exported or shown.
//
// Candidates are tried in order until one works (client.ts): the last token that worked, the token
// captured from the job page's own request (capture.ts), then the login cookies. The first that
// works is remembered in session for the rest of the browser session.

import {
  REJECTED_COOKIE_NAMES,
  TOKEN_COOKIE_NAMES,
  TOKEN_COOKIE_PATHS,
  UPWORK_ORIGIN,
} from './config';

/** A token to try, with a label for the login-status line and logs. The label holds no secret. */
export interface TokenCandidate {
  token: string;
  /** 'session' | 'captured page request' | `cookie ${name}` | 'cookie (token-shaped)'. */
  source: string;
}

export interface TokenSource {
  /** FR-09: the last token that worked, kept in memory only. */
  getSession(): Promise<string | null>;
  setSession(token: string): Promise<void>;
  clearSession(): Promise<void>;
  /** D-30: the bearer token captured from the job page's own GraphQL request, kept in memory only. */
  getCaptured(): Promise<string | null>;
  /** FR-08: the best login cookie token, for the Phase 0 probe and the status line. */
  getCookie(): Promise<string | null>;
  /** FR-08 / D-29: every login cookie that could hold a token, best first. */
  listCookieTokens(): Promise<TokenCandidate[]>;
}

const SESSION_KEY = 'upworkToken';
const CAPTURED_KEY = 'upworkCapturedToken';

/** A value that looks like an Upwork bearer token: an oauth2 token or a JWT. */
export function isTokenShaped(value: unknown): value is string {
  return typeof value === 'string' && (value.startsWith('oauth2v2_') || value.startsWith('eyJ'));
}

interface CookieLike {
  name: string;
  value: string;
  path?: string;
}

function cookieValue(cookie: CookieLike): string {
  try {
    return cookie.value ? decodeURIComponent(cookie.value) : '';
  } catch {
    return cookie.value ?? '';
  }
}

/** True for a cookie worth trying as a token: a known name, or any token-shaped value. */
function isAuthCookie(cookie: CookieLike): boolean {
  if (REJECTED_COOKIE_NAMES.has(cookie.name)) return false;
  if (!cookie.value) return false;
  return TOKEN_COOKIE_NAMES.includes(cookie.name) || isTokenShaped(cookie.value);
}

/** Known names first, in config order; then token-shaped cookies; longest path first within a name. */
function sortCookies(cookies: readonly CookieLike[]): CookieLike[] {
  const rank = (c: CookieLike) => {
    const i = TOKEN_COOKIE_NAMES.indexOf(c.name);
    return i >= 0 ? i : TOKEN_COOKIE_NAMES.length;
  };
  return [...cookies].sort((a, b) => rank(a) - rank(b) || (b.path?.length ?? 0) - (a.path?.length ?? 0));
}

function labelFor(cookie: CookieLike): string {
  return TOKEN_COOKIE_NAMES.includes(cookie.name) ? `cookie ${cookie.name}` : 'cookie (token-shaped)';
}

/**
 * Reads every Upwork login cookie that could hold a token. Prefers chrome.cookies.getAll (one query
 * for all names and paths across *.upwork.com), and falls back to a targeted get() per name and path
 * when getAll is unavailable. Returns token candidates, best first, de-duplicated by value.
 */
async function readCookieTokens(): Promise<TokenCandidate[]> {
  const found: CookieLike[] = [];

  const getAll = (chrome.cookies as { getAll?: (d: object) => Promise<CookieLike[]> }).getAll;
  if (typeof getAll === 'function') {
    for (const domain of ['upwork.com', '.upwork.com', 'www.upwork.com']) {
      try {
        found.push(...(await getAll.call(chrome.cookies, { domain })));
      } catch {
        // Some domain filters are rejected; the remaining ones still run.
      }
    }
  } else {
    for (const name of TOKEN_COOKIE_NAMES) {
      for (const path of TOKEN_COOKIE_PATHS) {
        try {
          const cookie = await chrome.cookies.get({ url: `${UPWORK_ORIGIN}${path}`, name });
          if (cookie) found.push(cookie);
        } catch {
          // Ignore a lookup that fails for one name/path; others still run.
        }
      }
    }
  }

  const candidates: TokenCandidate[] = [];
  const seen = new Set<string>();
  for (const cookie of sortCookies(found.filter(isAuthCookie))) {
    const token = cookieValue(cookie);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    candidates.push({ token, source: labelFor(cookie) });
  }
  return candidates;
}

export function chromeTokenSource(): TokenSource {
  const readMemory = async (key: string): Promise<string | null> => {
    const items = await chrome.storage.session.get(key);
    const value = items[key];
    return typeof value === 'string' && value ? value : null;
  };
  return {
    getSession: () => readMemory(SESSION_KEY),
    async setSession(token) {
      await chrome.storage.session.set({ [SESSION_KEY]: token });
    },
    async clearSession() {
      await chrome.storage.session.remove(SESSION_KEY);
    },
    getCaptured: () => readMemory(CAPTURED_KEY),
    async getCookie() {
      const [first] = await readCookieTokens();
      return first?.token ?? null;
    },
    listCookieTokens: readCookieTokens,
  };
}

/** The login source that would be tried first, by label (no token), for the status line. */
export async function loginSourceLabel(source: TokenSource): Promise<string | null> {
  const [best] = await candidateTokens(source);
  return best?.source ?? null;
}

/** The ordered, de-duplicated tokens to try (FR-09, D-29). */
export async function candidateTokens(source: TokenSource): Promise<TokenCandidate[]> {
  const [session, captured, cookies] = await Promise.all([
    source.getSession(),
    source.getCaptured(),
    source.listCookieTokens(),
  ]);
  const ordered: TokenCandidate[] = [];
  const seen = new Set<string>();
  const add = (token: string | null, source: string) => {
    if (!token || seen.has(token)) return;
    seen.add(token);
    ordered.push({ token, source });
  };
  add(session, 'session');
  add(captured, 'captured page request');
  for (const c of cookies) add(c.token, c.source);
  return ordered;
}
