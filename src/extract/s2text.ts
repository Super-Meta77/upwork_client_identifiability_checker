// S2 text (FR-17, D-04–D-07): websites, emails, company names and self-introductions in the
// client's own job title, description and screening questions.

import nlp from 'compromise';
import type { Finding, JobData } from '../core/types';
import { emailDomain, isFreeMailDomain, normalizeName, registrableDomain } from '../verdict/normalize';
import { isCommonWord } from './lists/common-words';
import { GENERIC_SITES } from './lists/generic-sites';
import { LEGAL_ENDINGS } from './lists/legal-endings';
import {
  allCommon,
  escapeRegExp,
  hasOwnershipCue,
  isNameToken,
  isProperCaseWord,
  snippetAround,
  tokenize,
  type Token,
} from './text-utils';

export interface TextScanOptions {
  genericSites: ReadonlySet<string>;
  legalEndings: readonly string[];
}

export const DEFAULT_SCAN_OPTIONS: TextScanOptions = { genericSites: GENERIC_SITES, legalEndings: LEGAL_ENDINGS };

type TextDetector =
  | 'S2T-company-intro'
  | 'S2T-company-legal'
  | 'S2T-website'
  | 'S2T-email'
  | 'S2T-email-domain'
  | 'S2T-person';

export interface Detection {
  detector: TextDetector;
  kind: Finding['kind'];
  value: string;
  start: number;
  end: number;
  ownershipCue: boolean;
}

