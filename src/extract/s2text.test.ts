import { describe, expect, it } from 'vitest';
import { job } from '../../test/builders';
import { extractS2Text, scanText } from './s2text';

const values = (text: string, withSignOff = false) => scanText(text, undefined, withSignOff).map((d) => [d.detector, d.value, d.ownershipCue]);

describe('S2 text — websites (FR-17, D-04)', () => {
  it('finds a website with an ownership phrase', () => {
    expect(values('Please review our website at https://www.acme-logistics.com/about before applying.')).toEqual([
      ['S2T-website', 'acme-logistics.com', true],
    ]);
  });

  it('marks a third-party website as having no ownership phrase', () => {
    expect(values('Build a booking site similar to rivalbookings.com with a cleaner design.')).toEqual([
      ['S2T-website', 'rivalbookings.com', false],
    ]);
  });

  it('ignores upwork.com and generic sites', () => {
    expect(values('Our site runs on Shopify (shopify.com); see https://www.upwork.com/jobs and github.com/x/y')).toEqual([]);
  });

  it('ignores library names, file names and extension look-alikes', () => {
    expect(values('Use Node.js and Vue.js, send logo.ai and brief.pdf, ASP.NET experience, e.g. i.e.')).toEqual([]);
  });

  it('detects "acme.com (our website)" and "acme.io is our product"', () => {
    expect(values('Check acme.com (our website) first.')[0]).toEqual(['S2T-website', 'acme.com', true]);
    expect(values('northwind.io is our product.')[0]).toEqual(['S2T-website', 'northwind.io', true]);
  });

  it('handles two-part suffixes', () => {
    expect(values('Visit us at shop.acme.co.uk')[0]).toEqual(['S2T-website', 'acme.co.uk', true]);
  });
});

describe('S2 text — emails (D-06)', () => {
  it('records an email and its domain as a website', () => {
    expect(values('Send samples to jane.doe@acme-logistics.com please.')).toEqual([
      ['S2T-email', 'jane.doe@acme-logistics.com', false],
      ['S2T-email-domain', 'acme-logistics.com', false],
    ]);
  });

  it('does not record a free-mail domain as a website', () => {
    expect(values('Contact me at jane.doe@gmail.com')).toEqual([['S2T-email', 'jane.doe@gmail.com', false]]);
  });
});

describe('S2 text — company names (D-04, D-05)', () => {
  it('finds a legal-ending company with an ownership phrase', () => {
    expect(values('At Northwind Traders Ltd, we ship furniture across Europe.')).toEqual([
      ['S2T-company-legal', 'Northwind Traders Ltd', true],
    ]);
  });

  it('finds a legal-ending company without an ownership phrase', () => {
    expect(values('Experience integrating with Contoso Payments Inc. is a plus.')).toEqual([
      ['S2T-company-legal', 'Contoso Payments Inc.', false],
    ]);
  });

  it('handles "Name, Inc." and connectors', () => {
    expect(values('Smith & Sons, LLC needs a bookkeeper.')[0]?.[1]).toBe('Smith & Sons, LLC');
    expect(values('The Bank of Fabrikam Corp is rebuilding its site.')[0]?.[1]).toBe('Bank of Fabrikam Corp');
  });

  it('ignores endings with no capitalised name before them', () => {
    expect(values('We want to form an LLC in Delaware. Create LLC paperwork.')).toEqual([]);
  });

  it('finds "we are X" and stops at punctuation', () => {
    expect(values('Hello! We are Fabrikam Studio, a design agency in Austin.')).toEqual([
      ['S2T-company-intro', 'Fabrikam Studio', true],
    ]);
  });

  it('finds "our company X" with a legal ending', () => {
    expect(values('Our company Tailspin Toys Ltd. makes wooden toys.')).toEqual([
      ['S2T-company-intro', 'Tailspin Toys Ltd.', true],
      ['S2T-company-legal', 'Tailspin Toys Ltd.', true],
    ]);
  });

  it('ignores "We are looking…" and other ordinary words (D-05)', () => {
    expect(values('We are looking for a React developer. We are Looking For Help. We are US-based.')).toEqual([]);
    expect(values('We Are Excited To Hire You')).toEqual([]);
  });

  it('finds "I am the founder of X"', () => {
    expect(values("I'm the founder of Litware Labs and need help.")[0]).toEqual(['S2T-company-intro', 'Litware Labs', true]);
  });
});

describe('S2 text — self-introductions and sign-offs (D-07)', () => {
  it('finds "My name is" with a full name', () => {
    expect(values('Hi, my name is Dana Whitfield and I run a bakery.')).toEqual([['S2T-person', 'Dana Whitfield', true]]);
  });

  it('accepts "I\'m X" only for a known first name', () => {
    expect(values("I'm Sarah, the product owner.")).toEqual([['S2T-person', 'Sarah', true]]);
    expect(values("I'm Hopeful this works. I am Senior staff.")).toEqual([]);
  });

  it('finds a sign-off at the end of the description', () => {
    expect(values('Please send examples of past work.\n\nThanks,\nMaria', true)).toEqual([['S2T-person', 'Maria', true]]);
    expect(values('Looking forward to it. Best regards, Tom Baker', true)).toEqual([['S2T-person', 'Tom Baker', true]]);
    expect(values('Details in the brief.\n- Priya', true)).toEqual([['S2T-person', 'Priya', true]]);
  });

  it('ignores team sign-offs and sign-offs outside the description', () => {
    expect(values('Thanks, The Team', true)).toEqual([]);
    expect(values('Thanks,\nMaria')).toEqual([]);
  });
});

describe('extractS2Text', () => {
  it('returns nothing for an empty job', () => {
    expect(extractS2Text(job({ title: '', description: '', questions: [] }))).toEqual([]);
  });

  it('scans title, description and questions, with locations and snippets', () => {
    const findings = extractS2Text(
      job({
        title: 'Shopify theme fixes for acme-outdoor.com',
        description: 'Our store acme-outdoor.com needs speed fixes.',
        questions: ['Have you worked with Contoso Inc. before?'],
      }),
    );
    const site = findings.find((f) => f.kind === 'website');
    expect(site).toMatchObject({ value: 'acme-outdoor.com', mentions: 2, ownershipCue: true, location: 'opening.job.description' });
    expect(site?.snippet).toContain('Our store acme-outdoor.com');
    expect(findings.find((f) => f.kind === 'company_name')).toMatchObject({ location: 'opening.questions[0].question', value: 'Contoso Inc.' });
  });

  it('keeps 60 characters of context on each side', () => {
    const long = `${'x'.repeat(100)} visit our site acme.com ${'y'.repeat(100)}`;
    const [f] = extractS2Text(job({ description: long }));
    expect(f?.snippet.startsWith('…')).toBe(true);
    expect(f?.snippet.endsWith('…')).toBe(true);
    expect(f!.snippet.length).toBeLessThanOrEqual(60 * 2 + 'acme.com'.length + 2);
  });

  it('applies extra generic sites and legal endings from settings', () => {
    const options = { genericSites: new Set(['acme.com']), legalEndings: ['Sàrl'] };
    expect(scanText('Visit our site acme.com. We trade as Globex Sàrl here.', options).map((d) => d.value)).toEqual(['Globex Sàrl']);
  });
});
