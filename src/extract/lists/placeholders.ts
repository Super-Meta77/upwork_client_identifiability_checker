// FR-16 / D-09: values of the company-name field that do not name anyone.
// PROVISIONAL: Phase 0 extends this list from real responses (docs/decisions.md).

export const COMPANY_PLACEHOLDERS: ReadonlySet<string> = new Set([
  'n/a', 'na', 'none', 'null', 'undefined', 'nil', 'private', 'confidential', 'individual',
  'self', 'self-employed', 'self employed', 'freelance', 'freelancer', 'personal', 'person',
  'test', 'unknown', 'company', 'my company', 'business', 'my business', 'client', 'owner',
  'not applicable', 'no company', 'nothing', 'home', 'me', 'myself', 'startup',
]);

/** True when the value is empty, on the placeholder list, or has a placeholder shape. */
export function isPlaceholderCompanyName(value: string | null | undefined): boolean {
  const v = (value ?? '').trim();
  if (!v) return true;
  if (!/\p{L}/u.test(v)) return true; // no letters: "-", "...", "123"
  if (v.replace(/[^\p{L}\p{N}]/gu, '').length <= 2) return true;
  return COMPANY_PLACEHOLDERS.has(v.toLowerCase().replace(/\s+/g, ' '));
}