const EMAIL_RE = /(?<![\w.%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g;

const TLD =
  '(?:com|net|org|io|co|ai|app|dev|biz|info|us|uk|de|fr|es|it|nl|be|ch|at|se|no|dk|fi|pl|cz|pt|ie|ca|au|nz|in|sg|hk|jp|kr|cn|tw|br|mx|ar|cl|za|ae|il|tr|ru|ua|eu|me|tv|xyz|online|site|store|shop|tech|agency|studio|design|digital|media|solutions|services|group|global|cloud|so|ly|gg|to|fm|edu|gov|health|law|finance|capital|ventures|partners|consulting|marketing|software|systems|network|world|life|live|pro|club|space|works|team|company|email|page|art|travel|fitness|games|news|blog|academy|school)';

const WEBSITE_RE = new RegExp(
  `(?<![\\w@.-])(?:https?:\\/\\/)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+${TLD}(?![\\w-])(?::\\d{2,5})?(?:\\/[^\\s<>"'()\\]]*)?`,
  'gi',
);

// TLDs that are also file extensions or short English words: "logo.ai", "go.to".
const AMBIGUOUS_TLDS = new Set(['ai', 'me', 'so', 'to', 'in', 'it', 'at', 'be', 'no', 'us']);

const CONNECTORS = new Set(['&', 'and', 'of', 'de', 'la', 'du', 'van', 'von', 'der', 'den', 'y', 'e']);

const LEAD_STOP = new Set([
  'the', 'our', 'my', 'a', 'an', 'we', 'i', 'at', 'for', 'with', 'hi', 'hello', 'dear', 'thanks', 'this',
  'that', 'from', 'by', 'to', 'and', 'or', 'your', 'their', 'is', 'are', 'was', 'join', 'contact', 'visit',
  'about', 'like', 'as', 'in', 'on', 'via', 'using', 'use', 'new', 'existing', 'current',
]);

const INTRO_STOP = new Set([
  'looking', 'seeking', 'hiring', 'excited', 'thrilled', 'glad', 'happy', 'pleased', 'proud', 'currently',
  'now', 'based', 'located', 'ready', 'open', 'interested', 'building', 'developing', 'creating', 'working',
  'planning', 'trying', 'going', 'able', 'not', 'very', 'so', 'just', 'also', 'here', 'there', 'still',
  'actively', 'searching', 'expanding', 'growing', 'starting', 'launching', 'offering', 'providing', 'using',
  'hoping', 'wanting', 'a', 'an', 'in', 'on', 'at', 'from', 'us', 'usa', 'uk', 'eu', 'one', 'two', 'three',
  'small', 'large', 'big', 'new', 'fast', 'global', 'leading', 'passionate', 'dedicated', 'committed',
]);

const legalRegexCache = new Map<string, RegExp>();

function legalEndingRegex(endings: readonly string[]): RegExp {
  const key = endings.join('\u0000');
  let re = legalRegexCache.get(key);
  if (!re) {
    const alternatives = [...endings].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|');
    re = new RegExp(`(?<=[\\s,])(?:${alternatives})(?=$|[\\s,;:!?)\\]"'’]|\\.(?:\\s|$))`, 'g');
    legalRegexCache.set(key, re);
  }
  return re;
}

function isLegalEnding(word: string, endings: readonly string[]): boolean {
  return endings.includes(word) || endings.includes(word.replace(/[,.]$/, ''));
}

function isInitials(word: string): boolean {
  return /^(?:\p{Lu}\.)+$/u.test(word);
}

function detectEmails(text: string, options: TextScanOptions): Detection[] {
  const out: Detection[] = [];
  for (const m of text.matchAll(EMAIL_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const email = m[0];
    out.push({ detector: 'S2T-email', kind: 'email', value: email, start, end, ownershipCue: false });
    const domain = emailDomain(email);
    if (domain && !isFreeMailDomain(domain) && !options.genericSites.has(domain)) {
      out.push({ detector: 'S2T-email-domain', kind: 'website', value: domain, start, end, ownershipCue: false });
    }
  }
  return out;
}

function maskEmails(text: string): string {
  return text.replace(EMAIL_RE, (m) => ' '.repeat(m.length));
}

function detectWebsites(text: string, options: TextScanOptions): Detection[] {
  const out: Detection[] = [];
  const masked = maskEmails(text);
  for (const m of masked.matchAll(WEBSITE_RE)) {
    const domain = registrableDomain(m[0]);
    if (!domain || options.genericSites.has(domain)) continue;
    const [label = '', tld = ''] = [domain.split('.')[0], domain.split('.').slice(1).join('.')];
    if (label.length < 2 || /^\d+$/.test(label)) continue;
    if (AMBIGUOUS_TLDS.has(tld) && !/^(?:https?:\/\/|www\.)/i.test(m[0]) && isCommonWord(label)) continue;
    const start = m.index ?? 0;
    const end = start + m[0].replace(/[.,;:!?]+$/, '').length;
    out.push({ detector: 'S2T-website', kind: 'website', value: domain, start, end, ownershipCue: hasOwnershipCue(text, start, end) });
  }
  return out;
}

function detectLegalCompanies(text: string, options: TextScanOptions): Detection[] {
  const out: Detection[] = [];
  for (const m of text.matchAll(legalEndingRegex(options.legalEndings))) {
    const endingStart = m.index ?? 0;
    const end = endingStart + m[0].length;
    const windowStart = Math.max(0, endingStart - 100);
    let tokens = tokenize(text.slice(windowStart, endingStart), windowStart);
    if (windowStart > 0 && /\S/.test(text[windowStart - 1] ?? '')) tokens = tokens.slice(1);

    const name: Token[] = [];
    for (let i = tokens.length - 1; i >= 0 && name.length < 6; i -= 1) {
      const t = tokens[i]!;
      let word = t.text;
      if (i === tokens.length - 1 && word.endsWith(',')) word = word.slice(0, -1);
      else if (/[.,!?:;)\]"]$/.test(word) && !isInitials(word)) break;
      if (isNameToken(word)) name.unshift({ ...t, text: word });
      else if (CONNECTORS.has(word.toLowerCase()) && name.length > 0) name.unshift({ ...t, text: word });
      else break;
    }
    while (name.length && (CONNECTORS.has(name[0]!.text.toLowerCase()) || LEAD_STOP.has(name[0]!.text.toLowerCase()))) {
      name.shift();
    }
    if (!name.length || allCommon(name.map((t) => t.text))) continue;
    const start = name[0]!.start;
    const value = text.slice(start, end).replace(/\s+/g, ' ').trim();
    out.push({ detector: 'S2T-company-legal', kind: 'company_name', value, start, end, ownershipCue: hasOwnershipCue(text, start, end) });
  }
  return out;
}

const INTRO_RE =
  /\b(?:[Ww]e\s+are|[Ww]e['’]re|[Oo]ur\s+company(?:\s+name)?(?:\s+is)?|[Mm]y\s+company(?:\s+name)?(?:\s+is)?|(?:I\s+am|I['’]m)\s+(?:the\s+)?(?:[Cc]o-?founder|[Ff]ounder|[Oo]wner|CEO|CTO|[Dd]irector|[Pp]resident|[Hh]ead)\s+(?:of|at))[\s:,]+/g;

/** D-05: "we are X" / "our company X", where X is a capitalised name that is not an ordinary word. */
function detectIntroCompanies(text: string, options: TextScanOptions): Detection[] {
  const out: Detection[] = [];
  for (const m of text.matchAll(INTRO_RE)) {
    const from = (m.index ?? 0) + m[0].length;
    const tokens = tokenize(text.slice(from, from + 120), from);
    const name: Token[] = [];
    for (const t of tokens) {
      if (name.length >= 6) break;
      const trailing = /[,.!?:;)\]"]+$/.exec(t.text);
      if (trailing && isLegalEnding(t.text, options.legalEndings) && name.length) {
        name.push({ ...t, text: t.text.replace(/,$/, ''), end: t.start + t.text.replace(/,$/, '').length });
        break;
      }
      const word = trailing ? t.text.slice(0, trailing.index) : t.text;
      const lower = word.toLowerCase();
      const cleaned: Token = { ...t, text: word, end: t.start + word.length };
      if (!name.length && lower === 'the') {
        if (trailing) break;
        continue;
      }
      if (name.length && isLegalEnding(word, options.legalEndings)) name.push(cleaned);
      else if (isNameToken(word) && !INTRO_STOP.has(lower) && !/-(?:based|focused|owned|led|registered|founded)$/i.test(word)) {
        name.push(cleaned);
      } else if (CONNECTORS.has(lower) && name.length) name.push(cleaned);
      else break;
      if (trailing) break;
    }
    while (name.length && CONNECTORS.has(name[name.length - 1]!.text.toLowerCase())) name.pop();
    if (!name.length || allCommon(name.map((t) => t.text))) continue;
    const start = name[0]!.start;
    const end = name[name.length - 1]!.end;
    const value = text.slice(start, end).replace(/\s+/g, ' ').trim();
    out.push({ detector: 'S2T-company-intro', kind: 'company_name', value, start, end, ownershipCue: true });
  }
  return out;
}

function isKnownFirstName(word: string): boolean {
  return nlp(word).has('#FirstName');
}

function takePersonName(text: string, from: number): Token[] {
  const name: Token[] = [];
  for (const t of tokenize(text.slice(from, from + 60), from)) {
    const trailing = /[,.!?:;)\]"]+$/.exec(t.text);
    const word = trailing ? t.text.slice(0, trailing.index) : t.text;
    if (!isProperCaseWord(word) || isCommonWord(word)) break;
    name.push({ ...t, text: word, end: t.start + word.length });
    if (trailing || name.length >= 3) break;
  }
  return name;
}

