// Phase 0, step 4: npm run phase0:analyze
// Reads phase0/raw/*.har and phase0/raw/links.txt, writes docs/phase0-report.md (safe to commit) and,
// under phase0/raw/ (gitignored): trimmed/*.json, private-notes.txt and upwork-query.graphql.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeHar, type Har } from './lib';

const RAW = 'phase0/raw';

if (!existsSync(RAW)) {
  console.error(`No ${RAW}/ folder. Save HAR files and links.txt there first (see README, "Phase 0").`);
  process.exit(1);
}

const harFiles = readdirSync(RAW).filter((f) => f.toLowerCase().endsWith('.har'));
if (!harFiles.length) {
  console.error(`No .har files in ${RAW}/.`);
  process.exit(1);
}

const entries = harFiles.flatMap((f) => (JSON.parse(readFileSync(join(RAW, f), 'utf8')) as Har).log.entries);
const linksFile = join(RAW, 'links.txt');
const links = existsSync(linksFile) ? readFileSync(linksFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];

const { report, trimmed, privateNotes, query } = analyzeHar(entries, links);

mkdirSync('docs', { recursive: true });
writeFileSync('docs/phase0-report.md', report);
mkdirSync(join(RAW, 'trimmed'), { recursive: true });
for (const t of trimmed) writeFileSync(join(RAW, 'trimmed', `${t.name}.json`), JSON.stringify(t.body, null, 2));
writeFileSync(join(RAW, 'private-notes.txt'), privateNotes);
if (query) writeFileSync(join(RAW, 'upwork-query.graphql'), query);

console.log(`Read ${harFiles.length} HAR file(s), ${entries.length} entries, ${trimmed.length} job responses.`);
console.log('Wrote docs/phase0-report.md and phase0/raw/{trimmed/, private-notes.txt, upwork-query.graphql}.');
