// S5 (FR-20, D-07): person names in the reviews shown on the job page, with every freelancer's
// own name removed. Names are counted per review.

import nlp from 'compromise';
import type { Finding, JobData } from '../core/types';
import { isCommonWord } from './lists/common-words';
import { snippetAround } from './text-utils';

const HONORIFICS = /^(?:mr|mrs|ms|miss|dr|sir|madam|mx)\.?$/i;

/** "Sarah!" -> "Sarah"; "John P." -> "John"; "Mr. Smith" -> "Smith". */
export function cleanName(raw: string): string {
  return raw
    .replace(/[^\p{L}\s'’.-]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[.'’-]+|[.'’-]+$/g, ''))
    .filter((w) => w && !HONORIFICS.test(w) && !/^\p{Lu}$/u.test(w))
    .join(' ')
    .trim();
}

/** First words of every freelancer name in the work history, lowercased ("John P." -> "john"). */
export function freelancerNameWords(job: JobData): Set<string> {
  const words = new Set<string>();
  for (const item of job.buyer.workHistory) {
    for (const w of cleanName(item.contractorName ?? '').toLowerCase().split(' ')) if (w.length > 1) words.add(w);
  }
  return words;
}

export function namesInReview(text: string): string[] {
  const names = new Set<string>();
  for (const raw of nlp(text).people().out('array') as string[]) {
    const name = cleanName(raw);
    const words = name.split(' ').filter(Boolean);
    if (!words.length || words.length > 3) continue;
    if (!/^\p{Lu}/u.test(words[0]!) || words.some((w) => isCommonWord(w))) continue;
    if (!text.includes(words[0]!)) continue;
    names.add(words.join(' '));
  }
  return [...names];
}

interface Tally {
  value: string;
  reviews: Set<number>;
  location: string;
  snippet: string;
}

export function extractS5(job: JobData): Finding[] {
  const excluded = freelancerNameWords(job);
  const reviews: { location: string; text: string }[] = [];
  job.buyer.workHistory.forEach((item, i) => {
    if (item.feedbackToClientComment?.trim()) {
      reviews.push({ location: `buyer.workHistory[${i}].feedbackToClient.comment`, text: item.feedbackToClientComment });
    }
    if (item.feedbackComment?.trim()) {
      reviews.push({ location: `buyer.workHistory[${i}].feedback.comment`, text: item.feedbackComment });
    }
  });

  const full = new Map<string, Tally>();
  const first = new Map<string, Tally>();
  const firstAlone = new Set<string>();

  const tally = (map: Map<string, Tally>, key: string, value: string, review: number, location: string, text: string) => {
    const existing = map.get(key);
    if (existing) {
      existing.reviews.add(review);
      return;
    }
    const at = text.indexOf(value.split(' ')[0]!);
    map.set(key, { value, reviews: new Set([review]), location, snippet: snippetAround(text, at, at + value.length) });
  };

  reviews.forEach(({ location, text }, review) => {
    for (const name of namesInReview(text)) {
      const words = name.split(' ');
      if (words.some((w) => excluded.has(w.toLowerCase()))) continue; // FR-20: freelancers' own names
      const firstWord = words[0]!;
      tally(first, firstWord.toLowerCase(), firstWord, review, location, text);
      if (words.length >= 2) tally(full, name.toLowerCase(), name, review, location, text);
      else firstAlone.add(firstWord.toLowerCase());
    }
  });

  const findings: Finding[] = [];
  for (const t of full.values()) {
    findings.push({ source: 'S5', detector: 'S5-name', kind: 'person_full_name', location: t.location, value: t.value, snippet: t.snippet, mentions: t.reviews.size });
  }
  // A first name is reported on its own only when some review uses it without a surname.
  for (const [key, t] of first) {
    if (!firstAlone.has(key)) continue;
    findings.push({ source: 'S5', detector: 'S5-name', kind: 'person_first_name', location: t.location, value: t.value, snippet: t.snippet, mentions: t.reviews.size });
  }
  return findings;
}
