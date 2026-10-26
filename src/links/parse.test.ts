import { describe, expect, it } from 'vitest';
import { jobUrl, parseJobId } from './parse';

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

describe('jobUrl', () => {
  it('builds the canonical job link', () => {
    expect(jobUrl('~021234567890abcdef')).toBe('https://www.upwork.com/jobs/~021234567890abcdef');
  });
});
