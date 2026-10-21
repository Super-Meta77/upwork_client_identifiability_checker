// Value matching for the agreement rule (spec "Verdict rules", D-03) and the accuracy report.

import type { EvidenceKind } from '../core/types';
import { FREE_MAIL_DOMAINS } from '../extract/lists/free-mail';
import { LEGAL_ENDING_TOKENS } from '../extract/lists/legal-endings';

/** Lowercase, drop accents and punctuation, then remove legal endings from the end of the name. */
export function normalizeName(value: string): string {
  const tokens = value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[.'’/]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  while (tokens.length > 1 && LEGAL_ENDING_TOKENS.has(tokens[tokens.length - 1] ?? '')) tokens.pop();
  return tokens.join(' ');
}

// Second-level suffixes under which the registrable domain has three labels (acme.co.uk).
const TWO_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'com.au', 'net.au', 'org.au',
  'co.nz', 'org.nz', 'com.br', 'com.mx', 'com.ar', 'com.co', 'com.sg', 'com.my', 'com.hk',
  'com.tr', 'com.pk', 'com.ng', 'co.za', 'co.in', 'co.jp', 'co.kr', 'co.il', 'com.cn', 'com.tw',
  'com.ua', 'com.pl', 'com.ph', 'com.vn', 'com.eg', 'com.sa',
]);

/** "https://www.shop.acme.co.uk/path" -> "acme.co.uk". Returns "" for input that is not a host. */
export function registrableDomain(input: string): string {
  let host = input.trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  host = host.replace(/^[^@/]*@/, '');
  host = host.split(/[/?#:]/)[0] ?? '';
  host = host.replace(/\.+$/, '');
  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2) return '';
  const lastTwo = labels.slice(-2).join('.');
  if (TWO_PART_SUFFIXES.has(lastTwo) && labels.length >= 3) return labels.slice(-3).join('.');
  return lastTwo;
}

/** The main part of a domain, without its suffix or hyphens: "acme-logistics.co.uk" -> "acmelogistics". */
export function domainLabel(domain: string): string {
  const registrable = registrableDomain(domain);
  return (registrable.split('.')[0] ?? '').replace(/-/g, '');
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at < 0 ? '' : registrableDomain(email.slice(at + 1));
}

export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL_DOMAINS.has(registrableDomain(domain));
}

interface Comparable {
  kind: EvidenceKind;
  value: string;
}

const NAME_KINDS: ReadonlySet<EvidenceKind> = new Set(['company_name', 'person_full_name', 'person_first_name']);

/** The website a value stands for, if any: a website itself, or an email on a non-free-mail domain. */
function websiteOf(item: Comparable): string {
  if (item.kind === 'website') return registrableDomain(item.value);
  if (item.kind === 'email') {
    const domain = emailDomain(item.value);
    return domain && !isFreeMailDomain(domain) ? domain : '';
  }
  return '';
}

/**
 * Agreement rule: values match after lowercasing and removing punctuation and legal endings.
 * A website matches a name when its main domain part equals the name without spaces.
 * A first name matches a full name with the same first word (D-03).
 */
export function valuesAgree(a: Comparable, b: Comparable): boolean {
  const siteA = websiteOf(a);
  const siteB = websiteOf(b);
  if (siteA && siteB) return siteA === siteB;
  if (siteA || siteB) {
    const site = siteA || siteB;
    const other = siteA ? b : a;
    if (other.kind !== 'company_name' && other.kind !== 'person_full_name') return false;
    const name = normalizeName(other.value).replace(/ /g, '');
    return name.length >= 3 && name === domainLabel(site);
  }

  if (!NAME_KINDS.has(a.kind) || !NAME_KINDS.has(b.kind)) return false;
  const na = normalizeName(a.value);
  const nb = normalizeName(b.value);
  if (!na || !nb) return false;

  const aFirst = a.kind === 'person_first_name';
  const bFirst = b.kind === 'person_first_name';
  if (aFirst !== bFirst) {
    // A first name only agrees with a person's full name.
    const full = aFirst ? b : a;
    if (full.kind !== 'person_full_name') return false;
    const first = aFirst ? na : nb;
    const fullFirst = (aFirst ? nb : na).split(' ')[0];
    return first === fullFirst;
  }
  return na === nb;
}
