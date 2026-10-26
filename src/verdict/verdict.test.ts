import { describe, expect, it } from 'vitest';
import type { Confidence, Finding, RuleId } from '../core/types';
import { evidence, finding, sequentialIds } from '../../test/builders';
import { applyAgreement } from './agreement';
import { judge } from './index';
import { domainLabel, normalizeName, registrableDomain, valuesAgree } from './normalize';
import { raiseOneLevel, ruleFor, toEvidence } from './rules';
import { bestEvidence, decideVerdict } from './verdict';

describe('confidence table (one case per row)', () => {
  const rows: [string, Partial<Finding> & Pick<Finding, 'detector'>, RuleId, Confidence][] = [
    ['S1 company field', { detector: 'S1-company', source: 'S1' }, 'C-S1', 'high'],
    ['S2 "we are X"', { detector: 'S2T-company-intro' }, 'C-S2T-CO', 'medium'],
    ['S2 legal ending with ownership phrase', { detector: 'S2T-company-legal', ownershipCue: true }, 'C-S2T-CO', 'medium'],
    ['S2 legal ending without phrase', { detector: 'S2T-company-legal', ownershipCue: false }, 'C-S2T-CO-NC', 'low'],
    ['S2 website with ownership phrase', { detector: 'S2T-website', kind: 'website', ownershipCue: true }, 'C-S2T-WEB', 'medium'],
    ['S2 website without phrase', { detector: 'S2T-website', kind: 'website' }, 'C-S2T-WEB-NC', 'low'],
    ['S2 email', { detector: 'S2T-email', kind: 'email' }, 'C-S2T-EMAIL', 'medium'],
    ['S2 email domain as website', { detector: 'S2T-email-domain', kind: 'website' }, 'C-S2T-EMAIL', 'medium'],
    ['S2 self-introduction, full name', { detector: 'S2T-person', kind: 'person_full_name' }, 'C-S2T-PERSON', 'medium'],
    ['S2 self-introduction, first name', { detector: 'S2T-person', kind: 'person_first_name' }, 'C-S2T-PERSON', 'low'],
    ['S2 file name', { detector: 'S2F-name', source: 'S2-file' }, 'C-S2F', 'low'],
    ['S5 first name, 2+ reviews', { detector: 'S5-name', source: 'S5', kind: 'person_first_name', mentions: 2 }, 'C-S5-FIRST', 'medium'],
    ['S5 first name, 1 review', { detector: 'S5-name', source: 'S5', kind: 'person_first_name', mentions: 1 }, 'C-S5-FIRST', 'low'],
    ['S5 full name, 2+ reviews', { detector: 'S5-name', source: 'S5', kind: 'person_full_name', mentions: 3 }, 'C-S5-FULL', 'medium'],
    ['S5 full name, 1 review', { detector: 'S5-name', source: 'S5', kind: 'person_full_name', mentions: 1 }, 'C-S5-FULL', 'low'],
  ];

  it.each(rows)('%s', (_label, partial, ruleId, confidence) => {
    expect(ruleFor(finding(partial))).toEqual({ ruleId, confidence });
  });

  it('builds evidence records with reason ids and starting confidence', () => {
    const [e] = toEvidence([finding({ detector: 'S1-company', source: 'S1', value: 'Acme Ltd' })], sequentialIds());
    expect(e).toMatchObject({ id: 'e1', reasonId: 'R-S1', confidence: 'high', baseConfidence: 'high', ruleId: 'C-S1' });
  });

  it('raises Low to Medium and Medium to High', () => {
    expect(raiseOneLevel('low')).toBe('medium');
    expect(raiseOneLevel('medium')).toBe('high');
    expect(raiseOneLevel('high')).toBe('high');
  });
});

