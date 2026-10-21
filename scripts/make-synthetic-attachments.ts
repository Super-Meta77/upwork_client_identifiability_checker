// npm run make:attachments — writes the synthetic test attachments to test/fixtures/files/ so they can
// be opened and inspected by hand. The tests build the same files in memory.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { syntheticAttachments } from '../test/synthetic/attachments';

const OUT = 'test/fixtures/files';
mkdirSync(OUT, { recursive: true });
const files = await syntheticAttachments();
for (const f of files) writeFileSync(join(OUT, f.fileName), f.bytes);
writeFileSync(
  join(OUT, 'EXPECTED.md'),
  ['# Synthetic attachments', '', '| File | Expected properties or error |', '| --- | --- |', ...files.map((f) => `| ${f.fileName} | ${f.expectError ? `E-ATTACH: ${f.expectError}` : f.expected.join('<br>') || '(none)'} |`), ''].join('\n'),
);
console.log(`Wrote ${files.length} files to ${OUT}/`);
