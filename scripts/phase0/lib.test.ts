import { describe, expect, it } from 'vitest';
import { jobFixture } from '../../test/fixtures';
import { analyzeHar, anonymise, buildMapping, cookieNamesForToken, fakeFor, findLeaks, pathPattern, replaceAll, type HarEntry } from './lib';

const TOKEN = 'oauth-secret-value-123456';

function entry(over: { url?: string; body?: unknown; response?: unknown; status?: number; headers?: { name: string; value: string }[]; cookies?: { name: string; value: string }[] }): HarEntry {
  return {
    request: {
      method: 'POST',
      url: over.url ?? 'https://www.upwork.com/api/graphql/v1?alias=gql-query-get-auth-job-details',
      headers: over.headers ?? [
        { name: 'Authorization', value: `Bearer ${TOKEN}` },
        { name: 'X-Upwork-Accept-Language', value: 'en-US' },
      ],
      cookies: over.cookies ?? [
        { name: 'session_id', value: 'abc' },
        { name: 'some_global_token', value: encodeURIComponent(TOKEN) },
      ],
      postData: { text: JSON.stringify(over.body ?? { query: 'query Q($id: ID!) { jobAuthDetails(id: $id) { opening { job { info { title } } } } }', variables: { id: '~021234567890' } }) },
    },
    response: {
      status: over.status ?? 200,
      headers: [{ name: 'content-type', value: 'application/json' }],
      content: { text: Buffer.from(JSON.stringify(over.response ?? jobFixture('synthetic-01-s1-company'))).toString('base64'), encoding: 'base64' },
    },
  };
}

describe('HAR analysis (Phase 0)', () => {
  it('names the cookie that holds the bearer token without printing values', () => {
    expect(cookieNamesForToken([entry({})], TOKEN)).toEqual(['some_global_token']);
    const { report } = analyzeHar([entry({})], []);
    expect(report).toContain('**some_global_token**');
    expect(report).not.toContain(TOKEN);
    expect(report).toContain('authorization');
    expect(report).toContain('alias=gql-query-get-auth-job-details');
    expect(report).toContain('string "~02…"');
  });

  it('reports fill rate, sizes and errors, keeping client names out of the report', () => {
    const errorEntry = entry({ response: { errors: [{ message: 'Requested oAuth2 client does not have permission', path: ['jobAuthDetails'], extensions: { code: 'FORBIDDEN' } }] } });
    const { report, trimmed, privateNotes, query } = analyzeHar([entry({}), entry({ response: jobFixture('synthetic-02-intro-and-website') }), errorEntry], ['https://www.upwork.com/jobs/Some-title_~01abcdef123456', 'https://www.upwork.com/freelancers/~01abc']);
    expect(report).toContain('company.name filled (not a placeholder): **1 of 2**');
    expect(report).toContain('| N/A | 1 |');
    expect(report).not.toContain('Northwind');
    expect(report).toContain('FORBIDDEN');
    expect(report).toContain('accepted by the link parser: **1**');
    expect(report).toContain('www.upwork.com/jobs/<slug>_~ID');
    expect(privateNotes).toContain('Northwind Traders');
    expect(trimmed).toHaveLength(2);
    expect(query).toContain('jobAuthDetails');
  });

  it('turns paths into patterns', () => {
    expect(pathPattern('https://www.upwork.com/nx/search/jobs/details/~01abc?x=1')).toBe('www.upwork.com/nx/search/jobs/details/~ID');
    expect(pathPattern('https://www.upwork.com/att/download/openings/123456789/attachments/abcdef0123456789abcd/download')).toBe('www.upwork.com/att/download/openings/:n/attachments/:hex/download');
    expect(pathPattern('nope')).toBe('(not a URL)');
  });
});

describe('anonymisation (Phase 0)', () => {
  it('keeps the shape of names and companies, deterministically', () => {
    expect(fakeFor({ kind: 'person', value: 'John P.' })).toMatch(/^\p{Lu}\p{Ll}+ \p{Lu}\.$/u);
    expect(fakeFor({ kind: 'person', value: 'Sarah' })).toMatch(/^\p{Lu}\p{Ll}+$/u);
    expect(fakeFor({ kind: 'company', value: 'Northwind Traders Ltd' })).toMatch(/ Ltd$/);
    expect(fakeFor({ kind: 'domain', value: 'acme.com' })).toBe(fakeFor({ kind: 'domain', value: 'acme.com' }));
  });

  it('replaces every entity consistently and leaves no leaks', () => {
    const bodies = [jobFixture('synthetic-01-s1-company'), jobFixture('synthetic-06-reviews'), jobFixture('synthetic-08-extra-fields'), jobFixture('synthetic-02-intro-and-website')];
    const mapping = buildMapping(bodies);
    const out = bodies.map((b, i) => JSON.stringify(anonymise(b, mapping, i + 1)));
    const originals = ['Northwind Traders', 'Ahmed', 'Sarah', 'John P.', 'Lena M.', 'Dana Whitfield', 'crumbandco.com', 'Fabrikam Studio', 'fabrikam-studio.pt', 'Leeds', 'Austin'];
    for (const text of out) expect(findLeaks(text, originals)).toEqual([]);
    expect(out[1]).toContain(mapping.get('Sarah'));
    expect(out[0]).toMatch(/"companyId":"1100000000\d{9}"/);
    expect(out[0]).not.toContain('1100000000000000001');
  });

  it('replaces whole words only', () => {
    const m = new Map([['Ann', 'Wren']]);
    expect(replaceAll('Ann and Annual planning with ann', m)).toBe('Wren and Annual planning with Wren');
    expect(replaceAll('nothing', new Map())).toBe('nothing');
  });

  it('finds leaks by whole word, ignoring short values', () => {
    expect(findLeaks('{"a":"hello Sarah"}', ['Sarah', 'Al', 'Sar'])).toEqual(['Sarah']);
  });
});
