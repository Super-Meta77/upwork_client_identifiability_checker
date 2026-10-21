import { errorMessage } from '../core/errors';

export const MAX_LINKS_PER_BATCH = 50;

const ACCEPTED_HOSTS = new Set(['www.upwork.com', 'upwork.com']);
const ACCEPTED_SCHEMES = new Set(['https:', 'http:']);

// FR-03: the job ID is "~" followed by letters and digits. Matching is case-insensitive and the
// ID is lowercased (D-17). The prefix is not assumed to be ~01; current links also use ~02.
const ID = '(~[a-z0-9]{8,})';

// FR-03 job paths. Phase 0 may add patterns found in real links (docs/decisions.md).
const JOB_PATHS: RegExp[] = [
  new RegExp(`^/jobs/${ID}$`, 'i'),
  new RegExp(`^/jobs/[^/]*_${ID}$`, 'i'),
  new RegExp(`^/nx/search/jobs/details/${ID}$`, 'i'),
  new RegExp(`^/freelance-jobs/apply/[^/]*_${ID}$`, 'i'),
  new RegExp(`^/nx/proposals/job/${ID}$`, 'i'),
];

export interface ParsedLink {
  line: number;
  input: string;
  jobId: string;
  url: string;
}

export interface LinkError {
  line: number;
  input: string;
  code: 'E-LINK';
  message: string;
}

export interface ParseResult {
  links: ParsedLink[];
  errors: LinkError[];
  /** Lines dropped because an earlier line had the same job ID (FR-02). */
  duplicates: number;
  /** Valid links dropped because the batch already had 50 (FR-02, NFR-01). */
  overLimit: number;
}

export function jobUrl(jobId: string): string {
  return `https://www.upwork.com/jobs/${jobId}`;
}

/** Returns the lowercased job ID, or null when the input is not an accepted Upwork job link. */
export function parseJobId(input: string): string | null {
  let raw = input.trim().replace(/^<|>$/g, '');
  if (/^(?:www\.)?upwork\.com\//i.test(raw)) raw = `https://${raw}`;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!ACCEPTED_SCHEMES.has(url.protocol)) return null;
  if (!ACCEPTED_HOSTS.has(url.hostname.toLowerCase())) return null;
  if (url.username || url.password || (url.port && url.port !== '443' && url.port !== '80')) return null;

  // Query strings and fragments are ignored; one trailing slash is allowed.
  const path = decodeURIComponentSafe(url.pathname).replace(/\/+$/, '');
  for (const pattern of JOB_PATHS) {
    const match = pattern.exec(path);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return null;
}

/** FR-01, FR-02, FR-05, FR-06: one link per line; blank lines ignored; duplicates removed. */
export function parseLinks(text: string): ParseResult {
  const links: ParsedLink[] = [];
  const errors: LinkError[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let overLimit = 0;

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const input = rawLine.trim();
    if (!input) return;
    const line = index + 1;
    const jobId = parseJobId(input);
    if (!jobId) {
      errors.push({ line, input, code: 'E-LINK', message: errorMessage('E-LINK') });
      return;
    }
    if (seen.has(jobId)) {
      duplicates += 1;
      return;
    }
    if (links.length >= MAX_LINKS_PER_BATCH) {
      overLimit += 1;
      return;
    }
    seen.add(jobId);
    links.push({ line, input, jobId, url: jobUrl(jobId) });
  });

  return { links, errors, duplicates, overLimit };
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
