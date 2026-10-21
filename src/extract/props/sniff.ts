// D-15: decide a file's type from its first bytes, not from its name.

export type FileKind = 'pdf' | 'zip' | 'jpeg';

/** FR-15: at most 10 MB per file. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** FR-15: at most 5 files per job. */
export const MAX_ATTACHMENTS_PER_JOB = 5;

/** FR-15: the only attachment types analysed. */
export const SUPPORTED_EXTENSIONS: Readonly<Record<string, FileKind>> = {
  pdf: 'pdf',
  docx: 'zip',
  xlsx: 'zip',
  pptx: 'zip',
  jpg: 'jpeg',
  jpeg: 'jpeg',
};

export function extensionOf(fileName: string): string {
  return /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase() ?? '';
}

export function expectedKind(fileName: string): FileKind | null {
  return SUPPORTED_EXTENSIONS[extensionOf(fileName)] ?? null;
}

export function sniff(bytes: Uint8Array): FileKind | null {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'zip';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  // PDF readers accept "%PDF-" anywhere in the first 1024 bytes.
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  if (head.includes('%PDF-')) return 'pdf';
  return null;
}
