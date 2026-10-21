// Phase 0, step 5: npm run phase0:leak-check
// Fails when any original value (from the anonymise map, plus names found again in the raw responses)
// still appears in an anonymised fixture. Output stays in this terminal.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { entitiesIn, findLeaks } from './lib';

const MAP = 'phase0/raw/anonymise-map.json';
const RAW = 'phase0/raw/trimmed';
const FIXTURES = 'test/fixtures/jobs';

if (!existsSync(MAP)) {
  console.error('No anonymise map. Run npm run phase0:anonymise first.');
  process.exit(1);
}

const originals = new Set(Object.keys(JSON.parse(readFileSync(MAP, 'utf8')) as Record<string, string>));
if (existsSync(RAW)) {
  for (const f of readdirSync(RAW).filter((x) => x.endsWith('.json'))) {
    for (const e of entitiesIn(JSON.parse(readFileSync(join(RAW, f), 'utf8')))) originals.add(e.value);
  }
}

let leaks = 0;
for (const f of readdirSync(FIXTURES).filter((x) => x.startsWith('anonymised-') && x.endsWith('.json'))) {
  const found = findLeaks(readFileSync(join(FIXTURES, f), 'utf8'), [...originals]);
  for (const value of found) console.error(`${f}: still contains "${value}"`);
  leaks += found.length;
}

if (leaks) {
  console.error(`\n${leaks} leak(s). Fix the fixtures (or extend the anonymiser) before committing.`);
  process.exit(1);
}
console.log(`No leaks found against ${originals.size} original values. Still read each fixture once by eye.`);
