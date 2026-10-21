// A minimal zip reader for Office files (D-15). It reads the central directory and inflates only
// the entries asked for, stopping as soon as an entry grows past its byte limit (zip bombs).

import { Inflate } from 'fflate';

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export class ZipError extends Error {
  override name = 'ZipError';
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const CHUNK = 4096;

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  const dv = view(bytes);
  const minEocd = Math.max(0, bytes.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= minEocd; i -= 1) {
    if (dv.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('not a zip file (no end of central directory)');

  const count = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff || count === 0xffff) throw new ZipError('zip64 files are not supported');

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  const utf8 = new TextDecoder('utf-8');
  for (let n = 0; n < count; n += 1) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== CENTRAL_SIGNATURE) throw new ZipError('corrupt central directory');
    const nameLength = dv.getUint16(p + 28, true);
    const extraLength = dv.getUint16(p + 30, true);
    const commentLength = dv.getUint16(p + 32, true);
    entries.push({
      method: dv.getUint16(p + 10, true),
      compressedSize: dv.getUint32(p + 20, true),
      uncompressedSize: dv.getUint32(p + 24, true),
      localHeaderOffset: dv.getUint32(p + 42, true),
      name: utf8.decode(bytes.subarray(p + 46, p + 46 + nameLength)),
    });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Returns the entry's bytes, or throws once more than `maxBytes` have been produced. */
export function readZipEntry(bytes: Uint8Array, entry: ZipEntry, maxBytes: number): Uint8Array {
  const dv = view(bytes);
  const at = entry.localHeaderOffset;
  if (at + 30 > bytes.length || dv.getUint32(at, true) !== LOCAL_SIGNATURE) throw new ZipError('corrupt local header');
  const start = at + 30 + dv.getUint16(at + 26, true) + dv.getUint16(at + 28, true);
  const data = bytes.subarray(start, Math.min(bytes.length, start + entry.compressedSize));

  if (entry.method === 0) {
    if (data.length > maxBytes) throw new ZipError(`${entry.name} is larger than ${maxBytes} bytes`);
    return data.slice();
  }
  if (entry.method !== 8) throw new ZipError(`unsupported compression method ${entry.method}`);

  const parts: Uint8Array[] = [];
  let total = 0;
  let tooLarge = false;
  const inflater = new Inflate((chunk) => {
    total += chunk.length;
    if (total > maxBytes) tooLarge = true;
    else parts.push(chunk);
  });
  for (let offset = 0; offset < data.length && !tooLarge; offset += CHUNK) {
    const end = Math.min(data.length, offset + CHUNK);
    inflater.push(data.subarray(offset, end), end === data.length);
  }
  if (tooLarge) throw new ZipError(`${entry.name} expands past ${maxBytes} bytes`);

  const out = new Uint8Array(total);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}
