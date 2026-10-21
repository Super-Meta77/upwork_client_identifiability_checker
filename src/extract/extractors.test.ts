import { describe, expect, it } from 'vitest';
import type { AttachmentProps } from '../core/types';
import { job } from '../../test/builders';
import { extractAll, scanOptions } from './index';
import { isPlaceholderCompanyName } from './lists/placeholders';
import { isSoftwareOrDefault } from './lists/software-names';
import { isSmallestCompanySize } from './lists/company-sizes';
import { extractS1 } from './s1';
import { extractS2File } from './s2file';
import { cleanCopyright, extractS2Props } from './s2props';
import { clientProfile, DEFAULT_S3_POINTS, memberSinceYear, scoreS3 } from './s3';
import { cleanName, extractS5, namesInReview } from './s5';

describe('S1 (FR-16, D-09)', () => {
  it('reports a filled company name', () => {
    expect(extractS1(job({ buyer: { companyName: '  Northwind   Traders ' } }))).toEqual([
      expect.objectContaining({ source: 'S1', detector: 'S1-company', kind: 'company_name', value: 'Northwind Traders', location: 'buyer.info.company.name' }),
    ]);
  });

  it.each([null, '', '   ', 'N/A', 'private', '-', '...', '12', 'Me', 'Individual'])('ignores %j', (companyName) => {
    expect(extractS1(job({ buyer: { companyName } }))).toEqual([]);
  });

  it('treats placeholder shapes as empty', () => {
    expect(isPlaceholderCompanyName('Self-employed')).toBe(true);
    expect(isPlaceholderCompanyName('Acme')).toBe(false);
  });
});

describe('S2 file names (FR-18)', () => {
  const files = (...names: string[]) => job({ attachments: names.map((fileName) => ({ fileName, uri: null, length: 1 })) });

  it('reports a website in a file name', () => {
    expect(extractS2File(files('acme-logistics.com_brief.pdf'))).toEqual([
      expect.objectContaining({ source: 'S2-file', kind: 'website', value: 'acme-logistics.com', location: 'attachment acme-logistics.com_brief.pdf > file name' }),
    ]);
  });

  it('reports consecutive unusual capitalised words as one name', () => {
    expect(extractS2File(files('Northwind_Traders_Project_Brief_v2.docx')).map((f) => f.value)).toEqual(['Northwind Traders']);
    expect(extractS2File(files('FabrikamLogo-Final.png')).map((f) => f.value)).toEqual(['Fabrikam']);
  });

  it('ignores ordinary file names', () => {
    expect(extractS2File(files('Project Brief.pdf', 'IMG_20240211_1033.jpg', 'Logo Final v3.png', 'requirements.docx', 'NDA.pdf'))).toEqual([]);
  });

  it('returns nothing without attachments', () => {
    expect(extractS2File(job())).toEqual([]);
  });
});

const props = (fileType: AttachmentProps['fileType'], entries: [AttachmentProps['entries'][number]['field'], string][]): AttachmentProps => ({
  fileName: 'brief.docx',
  fileType,
  entries: entries.map(([field, value]) => ({ field, value, location: `attachment brief.docx > ${field}` })),
});

