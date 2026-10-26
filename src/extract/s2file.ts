// S2 file names (FR-18): attachment names that contain a website or an unusual capitalised word.

import type { Finding, JobData } from '../core/types';
import { isCommonWord } from './lists/common-words';
import { DEFAULT_SCAN_OPTIONS, mergeFindings, scanText, type TextScanOptions } from './s2text';

function isUnusualCapitalisedWord(word: string): boolean {
  if (word.length < 3 || !/^\p{Lu}/u.test(word) || !/\p{L}{2}/u.test(word)) return false;
  if (/^v?\d+[a-z]?$/i.test(word)) return false; // v2, 2024, 3b
  if (/\d{3,}/.test(word)) return false; // IMG_2041-style counters and dates
  return !isCommonWord(word);
}

/** "AcmeLogistics_Brief-v2" -> ["Acme", "Logistics", "Brief", "v2"] */
function fileNameWords(base: string): string[] {
  return base
    .split(/[\s_+()[\]{},.-]+/)
    .flatMap((part) => part.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2').split(' '))
    .filter(Boolean);
}

export function extractS2File(job: JobData, options: TextScanOptions = DEFAULT_SCAN_OPTIONS): Finding[] {
  const findings: Finding[] = [];
  for (const fileName of job.attachmentNames) {
    const location = `attachment ${fileName} > file name`;
    const base = fileName.replace(/\.[a-z0-9]{1,5}$/i, '');

    for (const d of scanText(base.replace(/_/g, ' '), options)) {
      if (d.kind !== 'website') continue;
      findings.push({ source: 'S2-file', detector: 'S2F-name', kind: 'website', location, value: d.value, snippet: fileName, mentions: 1 });
    }

    // Consecutive unusual capitalised words form one name: "Acme_Logistics_brief" -> "Acme Logistics".
    let run: string[] = [];
    const flush = () => {
      if (run.length) {
        findings.push({ source: 'S2-file', detector: 'S2F-name', kind: 'company_name', location, value: run.join(' '), snippet: fileName, mentions: 1 });
      }
      run = [];
    };
    for (const word of fileNameWords(base)) {
      if (isUnusualCapitalisedWord(word)) run.push(word);
      else flush();
    }
    flush();
  }
  return mergeFindings(findings);
}