describe('normalisation and matching', () => {
  it('removes case, punctuation, accents and legal endings', () => {
    expect(normalizeName('ACME Logistics, L.L.C.')).toBe('acme logistics');
    expect(normalizeName('Café Müller GmbH')).toBe('cafe muller');
    expect(normalizeName('Smith & Sons Pty Ltd')).toBe('smith and sons');
    expect(normalizeName('Ltd')).toBe('ltd');
  });

  it('finds the registrable domain', () => {
    expect(registrableDomain('https://www.shop.acme-logistics.com/about?x=1')).toBe('acme-logistics.com');
    expect(registrableDomain('acme.co.uk')).toBe('acme.co.uk');
    expect(registrableDomain('blog.acme.co.uk')).toBe('acme.co.uk');
    expect(registrableDomain('localhost')).toBe('');
    expect(domainLabel('acme-logistics.com')).toBe('acmelogistics');
  });

  it('matches a website to a company name (spec example)', () => {
    expect(valuesAgree({ kind: 'website', value: 'acme-logistics.com' }, { kind: 'company_name', value: 'Acme Logistics Ltd' })).toBe(true);
    expect(valuesAgree({ kind: 'website', value: 'acme.com' }, { kind: 'company_name', value: 'Acme Logistics Ltd' })).toBe(false);
  });

  it('matches websites by registrable domain and emails through their domain', () => {
    expect(valuesAgree({ kind: 'website', value: 'https://www.acme.com' }, { kind: 'website', value: 'acme.com/contact' })).toBe(true);
    expect(valuesAgree({ kind: 'email', value: 'jo@acme.com' }, { kind: 'website', value: 'acme.com' })).toBe(true);
    expect(valuesAgree({ kind: 'email', value: 'jo@acme.com' }, { kind: 'company_name', value: 'ACME Inc.' })).toBe(true);
  });

  it('never matches through a free-mail domain', () => {
    expect(valuesAgree({ kind: 'email', value: 'acme@gmail.com' }, { kind: 'website', value: 'gmail.com' })).toBe(false);
    expect(valuesAgree({ kind: 'email', value: 'jo@gmail.com' }, { kind: 'company_name', value: 'Gmail' })).toBe(false);
  });

  it('matches a first name to a full name with the same first word (D-03)', () => {
    expect(valuesAgree({ kind: 'person_first_name', value: 'Sarah' }, { kind: 'person_full_name', value: 'Sarah Kim' })).toBe(true);
    expect(valuesAgree({ kind: 'person_full_name', value: 'Sarah Kim' }, { kind: 'person_first_name', value: 'sarah' })).toBe(true);
    expect(valuesAgree({ kind: 'person_first_name', value: 'Kim' }, { kind: 'person_full_name', value: 'Sarah Kim' })).toBe(false);
    expect(valuesAgree({ kind: 'person_first_name', value: 'Sarah' }, { kind: 'company_name', value: 'Sarah' })).toBe(false);
  });

  it('matches names across kinds after normalisation', () => {
    expect(valuesAgree({ kind: 'company_name', value: 'John Smith' }, { kind: 'person_full_name', value: 'john smith' })).toBe(true);
    expect(valuesAgree({ kind: 'person_first_name', value: 'Sarah' }, { kind: 'person_first_name', value: 'SARAH' })).toBe(true);
  });

  it('does not match a website to a first name or a very short name', () => {
    expect(valuesAgree({ kind: 'website', value: 'sarah.com' }, { kind: 'person_first_name', value: 'Sarah' })).toBe(false);
    expect(valuesAgree({ kind: 'website', value: 'ab.com' }, { kind: 'company_name', value: 'AB' })).toBe(false);
  });
});

describe('agreement rule (D-03)', () => {
  it('raises both findings from different sources by one level', () => {
    const out = applyAgreement([
      evidence({ id: 'a', source: 'S2-text', kind: 'website', value: 'acme-logistics.com', confidence: 'medium' }),
      evidence({ id: 'b', source: 'S2-file', kind: 'company_name', value: 'Acme Logistics Ltd', confidence: 'medium' }),
    ]);
    expect(out.map((e) => e.confidence)).toEqual(['high', 'high']);
    expect(out[0]?.agreesWith).toEqual(['b']);
  });

  it('does not raise findings from the same source', () => {
    const out = applyAgreement([
      evidence({ id: 'a', kind: 'company_name', value: 'Acme Ltd' }),
      evidence({ id: 'b', kind: 'website', value: 'acme.com' }),
    ]);
    expect(out.map((e) => e.confidence)).toEqual(['medium', 'medium']);
  });

  it('treats S2 sub-sources as different sources', () => {
    const out = applyAgreement([
      evidence({ id: 'a', source: 'S2-text', confidence: 'low', baseConfidence: 'low' }),
      evidence({ id: 'b', source: 'S2-file', confidence: 'low', baseConfidence: 'low' }),
    ]);
    expect(out.map((e) => e.confidence)).toEqual(['medium', 'medium']);
  });

  it('raises a finding only once, however many findings agree with it', () => {
    const out = applyAgreement([
      evidence({ id: 'a', source: 'S5', kind: 'person_first_name', value: 'Sarah', confidence: 'low', baseConfidence: 'low' }),
      evidence({ id: 'b', source: 'S2-file', kind: 'person_full_name', value: 'Sarah Kim' }),
      evidence({ id: 'c', source: 'S2-text', kind: 'person_full_name', value: 'Sarah Kim' }),
    ]);
    expect(out[0]).toMatchObject({ confidence: 'medium', agreesWith: ['b', 'c'] });
    expect(out[1]?.confidence).toBe('high');
  });

  it('leaves High at High', () => {
    const out = applyAgreement([
      evidence({ id: 'a', source: 'S1', confidence: 'high', baseConfidence: 'high' }),
      evidence({ id: 'b', source: 'S2-text' }),
    ]);
    expect(out.map((e) => e.confidence)).toEqual(['high', 'high']);
  });
});

