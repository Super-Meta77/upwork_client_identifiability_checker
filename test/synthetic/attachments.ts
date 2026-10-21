// Synthetic attachments with known properties (spec "Test data": at least 10 files covering PDF,
// DOCX, XLSX, PPTX and JPEG, defaults such as "User", and files with no properties).

import { strToU8, zipSync } from 'fflate';
import { PDFDocument, PDFName } from 'pdf-lib';

export interface SyntheticFile {
  fileName: string;
  bytes: Uint8Array;
  /** Property values the parser must find, as "field=value". */
  expected: string[];
  /** When set, parsing must fail with E-ATTACH and a message containing this text. */
  expectError?: string;
}

export function pseudoRandomBytes(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed || 1;
  for (let i = 0; i < length; i += 1) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

export async function makePdf(meta: { author?: string; creator?: string; title?: string } = {}, options: { encrypted?: boolean; padBytes?: number; bare?: boolean } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: !options.bare });
  doc.addPage([200, 200]);
  if (meta.author !== undefined) doc.setAuthor(meta.author);
  if (meta.creator !== undefined) doc.setCreator(meta.creator);
  if (meta.title !== undefined) doc.setTitle(meta.title);
  if (options.bare) {
    doc.setProducer('');
  }
  if (options.padBytes) {
    await doc.attach(pseudoRandomBytes(options.padBytes), 'padding.bin', { mimeType: 'application/octet-stream' });
  }
  if (options.encrypted) {
    doc.context.trailerInfo.Encrypt = doc.context.obj({ Filter: PDFName.of('Standard'), V: 1, R: 2, P: -4 });
  }
  return doc.save({ useObjectStreams: false });
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`;

function coreXml(p: { creator?: string; lastModifiedBy?: string; title?: string }): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">
${p.title !== undefined ? `<dc:title>${p.title}</dc:title>` : ''}${p.creator !== undefined ? `<dc:creator>${p.creator}</dc:creator>` : ''}${p.lastModifiedBy !== undefined ? `<cp:lastModifiedBy>${p.lastModifiedBy}</cp:lastModifiedBy>` : ''}
</cp:coreProperties>`;
}

