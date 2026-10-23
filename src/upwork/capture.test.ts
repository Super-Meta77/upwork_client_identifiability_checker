import { describe, expect, it } from 'vitest';
import { bearerFrom, isGraphqlRequest, tokenFromRequest } from './capture';

const OAUTH = 'oauth2v2_pagetoken';

describe('page-token capture (D-30, FR-10)', () => {
  it('reads a token-shaped bearer from the Authorization header, case-insensitively', () => {
    expect(bearerFrom([{ name: 'Authorization', value: `Bearer ${OAUTH}` }])).toBe(OAUTH);
    expect(bearerFrom([{ name: 'authorization', value: `bearer ${OAUTH}` }])).toBe(OAUTH);
  });

  it('ignores a missing, non-bearer or non-token-shaped Authorization header', () => {
    expect(bearerFrom(undefined)).toBeNull();
    expect(bearerFrom([{ name: 'accept', value: 'application/json' }])).toBeNull();
    expect(bearerFrom([{ name: 'Authorization', value: 'Basic abc123' }])).toBeNull();
    expect(bearerFrom([{ name: 'Authorization', value: 'Bearer visitor-xyz' }])).toBeNull();
  });

  it('matches any Upwork GraphQL request whatever the ?alias', () => {
    expect(isGraphqlRequest('https://www.upwork.com/api/graphql/v1?alias=something')).toBe(true);
    expect(isGraphqlRequest('https://www.upwork.com/api/graphql')).toBe(true);
    expect(isGraphqlRequest('https://www.upwork.com/nx/search/jobs/')).toBe(false);
  });

  it('captures only from a GraphQL request the Upwork page itself made', () => {
    const headers = [{ name: 'Authorization', value: `Bearer ${OAUTH}` }];
    expect(tokenFromRequest({ url: 'https://www.upwork.com/api/graphql/v1?alias=x', initiator: 'https://www.upwork.com', requestHeaders: headers })).toBe(OAUTH);
    // The extension's own request (chrome-extension:// initiator) is not captured.
    expect(tokenFromRequest({ url: 'https://www.upwork.com/api/graphql/v1', initiator: 'chrome-extension://abc', requestHeaders: headers })).toBeNull();
    // A non-GraphQL request is not captured.
    expect(tokenFromRequest({ url: 'https://www.upwork.com/nx/search/jobs/', initiator: 'https://www.upwork.com', requestHeaders: headers })).toBeNull();
  });
});
