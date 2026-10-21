import { describe, expect, it } from 'vitest';
import { MAX_LINKS_PER_BATCH, parseJobId, parseLinks } from './parse';

const ID = '~01a2b3c4d5e6f7a8b9';
const ID2 = '~021843675512345678';
const NORMAL = `https://www.upwork.com/jobs/${ID}`;

describe('parseJobId — accepted job paths (FR-03)', () => {
  it.each([
    ['/jobs/~ID', `https://www.upwork.com/jobs/${ID}`],
    ['/jobs/<slug>_~ID', `https://www.upwork.com/jobs/React-developer-needed_${ID}`],
    ['/nx/search/jobs/details/~ID', `https://www.upwork.com/nx/search/jobs/details/${ID}`],
    ['/freelance-jobs/apply/<slug>_~ID', `https://www.upwork.com/freelance-jobs/apply/Logo-design_${ID}`],
    ['/nx/proposals/job/~ID', `https://www.upwork.com/nx/proposals/job/${ID}`],
  ])('%s', (_label, link) => {
    expect(parseJobId(link)).toBe(ID);
  });

  it('accepts ~02 job IDs (no hardcoded ~01 prefix)', () => {
    expect(parseJobId(`https://www.upwork.com/jobs/${ID2}`)).toBe(ID2);
  });

  it('ignores query strings', () => {
    expect(parseJobId(`${NORMAL}?referrer_url_path=/nx/search/jobs&source=rss`)).toBe(ID);
  });

  it('ignores fragments', () => {
    expect(parseJobId(`${NORMAL}#apply`)).toBe(ID);
  });

  it('ignores a trailing slash', () => {
    expect(parseJobId(`${NORMAL}/`)).toBe(ID);
  });

  it('ignores a trailing slash before a query string', () => {
    expect(parseJobId(`https://www.upwork.com/nx/search/jobs/details/${ID}/?pageTitle=Job`)).toBe(ID);
  });

  it('accepts upper case and lowercases the ID (D-17)', () => {
    expect(parseJobId(`HTTPS://WWW.UPWORK.COM/JOBS/${ID.toUpperCase()}`)).toBe(ID);
  });

  it('accepts upwork.com without www (D-17)', () => {
    expect(parseJobId(`https://upwork.com/jobs/${ID}`)).toBe(ID);
  });

  it('accepts http and normalises it (D-17)', () => {
    expect(parseJobId(`http://www.upwork.com/jobs/${ID}`)).toBe(ID);
  });

  it('accepts a link pasted without a scheme', () => {
    expect(parseJobId(`www.upwork.com/jobs/${ID}`)).toBe(ID);
  });

  it('accepts surrounding whitespace and angle brackets', () => {
    expect(parseJobId(`  <${NORMAL}>  `)).toBe(ID);
  });
});

describe('parseJobId — rejected links (FR-04)', () => {
  it.each([
    ['freelancer profile', `https://www.upwork.com/freelancers/${ID}`],
    ['freelancer profile with slug', `https://www.upwork.com/freelancers/janedoe${ID}`],
    ['agency profile', `https://www.upwork.com/agencies/${ID}`],
    ['company page', `https://www.upwork.com/companies/${ID}`],
    ['other host', `https://www.example.com/jobs/${ID}`],
    ['look-alike host', `https://www.upwork.com.evil.example/jobs/${ID}`],
    ['subdomain', `https://community.upwork.com/jobs/${ID}`],
    ['ftp scheme', `ftp://www.upwork.com/jobs/${ID}`],
    ['javascript scheme', `javascript:alert('${ID}')`],
    ['credentials in URL', `https://user:pass@www.upwork.com/jobs/${ID}`],
    ['custom port', `https://www.upwork.com:8443/jobs/${ID}`],
    ['job path without ID', 'https://www.upwork.com/jobs/'],
    ['ID too short', 'https://www.upwork.com/jobs/~01'],
    ['ID with symbols', 'https://www.upwork.com/jobs/~01abc$def!ghi'],
    ['extra path segment', `https://www.upwork.com/jobs/${ID}/apply`],
    ['search page', 'https://www.upwork.com/nx/search/jobs/?q=react'],
    ['not a URL', 'hello world'],
    ['bare ID', ID],
  ])('%s', (_label, link) => {
    expect(parseJobId(link)).toBeNull();
  });
});

describe('parseLinks (FR-01, FR-02, FR-05, FR-06)', () => {
  it('normalises every accepted link to https://www.upwork.com/jobs/~ID', () => {
    const result = parseLinks(`https://www.upwork.com/nx/search/jobs/details/${ID}?x=1`);
    expect(result.links).toEqual([{ line: 1, input: expect.any(String), jobId: ID, url: NORMAL }]);
  });

  it('ignores blank lines and keeps line numbers', () => {
    const result = parseLinks(`\n\n${NORMAL}\n   \nhttps://www.upwork.com/jobs/${ID2}\n`);
    expect(result.links.map((l) => l.line)).toEqual([3, 5]);
    expect(result.errors).toEqual([]);
  });

  it('removes duplicates by job ID, across different link forms', () => {
    const result = parseLinks(
      [NORMAL, `https://www.upwork.com/jobs/Some-slug_${ID}`, `${NORMAL.toUpperCase()}`].join('\n'),
    );
    expect(result.links).toHaveLength(1);
    expect(result.duplicates).toBe(2);
  });

  it('reports invalid links as E-LINK rows without stopping the rest', () => {
    const result = parseLinks([`https://www.upwork.com/freelancers/${ID}`, NORMAL, 'nonsense'].join('\n'));
    expect(result.links.map((l) => l.jobId)).toEqual([ID]);
    expect(result.errors).toEqual([
      expect.objectContaining({ line: 1, code: 'E-LINK' }),
      expect.objectContaining({ line: 3, code: 'E-LINK' }),
    ]);
    expect(result.errors[0]?.message).toContain('/jobs/');
  });

  it('accepts at most 50 links per batch', () => {
    const lines = Array.from({ length: 53 }, (_, i) => `https://www.upwork.com/jobs/~01${String(i).padStart(16, '0')}`);
    const result = parseLinks(lines.join('\n'));
    expect(result.links).toHaveLength(MAX_LINKS_PER_BATCH);
    expect(result.overLimit).toBe(3);
  });

  it('handles Windows line endings', () => {
    expect(parseLinks(`${NORMAL}\r\nhttps://www.upwork.com/jobs/${ID2}\r\n`).links).toHaveLength(2);
  });
});
