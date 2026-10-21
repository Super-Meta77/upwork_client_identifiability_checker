// Phase 0, step 5: npm run phase0:anonymise
// Turns phase0/raw/trimmed/*.json into test/fixtures/jobs/anonymised-*.json, replacing names,
// companies, emails, websites and cities with invented values of the same shape. The original-to-fake
// map stays in phase0/raw/anonymise-map.json. Then run phase0:leak-check and read the fixtures once.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { anonymise, buildMapping } from './lib';

const IN = 'phase0/raw/trimmed';
const OUT = 'test/fixtures/jobs';

if (!existsSync(IN)) {
  console.error(`No ${IN}/ folder. Run npm run phase0:analyze first.`);
  process.exit(1);
}

const files = readdirSync(IN).filter((f) => f.endsWith('.json')).sort();
const bodies = files.map((f) => JSON.parse(readFileSync(join(IN, f), 'utf8')) as unknown);
const mapping = buildMapping(bodies);

bodies.forEach((body, i) => {
  const name = `anonymised-${String(i + 1).padStart(2, '0')}.json`;
  writeFileSync(join(OUT, name), `${JSON.stringify(anonymise(body, mapping, i + 1), null, 2)}\n`);
});
writeFileSync('phase0/raw/anonymise-map.json', JSON.stringify(Object.fromEntries(mapping), null, 2));

console.log(`Wrote ${bodies.length} fixtures to ${OUT}/ with ${mapping.size} replacements.`);
console.log('Next: npm run phase0:leak-check, then read each anonymised fixture once before committing.');
