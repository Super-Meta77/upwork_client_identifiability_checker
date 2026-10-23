import { describe, expect, it } from 'vitest';
import { fakeChrome } from '../../test/fakes/chrome';
import { candidateTokens, chromeTokenSource, isTokenShaped } from './token';

const JWT = 'eyJhbGciOiJ';
const OAUTH = 'oauth2v2_abcdefgh';

describe('token candidates (FR-07–FR-09, D-29)', () => {
  it('recognises oauth2 and JWT token shapes only', () => {
    expect(isTokenShaped(OAUTH)).toBe(true);
    expect(isTokenShaped(JWT)).toBe(true);
    expect(isTokenShaped('visitor-123')).toBe(false);
    expect(isTokenShaped(null)).toBe(false);
  });

  it('lists cookie tokens best-named first, decoded, de-duplicated, skipping the visitor token', async () => {
    const chrome = fakeChrome();
    chrome._cookies.set('oauth2_global_js_token', 'low%3Dscope');
    chrome._cookies.set('UniversalSearchNuxt_vt', 'best%3Dtoken');
    chrome._cookies.set('visitor_gql_token', 'nope');
    chrome._cookies.set('some_other', OAUTH); // token-shaped, unknown name: kept last
    const tokens = await chromeTokenSource().listCookieTokens();
    expect(tokens.map((t) => t.token)).toEqual(['best=token', 'low=scope', OAUTH]);
    expect(tokens.map((t) => t.source)).toEqual(['cookie UniversalSearchNuxt_vt', 'cookie oauth2_global_js_token', 'cookie (token-shaped)']);
    expect(tokens.find((t) => t.token === 'nope')).toBeUndefined();
  });

  it('orders manual entry, then session, then cookies, with no duplicates (FR-09, D-30)', async () => {
    const chrome = fakeChrome();
    chrome._cookies.set('UniversalSearchNuxt_vt', 'cookie-tok');
    await chrome.storage.session.set({ upworkManualToken: 'manual-tok', upworkToken: 'session-tok' });
    const tokens = await candidateTokens(chromeTokenSource());
    expect(tokens).toEqual([
      { token: 'manual-tok', source: 'manual entry' },
      { token: 'session-tok', source: 'session' },
      { token: 'cookie-tok', source: 'cookie UniversalSearchNuxt_vt' },
    ]);
  });

  it('keeps a token only once when the manual, session and cookie values agree', async () => {
    const chrome = fakeChrome();
    chrome._cookies.set('UniversalSearchNuxt_vt', 'same');
    await chrome.storage.session.set({ upworkManualToken: 'same', upworkToken: 'same' });
    const tokens = await candidateTokens(chromeTokenSource());
    expect(tokens).toEqual([{ token: 'same', source: 'manual entry' }]);
  });

  it('keeps the manual and session tokens in session storage only, never on disk (NFR-08)', async () => {
    const chrome = fakeChrome();
    const source = chromeTokenSource();
    await source.setSession('abc');
    await source.setManual('xyz');
    expect(chrome.storage.session.dump()).toEqual({ upworkToken: 'abc', upworkManualToken: 'xyz' });
    expect(chrome.storage.local.dump()).toEqual({});
    await source.clearManual();
    expect(await source.getManual()).toBeNull();
  });
});
