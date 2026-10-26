// Job links on the search page -> job IDs (FR-03). The watcher reads every link on the page and keeps
// the ones that are job links.

const ACCEPTED_HOSTS = new Set(['www.upwork.com', 'upwork.com']);
const ACCEPTED_SCHEMES = new Set(['https:', 'http:']);

// FR-03: the job ID is "~" followed by letters and digits. Matching is case-insensitive and the
// ID is lowercased (D-17). The prefix is not assumed to be ~01; current links also use ~02.
const ID = '(~[a-z0-9]{8,})';

// FR-03 job paths.
const JOB_PATHS: RegExp[] = [
  new RegExp(`^/jobs/${ID}$`, 'i'),
  new RegExp(`^/jobs/[^/]*_${ID}$`, 'i'),
  new RegExp(`^/nx/search/jobs/details/${ID}$`, 'i'),
  new RegExp(`^/freelance-jobs/apply/[^/]*_${ID}$`, 'i'),
  new RegExp(`^/nx/proposals/job/${ID}$`, 'i'),
];

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

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
