import { isCommonWord } from './lists/common-words';

export const SNIPPET_RADIUS = 60;

/** FR-17: the value with up to 60 characters of context on each side, whitespace collapsed. */
export function snippetAround(text: string, start: number, end: number, radius = SNIPPET_RADIUS): string {
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, end + radius);
  const body = text.slice(from, to).replace(/\s+/g, ' ').trim();
  return `${from > 0 ? '…' : ''}${body}${to < text.length ? '…' : ''}`;
}

// D-04: phrases that show the client is talking about itself, not about a third party.
const CUE_BEFORE: RegExp[] = [
  /\b(?:our|my)\b[^.!?\n]{0,30}\b(?:site|website|web ?site|web ?page|homepage|company|business|domain|store|shop|platform|app|brand|agency|firm|startup|product|portal|blog|url|link|organi[sz]ation|team)\b[^.!?\n]{0,30}$/i,
  /\bvisit\s+(?:us|our)\b[^.!?\n]{0,30}$/i,
  /\b(?:we\s+are|we['’]re)\s*$/i,
  /\b(?:on\s+behalf\s+of|(?:co-?)?founder\s+(?:of|at)|(?:ceo|cto|coo|owner|director|manager|head|president)\s+(?:of|at)|(?:i|we)\s+work\s+(?:for|at)|here\s+at|(?:company|business)(?:\s+name)?\s+is|(?:website|site|url|domain)\s+is)\s*:?\s*$/i,
];

const CUE_AFTER: RegExp[] = [
  /^\s*,?\s*(?:we|our\s+team)\b/i,
  /^\s*\(?\s*(?:our|my)\s+(?:company|website|site|business|store|shop|agency|startup)\b/i,
  /^\s*(?:is|are)\s+(?:our|my)\b/i,
];

export function hasOwnershipCue(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - SNIPPET_RADIUS), start);
  const after = text.slice(end, end + SNIPPET_RADIUS);
  return CUE_BEFORE.some((re) => re.test(before)) || CUE_AFTER.some((re) => re.test(after));
}

/** A word that can be part of a name: starts with an upper-case letter or a digit ("AT&T", "3M", "McKay"). */
export function isNameToken(token: string): boolean {
  return /^[\p{Lu}\d][\p{L}\d&'’.-]*$/u.test(token) && /\p{L}/u.test(token);
}

/** A proper-case word such as "Sarah" or "O'Neil" (not ALL CAPS). */
export function isProperCaseWord(token: string): boolean {
  return /^\p{Lu}[\p{Ll}'’-]*\p{Ll}$/u.test(token) || /^\p{Lu}\p{Ll}+\p{Lu}\p{Ll}+$/u.test(token);
}

export function allCommon(tokens: readonly string[]): boolean {
  return tokens.every((t) => isCommonWord(t.replace(/[.,]$/, '')));
}

export interface Token {
  text: string;
  start: number;
  end: number;
}

export function tokenize(text: string, offset = 0): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(/\S+/g)) {
    out.push({ text: m[0], start: offset + (m.index ?? 0), end: offset + (m.index ?? 0) + m[0].length });
  }
  return out;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
