// FR-17: legal endings that mark a company name. The list is configurable: Settings can add more.
// Matching in text is case-sensitive so that ordinary words ("as", "co") are not mistaken for endings.

export const LEGAL_ENDINGS: readonly string[] = [
  'LLC', 'L.L.C.', 'Inc', 'Inc.', 'INC', 'Incorporated', 'Ltd', 'Ltd.', 'LTD', 'Limited',
  'GmbH', 'GMBH', 'AG', 'Corp', 'Corp.', 'Corporation', 'Co.', 'PLC', 'plc', 'LLP', 'LP',
  'Pty Ltd', 'Pty. Ltd.', 'Pty', 'S.A.', 'SA', 'S.L.', 'SRL', 'S.r.l.', 'S.R.L.', 'BV', 'B.V.',
  'NV', 'N.V.', 'Oy', 'AB', 'A/S', 'ApS', 'KG', 'SAS', 'SARL', 's.r.o.', 'Kft', 'Kft.',
  'd.o.o.', 'OÜ', 'UG', 'Sp. z o.o.', 'S.p.A.', 'SpA', 'K.K.', 'Pte Ltd', 'Pte. Ltd.', 'Sdn Bhd',
];

/** Normalised tokens removed from the end of a name before values are compared (agreement rule). */
export const LEGAL_ENDING_TOKENS: ReadonlySet<string> = new Set([
  'llc', 'inc', 'incorporated', 'ltd', 'limited', 'gmbh', 'ag', 'corp', 'corporation', 'co',
  'company', 'plc', 'llp', 'lp', 'pty', 'sa', 'sl', 'srl', 'bv', 'nv', 'oy', 'ab', 'as', 'aps',
  'kg', 'sas', 'sarl', 'sro', 'kft', 'doo', 'ou', 'ug', 'sp', 'z', 'oo', 'spa', 'kk', 'pte',
  'sdn', 'bhd',
]);

export function legalEndingsWith(extra: readonly string[]): string[] {
  return [...new Set([...LEGAL_ENDINGS, ...extra.map((e) => e.trim()).filter(Boolean)])];
}
