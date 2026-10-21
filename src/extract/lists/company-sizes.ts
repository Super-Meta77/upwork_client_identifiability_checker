// S3: the smallest company-size bucket. PROVISIONAL until Phase 0 lists the values Upwork uses.

const SMALLEST_SIZE_VALUES: ReadonlySet<string> = new Set([
  '1', 'individual', 'just me', 'solo', '1 person', '1 employee', 'self-employed', 'freelancer',
]);

export function isSmallestCompanySize(size: string | null): boolean {
  if (!size) return false;
  const v = size.trim().toLowerCase();
  if (SMALLEST_SIZE_VALUES.has(v)) return true;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 1;
}
