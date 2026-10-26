import { describe, expect, it } from 'vitest';
import { fakeChrome } from '../../test/fakes/chrome';
import { hasToken } from './index';
import { chromeTokenSource, isTokenShaped } from './token';

describe('the pasted token (FR-07–FR-09, D-30)', () => {
  it('recognises oauth2 and JWT token shapes only', () => {
    expect(isTokenShaped('oauth2v2_abcdefgh')).toBe(true);
    expect(isTokenShaped('eyJhbGciOiJ')).toBe(true);
    expect(isTokenShaped('visitor-123')).toBe(false);
    expect(isTokenShaped(null)).toBe(false);
  });

  it('keeps the token in session storage only, never on disk (NFR-08)', async () => {
    const chrome = fakeChrome();
    const source = chromeTokenSource();
    expect(await hasToken()).toBe(false);
    await source.set('abc');
    expect(await source.get()).toBe('abc');
    expect(await hasToken()).toBe(true);
    expect(chrome.storage.session.dump()).toEqual({ upworkToken: 'abc' });
    expect(chrome.storage.local.dump()).toEqual({});
    await source.clear();
    expect(await source.get()).toBeNull();
  });
});
