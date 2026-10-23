import { beforeAll, describe, expect, it } from 'vitest';
import { makeJpeg, makeOffice, makePdf, pseudoRandomBytes, syntheticAttachments, type SyntheticFile } from '../../../test/synthetic/attachments';
import { AttachError, MAX_ATTACHMENT_BYTES, parseAttachment, withTimeout } from './parse';
import { expectedKind, sniff } from './sniff';
import { decodeXmlText, readXmlTag } from './xml-tags';
import { readZipEntries, ZipError } from './zip';

let files: SyntheticFile[] = [];
beforeAll(async () => {
  files = await syntheticAttachments();
});

describe('synthetic attachments (Phase 3 gate)', () => {
  it('has at least 10 files covering every supported type', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
    const extensions = new Set(files.map((f) => f.fileName.split('.').pop()));
    for (const ext of ['pdf', 'docx', 'xlsx', 'pptx', 'jpg', 'jpeg']) expect(extensions).toContain(ext);
  });

  it('reads every file correctly or fails it with E-ATTACH', async () => {
    for (const file of files) {
      if (file.expectError) {
        await expect(parseAttachment(file.fileName, file.bytes), file.fileName).rejects.toThrow(file.expectError);
        continue;
      }
      const props = await parseAttachment(file.fileName, file.bytes);
      expect(props.entries.map((e) => `${e.field}=${e.value}`), file.fileName).toEqual(file.expected);
    }
  });

  it('describes where each property was found', async () => {
    const docx = files.find((f) => f.fileName === 'spec.docx')!;
    const props = await parseAttachment(docx.fileName, docx.bytes);
    expect(props.entries.find((e) => e.field === 'office.Company')?.location).toBe('attachment spec.docx > docProps/app.xml > Company');
  });
});

describe('limits (FR-15, D-15)', () => {
  it('rejects files over 10 MB', async () => {
    const big = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
    await expect(parseAttachment('big.pdf', big)).rejects.toBeInstanceOf(AttachError);
  });

  it('reports no properties for a corrupt PDF and rejects a corrupt zip', async () => {
    expect((await parseAttachment('broken.pdf', new TextEncoder().encode('%PDF-1.7 garbage'))).entries).toEqual([]);
    await expect(parseAttachment('broken.docx', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).rejects.toThrow(AttachError);
  });

  it('rejects zip files without Office content types', async () => {
    const { zipSync, strToU8 } = await import('fflate');
    await expect(parseAttachment('x.docx', zipSync({ 'a.txt': strToU8('hi') }))).rejects.toThrow('not an Office document');
  });

  it('times out slow parsing', async () => {
    const never = new Promise<never>(() => {});
    await expect(withTimeout(never, 'slow.pdf', 10)).rejects.toThrow('longer than');
    await expect(withTimeout(Promise.resolve(1), 'fast.pdf', 10)).resolves.toBe(1);
  });
});

describe('NFR-04: one 10 MB attachment parses in under 3 s', () => {
  const pad = MAX_ATTACHMENT_BYTES - 200 * 1024;
  const big: Record<'pdf' | 'docx' | 'jpg', Uint8Array> = { pdf: new Uint8Array(), docx: new Uint8Array(), jpg: new Uint8Array() };

  // Building the 10 MB files is not what NFR-04 measures, and is slow on a busy machine.
  beforeAll(async () => {
    big.pdf = await makePdf({ author: 'Big File' }, { padBytes: pad });
    big.docx = makeOffice('word/document.xml', { creator: 'Big File' }, { 'word/media/image1.bin': pseudoRandomBytes(pad) });
    big.jpg = makeJpeg({ artist: 'Big File' }, pad);
  }, 60_000);

  it.each(['pdf', 'docx', 'jpg'] as const)('%s', async (kind) => {
    const t = performance.now();
    const props = await parseAttachment(`big.${kind}`, big[kind]);
    expect(performance.now() - t).toBeLessThan(3000);
    expect(props.entries[0]?.value).toBe('Big File');
  });
});

describe('helpers', () => {
  it('sniffs types from the first bytes', () => {
    expect(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(sniff(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe('zip');
    expect(sniff(new TextEncoder().encode('junk%PDF-1.4'))).toBe('pdf');
    expect(sniff(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(expectedKind('A.JPEG')).toBe('jpeg');
    expect(expectedKind('a.png')).toBeNull();
  });

  it('reads namespaced XML tags and decodes entities', () => {
    expect(readXmlTag('<cp:x><dc:creator xml:lang="en">A &amp; B&#39;s &#x41;</dc:creator></cp:x>', 'creator')).toBe("A & B's A");
    expect(readXmlTag('<Company></Company>', 'Company')).toBeNull();
    expect(readXmlTag('<a/>', 'Company')).toBeNull();
    expect(decodeXmlText('<![CDATA[Acme <Ltd>]]>')).toBe('Acme <Ltd>');
  });

  it('rejects files that are not zips', () => {
    expect(() => readZipEntries(new Uint8Array(30))).toThrow(ZipError);
  });
});