function appXml(p: { company?: string; manager?: string }): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Office Word</Application>${p.company !== undefined ? `<Company>${p.company}</Company>` : ''}${p.manager !== undefined ? `<Manager>${p.manager}</Manager>` : ''}</Properties>`;
}

export function makeOffice(
  mainPart: 'word/document.xml' | 'xl/workbook.xml' | 'ppt/presentation.xml',
  props: { creator?: string; lastModifiedBy?: string; title?: string; company?: string; manager?: string } | null,
  extra: Record<string, Uint8Array> = {},
): Uint8Array {
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    [mainPart]: strToU8('<root/>'),
  };
  if (props) {
    files['docProps/core.xml'] = strToU8(coreXml(props));
    files['docProps/app.xml'] = strToU8(appXml(props));
  }
  for (const [name, data] of Object.entries(extra)) files[name] = [data, { level: 0 }];
  return zipSync(files, { level: 6 });
}

/** A minimal JPEG with an EXIF IFD0 holding Artist (0x013B) and Copyright (0x8298). */
export function makeJpeg(tags: { artist?: string; copyright?: string } = {}, padBytes = 0): Uint8Array {
  const entries: [number, string][] = [];
  if (tags.artist !== undefined) entries.push([0x013b, tags.artist]);
  if (tags.copyright !== undefined) entries.push([0x8298, tags.copyright]);

  const parts: number[] = [0xff, 0xd8];
  if (entries.length) {
    const ifdStart = 8;
    const dataStart = ifdStart + 2 + entries.length * 12 + 4;
    const tiff: number[] = [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00];
    const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
    const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
    const data: number[] = [];
    tiff.push(...u16(entries.length));
    for (const [tag, text] of entries) {
      const bytes = [...new TextEncoder().encode(text), 0];
      tiff.push(...u16(tag), ...u16(2), ...u32(bytes.length));
      if (bytes.length <= 4) {
        tiff.push(...bytes, ...new Array(4 - bytes.length).fill(0));
      } else {
        tiff.push(...u32(dataStart + data.length));
        data.push(...bytes);
      }
    }
    tiff.push(...u32(0), ...data);
    const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0"
    const length = payload.length + 2;
    parts.push(0xff, 0xe1, (length >> 8) & 0xff, length & 0xff, ...payload);
  } else {
    const jfif = [0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
    parts.push(0xff, 0xe0, 0x00, jfif.length + 2, ...jfif);
  }
  const head = new Uint8Array([...parts, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
  const pad = pseudoRandomBytes(padBytes, 7).map((b) => (b === 0xff ? 0x00 : b));
  const out = new Uint8Array(head.length + pad.length + 2);
  out.set(head, 0);
  out.set(pad, head.length);
  out.set([0xff, 0xd9], head.length + pad.length);
  return out;
}

/** A DOCX whose core.xml inflates to several megabytes (zip-bomb guard, D-15). */
export function makeZipBomb(): Uint8Array {
  const huge = `<cp:coreProperties><dc:creator>${'a'.repeat(5 * 1024 * 1024)}</dc:creator></cp:coreProperties>`;
  return zipSync({ '[Content_Types].xml': strToU8(CONTENT_TYPES), 'docProps/core.xml': strToU8(huge) }, { level: 9 });
}

export async function syntheticAttachments(): Promise<SyntheticFile[]> {
  return [
    {
      fileName: 'brief.pdf',
      bytes: await makePdf({ author: 'Dana Whitfield', creator: 'Microsoft® Word for Microsoft 365', title: 'Northwind Traders Ltd brand brief' }),
      expected: ['pdf.Author=Dana Whitfield', 'pdf.Creator=Microsoft® Word for Microsoft 365', 'pdf.Title=Northwind Traders Ltd brand brief'],
    },
    { fileName: 'default-user.pdf', bytes: await makePdf({ author: 'User', creator: 'User' }), expected: ['pdf.Author=User', 'pdf.Creator=User'] },
    { fileName: 'no-props.pdf', bytes: await makePdf({}, { bare: true }), expected: [] },
    { fileName: 'locked.pdf', bytes: await makePdf({ author: 'Hidden Person' }, { encrypted: true }), expected: [], expectError: 'encrypted' },
    {
      fileName: 'spec.docx',
      bytes: makeOffice('word/document.xml', { creator: 'Maria Lopez', lastModifiedBy: 'Tom', title: 'Spec', company: 'Fabrikam Studio Ltd', manager: 'Kenji Sato' }),
      expected: ['office.creator=Maria Lopez', 'office.lastModifiedBy=Tom', 'office.title=Spec', 'office.Company=Fabrikam Studio Ltd', 'office.Manager=Kenji Sato'],
    },
    {
      fileName: 'budget.xlsx',
      bytes: makeOffice('xl/workbook.xml', { creator: 'Microsoft Office User', company: 'Contoso &amp; Co.' }),
      expected: ['office.creator=Microsoft Office User', 'office.Company=Contoso & Co.'],
    },
    { fileName: 'deck.pptx', bytes: makeOffice('ppt/presentation.xml', { creator: 'Lee Chen', lastModifiedBy: 'Admin' }), expected: ['office.creator=Lee Chen', 'office.lastModifiedBy=Admin'] },
    { fileName: 'empty.docx', bytes: makeOffice('word/document.xml', null), expected: [] },
    { fileName: 'photo.jpg', bytes: makeJpeg({ artist: 'Priya Natarajan', copyright: '© 2024 Tailspin Toys Ltd' }), expected: ['exif.Artist=Priya Natarajan', 'exif.Copyright=© 2024 Tailspin Toys Ltd'] },
    { fileName: 'plain.jpeg', bytes: makeJpeg(), expected: [] },
    { fileName: 'renamed.docx', bytes: await makePdf({ author: 'X Y' }), expected: [], expectError: 'does not match' },
    { fileName: 'bomb.docx', bytes: makeZipBomb(), expected: [], expectError: 'expands past' },
    { fileName: 'notes.txt', bytes: strToU8('hello'), expected: [], expectError: 'not analysed' },
  ];
}