describe('verdict (D-33)', () => {
  it.each(['company_name', 'person_full_name', 'person_first_name', 'website', 'email'] as const)('has potential: a Medium %s', (kind) => {
    expect(decideVerdict([evidence({ kind, confidence: 'medium' })])).toBe('has_potential');
  });

  it('has potential: a High finding', () => {
    expect(decideVerdict([evidence({ kind: 'website', confidence: 'high' })])).toBe('has_potential');
  });

  it('no potential: only Low findings, or none (D-02)', () => {
    expect(decideVerdict([evidence({ kind: 'person_first_name', confidence: 'low' }), evidence({ kind: 'website', confidence: 'low' })])).toBe('no_potential');
    expect(decideVerdict([])).toBe('no_potential');
  });

  it('two agreeing Low findings from different sources give potential (D-03)', () => {
    const j = judge(
      [
        finding({ detector: 'S2T-website', kind: 'website', value: 'acme-logistics.com' }),
        finding({ detector: 'S2F-name', source: 'S2-file', value: 'Acme Logistics' }),
      ],
      sequentialIds(),
    );
    expect(j.evidence.map((e) => e.confidence)).toEqual(['medium', 'medium']);
    expect(j.verdict).toBe('has_potential');
  });

  it('two Low findings from the same source stay without potential (D-03)', () => {
    const j = judge(
      [
        finding({ detector: 'S2T-company-legal', value: 'Acme Ltd' }),
        finding({ detector: 'S2T-website', kind: 'website', value: 'acme.com' }),
      ],
      sequentialIds(),
    );
    expect(j.verdict).toBe('no_potential');
  });
});

describe('best evidence tie-break (D-08)', () => {
  it('returns null without evidence', () => {
    expect(bestEvidence([])).toBeNull();
  });

  it('prefers higher confidence', () => {
    const list = [evidence({ id: 'low', source: 'S1', confidence: 'low' }), evidence({ id: 'med', source: 'S2-file', confidence: 'medium' })];
    expect(bestEvidence(list)?.id).toBe('med');
  });

  it('then the source order S1, S2 text, S5, S2 file', () => {
    const sources = ['S2-file', 'S5', 'S2-text', 'S1'] as const;
    const list = sources.map((source) => evidence({ id: source, source }));
    expect(bestEvidence(list)?.id).toBe('S1');
    expect(bestEvidence(list.slice(0, 3))?.id).toBe('S2-text');
    expect(bestEvidence(list.slice(0, 2))?.id).toBe('S5');
  });

  it('then kind: company, full name, website, email, first name', () => {
    const kinds = ['person_first_name', 'email', 'website', 'person_full_name', 'company_name'] as const;
    const list = kinds.map((kind) => evidence({ id: kind, kind }));
    expect(bestEvidence(list)?.id).toBe('company_name');
    expect(bestEvidence(list.slice(0, 4))?.id).toBe('person_full_name');
    expect(bestEvidence(list.slice(0, 3))?.id).toBe('website');
    expect(bestEvidence(list.slice(0, 2))?.id).toBe('email');
  });

  it('then the most mentions, then the earliest', () => {
    expect(bestEvidence([evidence({ id: 'one', mentions: 1 }), evidence({ id: 'three', mentions: 3 })])?.id).toBe('three');
    expect(bestEvidence([evidence({ id: 'first' }), evidence({ id: 'second' })])?.id).toBe('first');
  });

  it('still names a best Low finding when nothing stronger exists', () => {
    const j = judge([finding({ detector: 'S2F-name', source: 'S2-file', value: 'Northwind' })], sequentialIds());
    expect(j.verdict).toBe('no_potential');
    expect(j.bestEvidenceId).toBe('e1');
  });
});
