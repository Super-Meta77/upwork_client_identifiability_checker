import { describe, expect, it } from 'vitest';
import { job } from '../../test/builders';
import { extractAll, scanOptions } from './index';
import { isPlaceholderCompanyName } from './lists/placeholders';
import { extractS1 } from './s1';
import { extractS2File } from './s2file';
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
  const files = (...names: string[]) => job({ attachmentNames: names });

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

describe('extractAll', () => {
  it('runs every extractor and honours settings', () => {
    const findings = extractAll(
      job({ description: 'Visit our website acme.com', buyer: { companyName: 'Acme' } }),
      { extraGenericSites: ['www.acme.com'], extraLegalEndings: [] },
    );
    expect(findings.map((f) => f.source)).toEqual(['S1']);
    expect(scanOptions({ extraGenericSites: [], extraLegalEndings: ['Sàrl'] }).legalEndings).toContain('Sàrl');
  });
});