describe('S2 file properties (FR-19, D-07)', () => {
  it('reports the Office Company as a company name', () => {
    expect(extractS2Props([props('office', [['office.Company', 'Northwind Traders Ltd']])])).toEqual([
      expect.objectContaining({ source: 'S2-props', detector: 'S2P-company', kind: 'company_name', value: 'Northwind Traders Ltd' }),
    ]);
  });

  it('reports authors by word count; Manager is a person (D-07)', () => {
    const out = extractS2Props([
      props('office', [['office.creator', 'Dana Whitfield'], ['office.Manager', 'Tom'], ['office.lastModifiedBy', 'Acme Ltd']]),
    ]);
    expect(out.map((f) => [f.detector, f.kind, f.value])).toEqual([
      ['S2P-person', 'person_full_name', 'Dana Whitfield'],
      ['S2P-person', 'person_first_name', 'Tom'],
      ['S2P-person', 'company_name', 'Acme Ltd'],
    ]);
  });

  it('reports PDF Author and Creator and EXIF Artist', () => {
    const out = extractS2Props([
      props('pdf', [['pdf.Author', 'Maria Lopez'], ['pdf.Creator', 'Microsoft® Word for Microsoft 365']]),
      props('jpeg', [['exif.Artist', 'Kenji']]),
    ]);
    expect(out.map((f) => [f.kind, f.value])).toEqual([
      ['person_full_name', 'Maria Lopez'],
      ['person_first_name', 'Kenji'],
    ]);
  });

  it('cleans EXIF Copyright into a company or person (D-07)', () => {
    expect(cleanCopyright('© 2023-2024 Fabrikam Studio Ltd. All rights reserved.')).toBe('Fabrikam Studio Ltd');
    const out = extractS2Props([props('jpeg', [['exif.Copyright', '(c) 2024 Fabrikam Studio Ltd']]), props('jpeg', [['exif.Copyright', 'Copyright Lee']])]);
    expect(out.map((f) => [f.detector, f.kind, f.value])).toEqual([
      ['S2P-copyright', 'company_name', 'Fabrikam Studio Ltd'],
      ['S2P-copyright', 'person_first_name', 'Lee'],
    ]);
  });

  it('keeps only websites and company names from titles, at the title rule', () => {
    const out = extractS2Props([props('pdf', [['pdf.Title', 'Brand guide for northwind-traders.com']]), props('pdf', [['pdf.Title', 'Project Brief']])]);
    expect(out.map((f) => [f.detector, f.kind, f.value])).toEqual([['S2P-title', 'website', 'northwind-traders.com']]);
  });

  it('records an email in an author field as an email', () => {
    expect(extractS2Props([props('pdf', [['pdf.Author', 'dana@northwind.com']])])[0]).toMatchObject({ kind: 'email', value: 'dana@northwind.com' });
  });

  it.each(['User', 'Admin', 'Microsoft Office User', 'Adobe Acrobat Pro DC 23.1', 'Word', 'python-docx', '   '])('ignores default %j', (value) => {
    expect(isSoftwareOrDefault(value)).toBe(true);
    expect(extractS2Props([props('office', [['office.creator', value], ['office.Company', value]])])).toEqual([]);
  });

  it('keeps company names that contain a product-like word', () => {
    expect(isSoftwareOrDefault('Pixel Labs Ltd')).toBe(false);
  });

  it('returns nothing for files with no properties', () => {
    expect(extractS2Props([props('pdf', [])])).toEqual([]);
    expect(extractS2Props([])).toEqual([]);
  });
});

describe('S5 reviews (FR-20)', () => {
  const history = (items: { toClient?: string; fromClient?: string; contractor?: string }[]) =>
    job({
      buyer: {
        workHistory: items.map((i) => ({
          jobTitle: 'Some job',
          feedbackToClientComment: i.toClient ?? null,
          feedbackComment: i.fromClient ?? null,
          contractorName: i.contractor ?? null,
        })),
      },
    });

  it('counts a first name mentioned in two reviews as Medium-eligible (mentions 2)', () => {
    const out = extractS5(history([
      { toClient: 'Working with Sarah was a pleasure.', contractor: 'Ahmed K.' },
      { toClient: 'Sarah gave clear instructions. Thanks Sarah!', contractor: 'Lena M.' },
    ]));
    expect(out).toEqual([expect.objectContaining({ source: 'S5', kind: 'person_first_name', value: 'Sarah', mentions: 2, location: 'buyer.workHistory[0].feedbackToClient.comment' })]);
  });

  it('removes every name that matches a freelancer in the same work history', () => {
    const out = extractS5(history([
      { fromClient: 'John P. did excellent work.', contractor: 'John P.' },
      { toClient: 'Great client. John was helpful too.', contractor: 'Mike R.' },
      { fromClient: 'Mike delivered on time.', contractor: 'Mike R.' },
    ]));
    expect(out).toEqual([]);
  });

  it('reports full names separately from first names', () => {
    const out = extractS5(history([{ toClient: 'Sarah Kim is a fantastic client.' }, { toClient: 'Thanks Sarah for the quick replies.' }]));
    expect(out.map((f) => [f.kind, f.value, f.mentions])).toEqual([
      ['person_full_name', 'Sarah Kim', 1],
      ['person_first_name', 'Sarah', 2],
    ]);
  });

  it('cleans names and ignores ordinary words', () => {
    expect(cleanName('Mr. Smith!')).toBe('Smith');
    expect(cleanName('John P.')).toBe('John');
    expect(namesInReview('Great job, will hire again in May.')).toEqual([]);
  });

  it('returns nothing without reviews', () => {
    expect(extractS5(job())).toEqual([]);
    expect(extractS5(history([{ toClient: '   ' }]))).toEqual([]);
  });
});

