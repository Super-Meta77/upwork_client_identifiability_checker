// FR-19: read author and company properties from PDF, Office and JPEG attachments (D-15).

import exifr from 'exifr';
import { PDFDocument } from 'pdf-lib';
import { AttachError } from '../../core/errors';
import type { AttachmentField, AttachmentPropEntry, AttachmentProps } from '../../core/types';
import { expectedKind, MAX_ATTACHMENT_BYTES, sniff } from './sniff';
import { readXmlTag } from './xml-tags';
import { readZipEntries, readZipEntry, ZipError } from './zip';

export { AttachError, MAX_ATTACHMENT_BYTES };
export const MAX_DOCPROPS_BYTES = 1024 * 1024;
export const PARSE_TIMEOUT_MS = 3000;

function entry(fileName: string, part: string, field: AttachmentField, value: string | null | undefined): AttachmentPropEntry[] {
  const v = typeof value === 'string' ? value.replace(/\u0000/g, '').trim() : '';
  if (!v) return [];
  const label = field.split('.')[1];
  return [{ field, value: v, location: `attachment ${fileName} > ${part} > ${label}` }];
}

async function readPdf(fileName: string, bytes: Uint8Array): Promise<AttachmentPropEntry[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  if (doc.isEncrypted) throw new AttachError(fileName, 'the PDF is encrypted, so its properties cannot be read');
  return [
    ...entry(fileName, 'PDF info', 'pdf.Author', doc.getAuthor()),
    ...entry(fileName, 'PDF info', 'pdf.Creator', doc.getCreator()),
    ...entry(fileName, 'PDF info', 'pdf.Title', doc.getTitle()),
  ];
}

function readOffice(fileName: string, bytes: Uint8Array): AttachmentPropEntry[] {
  const entries = readZipEntries(bytes);
  const xmlOf = (path: string): string | null => {
    const e = entries.find((x) => x.name === path);
    return e ? new TextDecoder('utf-8').decode(readZipEntry(bytes, e, MAX_DOCPROPS_BYTES)) : null;
  };
  if (!entries.some((e) => e.name === '[Content_Types].xml')) throw new AttachError(fileName, 'not an Office document');

  const core = xmlOf('docProps/core.xml');
  const app = xmlOf('docProps/app.xml');
  const out: AttachmentPropEntry[] = [];
  if (core) {
    out.push(...entry(fileName, 'docProps/core.xml', 'office.creator', readXmlTag(core, 'creator')));
    out.push(...entry(fileName, 'docProps/core.xml', 'office.lastModifiedBy', readXmlTag(core, 'lastModifiedBy')));
    out.push(...entry(fileName, 'docProps/core.xml', 'office.title', readXmlTag(core, 'title')));
  }
  if (app) {
    out.push(...entry(fileName, 'docProps/app.xml', 'office.Company', readXmlTag(app, 'Company')));
    out.push(...entry(fileName, 'docProps/app.xml', 'office.Manager', readXmlTag(app, 'Manager')));
  }
  return out;
}

async function readJpeg(fileName: string, bytes: Uint8Array): Promise<AttachmentPropEntry[]> {
  const tags = ((await exifr.parse(bytes, ['Artist', 'Copyright'])) ?? {}) as { Artist?: unknown; Copyright?: unknown };
  const text = (v: unknown) => (typeof v === 'string' ? v : Array.isArray(v) ? v.join(' ') : null);
  return [
    ...entry(fileName, 'EXIF', 'exif.Artist', text(tags.Artist)),
    ...entry(fileName, 'EXIF', 'exif.Copyright', text(tags.Copyright)),
  ];
}

export function withTimeout<T>(work: Promise<T>, fileName: string, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AttachError(fileName, `reading its properties took longer than ${ms / 1000} s`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** Reads properties from one downloaded attachment. Throws AttachError (E-ATTACH) on any problem. */
export async function parseAttachment(fileName: string, bytes: Uint8Array, timeoutMs = PARSE_TIMEOUT_MS): Promise<AttachmentProps> {
  const expected = expectedKind(fileName);
  if (!expected) throw new AttachError(fileName, 'this file type is not analysed');
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new AttachError(fileName, 'the file is larger than 10 MB');
  const actual = sniff(bytes);
  if (actual !== expected) throw new AttachError(fileName, "the file's content does not match its type");

  try {
    if (actual === 'pdf') return { fileName, fileType: 'pdf', entries: await withTimeout(readPdf(fileName, bytes), fileName, timeoutMs) };
    if (actual === 'zip') return { fileName, fileType: 'office', entries: readOffice(fileName, bytes) };
    return { fileName, fileType: 'jpeg', entries: await withTimeout(readJpeg(fileName, bytes), fileName, timeoutMs) };
  } catch (error) {
    if (error instanceof AttachError) throw error;
    if (error instanceof ZipError) throw new AttachError(fileName, error.message);
    throw new AttachError(fileName, 'the file could not be read');
  }
}
