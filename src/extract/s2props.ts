// S2 file properties (FR-19, D-07): turns properties read from attachments into findings.

import type { AttachmentPropEntry, AttachmentProps, Finding } from '../core/types';
import { isSoftwareOrDefault } from './lists/software-names';
import { DEFAULT_SCAN_OPTIONS, mergeFindings, scanText, type TextScanOptions } from './s2text';

function hasLegalEnding(value: string, options: TextScanOptions): boolean {
  const words = value.trim().split(/\s+/);
  if (words.length < 2) return false;
  return [1, 2, 3].some((n) => words.length > n && options.legalEndings.includes(words.slice(-n).join(' ')));
}

function personKind(value: string, options: TextScanOptions): Finding['kind'] {
  if (hasLegalEnding(value, options)) return 'company_name';
  return value.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length >= 2 ? 'person_full_name' : 'person_first_name';
}

/** "© 2024 Acme Ltd. All rights reserved." -> "Acme Ltd" */
export function cleanCopyright(value: string): string {
  return value
    .replace(/©|\(c\)|copyright/gi, ' ')
    .replace(/all rights reserved\.?/gi, ' ')
    .replace(/\b(?:19|20)\d{2}(?:\s*[-–]\s*(?:19|20)?\d{2,4})?\b/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '')
    .trim();
}

function entryFindings(entry: AttachmentPropEntry, options: TextScanOptions): Finding[] {
  const base = { source: 'S2-props' as const, location: entry.location, snippet: `${entry.field.split('.')[1]}: ${entry.value}`, mentions: 1 };
  const raw = entry.value.replace(/\s+/g, ' ').trim();

  switch (entry.field) {
    case 'pdf.Title':
    case 'office.title':
      // Titles are mostly document names; only a website or company name inside one is kept, at Low.
      return scanText(raw, options)
        .filter((d) => d.kind === 'website' || d.kind === 'company_name' || d.kind === 'email')
        .map((d) => ({ ...base, detector: 'S2P-title', kind: d.kind, value: d.value }));
    case 'office.Company':
      return isSoftwareOrDefault(raw) ? [] : [{ ...base, detector: 'S2P-company', kind: 'company_name', value: raw }];
    case 'exif.Copyright': {
      const value = cleanCopyright(raw);
      if (!value || isSoftwareOrDefault(value)) return [];
      return [{ ...base, detector: 'S2P-copyright', kind: personKind(value, options), value }];
    }
    case 'pdf.Author':
    case 'pdf.Creator':
    case 'office.creator':
    case 'office.lastModifiedBy':
    case 'office.Manager':
    case 'exif.Artist':
      if (raw.includes('@')) {
        return scanText(raw, options)
          .filter((d) => d.kind === 'email')
          .map((d) => ({ ...base, detector: 'S2P-person', kind: 'email', value: d.value }));
      }
      if (isSoftwareOrDefault(raw)) return [];
      return [{ ...base, detector: 'S2P-person', kind: personKind(raw, options), value: raw }];
  }
}

export function extractS2Props(props: readonly AttachmentProps[], options: TextScanOptions = DEFAULT_SCAN_OPTIONS): Finding[] {
  return mergeFindings(props.flatMap((p) => p.entries.flatMap((entry) => entryFindings(entry, options))));
}