describe('S3 distinctiveness (FR-21)', () => {
  it('scores 0 with no trust details', () => {
    expect(scoreS3(job())).toEqual({ score: 0, attributes: [], details: [] });
  });

  it('adds the points of each present attribute, capped at 100', () => {
    const rich = job({
      buyer: {
        city: 'Tromsø', industry: 'Fisheries', size: '1', contractDate: '2016-04-01', enterprise: true,
        totalCharges: 1234.5, totalAssignments: 7, openJobTitles: ['a', 'b', 'c'],
        workHistory: Array.from({ length: 5 }, () => ({ jobTitle: 'Past job', feedbackComment: null, feedbackToClientComment: null, contractorName: null })),
      },
    });
    const s3 = scoreS3(rich);
    expect(s3.score).toBe(100);
    expect(s3.attributes).toEqual(['city', 'industry', 'company_size', 'smallest_size', 'member_since', 'open_jobs', 'past_jobs', 'enterprise', 'spend_and_hires']);
    expect(s3.details.find((d) => d.attribute === 'spend_and_hires')?.value).toBe('$1,235 spent, 7 hires');
  });

  it('uses the configured points and never outputs a name', () => {
    const s3 = scoreS3(job({ buyer: { city: 'Austin', companyName: 'Acme Ltd' } }), { ...DEFAULT_S3_POINTS, city: 40 });
    expect(s3.score).toBe(40);
    expect(JSON.stringify(s3)).not.toContain('Acme');
  });

  it('counts open and past jobs only above their minimums', () => {
    const s3 = scoreS3(job({ buyer: { openJobTitles: ['a', 'b'], workHistory: [] } }));
    expect(s3.attributes).toEqual([]);
  });

  it('builds the client profile used for peer counts', () => {
    expect(memberSinceYear('2016-04-01T00:00:00Z')).toBe(2016);
    expect(memberSinceYear(null)).toBeNull();
    expect(clientProfile(job({ buyer: { companyId: 'c1', country: 'Norway', contractDate: 'May 2019' } }))).toMatchObject({ companyId: 'c1', memberSinceYear: 2019 });
    expect(isSmallestCompanySize('Individual')).toBe(true);
    expect(isSmallestCompanySize('10')).toBe(false);
  });
});

describe('extractAll', () => {
  it('runs every extractor and honours settings', () => {
    const findings = extractAll(
      job({ description: 'Visit our website acme.com', buyer: { companyName: 'Acme' } }),
      [],
      { extraGenericSites: ['www.acme.com'], extraLegalEndings: [] },
    );
    expect(findings.map((f) => f.source)).toEqual(['S1']);
    expect(scanOptions({ extraGenericSites: [], extraLegalEndings: ['Sàrl'] }).legalEndings).toContain('Sàrl');
  });
});
