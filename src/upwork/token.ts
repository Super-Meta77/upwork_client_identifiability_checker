// FR-07–FR-09, D-30, D-33, NFR-08: the job-details request uses the token the user pasted in
// Settings. It is kept only in chrome.storage.session (memory) and is never logged, saved to disk,
// sent to the database, exported or shown.

export interface TokenSource {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
}

export const TOKEN_KEY = 'upworkToken';

/** A value that looks like an Upwork bearer token: an oauth2 token or a JWT. */
export function isTokenShaped(value: unknown): value is string {
  return typeof value === 'string' && (value.startsWith('oauth2v2_') || value.startsWith('eyJ'));
}

export function chromeTokenSource(): TokenSource {
  return {
    async get() {
      const value = (await chrome.storage.session.get(TOKEN_KEY))[TOKEN_KEY];
      return typeof value === 'string' && value ? value : null;
    },
    async set(token) {
      await chrome.storage.session.set({ [TOKEN_KEY]: token });
    },
    async clear() {
      await chrome.storage.session.remove(TOKEN_KEY);
    },
  };
}