const STRONG_INTRO_RE = /\b[Mm]y\s+name\s+is\s+/g;
const WEAK_INTRO_RE = /\b(?:I\s+am|I['’]m|[Tt]his\s+is)\s+/g;
const SIGN_OFF_RE =
  /(?:^|[\n.!])\s*(?:[Tt]hanks|[Tt]hank\s+you|[Mm]any\s+thanks|(?:[Bb]est|[Kk]ind|[Ww]arm)\s+[Rr]egards|[Rr]egards|[Bb]est|[Cc]heers|[Ss]incerely|[Aa]ll\s+the\s+best|THANKS)\s*[,!.\-–—]*\s*[-–—]?\s*((?:\p{Lu}[\p{Ll}'’-]+)(?:[ \t]+\p{Lu}[\p{Ll}'’-]+){0,2})\s*[.!]?\s*$/u;
const DASH_SIGN_OFF_RE = /(?:^|\n)\s*[-–—]\s*((?:\p{Lu}[\p{Ll}'’-]+)(?:[ \t]+\p{Lu}[\p{Ll}'’-]+)?)\s*$/u;

function personDetection(name: Token[]): Detection {
  const start = name[0]!.start;
  const end = name[name.length - 1]!.end;
  return {
    detector: 'S2T-person',
    kind: name.length >= 2 ? 'person_full_name' : 'person_first_name',
    value: name.map((t) => t.text).join(' '),
    start,
    end,
    ownershipCue: true,
  };
}

/** D-07: "My name is …", "I'm …" (known first names only) and sign-offs at the end of the post. */
function detectPeople(text: string, withSignOff: boolean): Detection[] {
  const out: Detection[] = [];
  for (const m of text.matchAll(STRONG_INTRO_RE)) {
    const name = takePersonName(text, (m.index ?? 0) + m[0].length);
    if (name.length) out.push(personDetection(name));
  }
  for (const m of text.matchAll(WEAK_INTRO_RE)) {
    const name = takePersonName(text, (m.index ?? 0) + m[0].length);
    if (name.length && isKnownFirstName(name[0]!.text)) out.push(personDetection(name));
  }
  if (withSignOff) {
    const tailStart = Math.max(0, text.length - 200);
    const tail = text.slice(tailStart);
    const m = SIGN_OFF_RE.exec(tail) ?? DASH_SIGN_OFF_RE.exec(tail);
    if (m?.[1]) {
      const nameStart = tailStart + (m.index ?? 0) + m[0].indexOf(m[1]);
      const tokens = tokenize(m[1], nameStart);
      if (!tokens.some((t) => isCommonWord(t.text))) out.push(personDetection(tokens));
    }
  }
  return out;
}

/** All S2 text detections in one piece of text, with offsets into that text. */
export function scanText(text: string, options: TextScanOptions = DEFAULT_SCAN_OPTIONS, withSignOff = false): Detection[] {
  if (!text.trim()) return [];
  return [
    ...detectEmails(text, options),
    ...detectWebsites(text, options),
    ...detectIntroCompanies(text, options),
    ...detectLegalCompanies(text, options),
    ...detectPeople(text, withSignOff),
  ];
}

function dedupeKey(kind: Finding['kind'], value: string): string {
  if (kind === 'website') return `website|${registrableDomain(value)}`;
  if (kind === 'email') return `email|${value.toLowerCase()}`;
  return `name|${kind}|${normalizeName(value)}`;
}

function strength(f: Finding): number {
  if (f.detector === 'S2T-company-intro') return 3;
  if (f.detector === 'S2T-email-domain' || f.ownershipCue) return 2;
  return 1;
}

/** Merges repeated findings: one record per value, counting mentions and keeping the strongest. */
export function mergeFindings(findings: readonly Finding[]): Finding[] {
  const byKey = new Map<string, Finding>();
  for (const f of findings) {
    const key = `${f.source}|${dedupeKey(f.kind, f.value)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...f });
      continue;
    }
    const mentions = existing.mentions + f.mentions;
    byKey.set(key, strength(f) > strength(existing) ? { ...f, mentions } : { ...existing, mentions });
  }
  return [...byKey.values()];
}

export function textLocations(job: JobData): { location: string; text: string; signOff: boolean }[] {
  return [
    { location: 'opening.job.info.title', text: job.title, signOff: false },
    { location: 'opening.job.description', text: job.description, signOff: true },
    ...job.questions.map((text, i) => ({ location: `opening.questions[${i}].question`, text, signOff: false })),
  ];
}

export function extractS2Text(job: JobData, options: TextScanOptions = DEFAULT_SCAN_OPTIONS): Finding[] {
  const findings: Finding[] = [];
  for (const { location, text, signOff } of textLocations(job)) {
    for (const d of scanText(text, options, signOff)) {
      findings.push({
        source: 'S2-text',
        detector: d.detector,
        kind: d.kind,
        location,
        value: d.value,
        snippet: snippetAround(text, d.start, d.end),
        mentions: 1,
        ownershipCue: d.ownershipCue,
      });
    }
  }
  return mergeFindings(findings);
}
