// Phase 0 probe (dev builds only): sends the provisional query with the cookie token and records
// response shapes and error shapes. It reports field paths, types and statuses, never token values
// or field contents. Each run sends at most 8 requests, 3 s apart.

import { GRAPHQL_URL, TOKEN_COOKIE_NAME, toQueryId } from './config';
import { upworkGate, type Gate } from './gate';
import { resolveAllowedUrl } from './hosts';
import { JOB_DETAILS_QUERY } from './query';
import { chromeTokenSource, type TokenSource } from './token';

export interface ProbeStep {
  label: string;
  status: number | null;
  contentType: string | null;
  shape: string[];
  errors: { message: string; code: string; path: string }[];
  note?: string;
}

export interface ProbeDeps {
  fetch: typeof fetch;
  tokens: TokenSource;
  gate: Gate;
  pause: (ms: number) => Promise<void>;
}

const SPACING_MS = 3000;

export function chromeProbeDeps(): ProbeDeps {
  return {
    fetch: globalThis.fetch.bind(globalThis),
    tokens: chromeTokenSource(),
    gate: upworkGate,
    pause: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  };
}

/** "buyer.info.company.name: string", "opening.job.attachments: array(2)" — no values. */
export function describeShape(value: unknown, path = '', out: string[] = [], depth = 0): string[] {
  if (depth > 8 || out.length > 400) return out;
  if (value === null) out.push(`${path}: null`);
  else if (Array.isArray(value)) {
    out.push(`${path}: array(${value.length})`);
    if (value.length) describeShape(value.find((v) => v !== null) ?? null, `${path}[]`, out, depth + 1);
  } else if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) describeShape(v, path ? `${path}.${k}` : k, out, depth + 1);
  } else out.push(`${path}: ${typeof value}${typeof value === 'string' ? `(${(value as string).length})` : ''}`);
  return out;
}

function errorsOf(body: unknown): ProbeStep['errors'] {
  const errors = (body as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(errors)) return [];
  return errors.map((e: { message?: unknown; path?: unknown; extensions?: { code?: unknown; classification?: unknown } }) => ({
    message: String(e?.message ?? '').slice(0, 2000),
    code: String(e?.extensions?.code ?? e?.extensions?.classification ?? ''),
    path: Array.isArray(e?.path) ? e.path.join('.') : '',
  }));
}

/** For non-JSON answers: the page title and the headers that tell a Cloudflare check from an error page. */
function pageClues(response: Response, text: string): string[] {
  const title = /<title[^>]*>([^<]{0,120})<\/title>/i.exec(text)?.[1]?.trim();
  return [
    `non-JSON body (${text.length} chars)`,
    `title: ${title ?? '(none)'}`,
    `server: ${response.headers.get('server') ?? '(none)'}`,
    `cf-mitigated: ${response.headers.get('cf-mitigated') ?? '(none)'}`,
    `cloudflare challenge script: ${text.includes('/cdn-cgi/challenge-platform/') ? 'yes' : 'no'}`,
  ];
}

async function graphql(deps: ProbeDeps, label: string, query: string, id: string, token: string | null): Promise<ProbeStep> {
  return deps.gate.run(async () => {
    try {
      const response = await deps.fetch(GRAPHQL_URL, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ query, variables: { id } }),
      });
      const text = await response.text();
      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {
        /* not JSON */
      }
      return {
        label,
        status: response.status,
        contentType: response.headers.get('content-type'),
        shape: body ? describeShape((body as { data?: unknown }).data ?? null, 'data') : pageClues(response, text),
        errors: errorsOf(body),
      };
    } catch (e) {
      return { label, status: null, contentType: null, shape: [], errors: [], note: e instanceof Error ? e.name : 'request failed' };
    }
  });
}

export async function runProbe(jobIds: string[], deps: ProbeDeps, onStep: (step: ProbeStep) => void): Promise<ProbeStep[]> {
  const steps: ProbeStep[] = [];
  const push = (s: ProbeStep) => {
    steps.push(s);
    onStep(s);
  };
  const cookie = await deps.tokens.getCookie();
  push({ label: `cookie ${TOKEN_COOKIE_NAME}`, status: null, contentType: null, shape: [cookie ? `present (${cookie.length} chars)` : 'missing'], errors: [] });
  if (!cookie) return steps;

  let first = true;
  const next = async () => {
    if (!first) await deps.pause(SPACING_MS);
    first = false;
  };

  for (const id of jobIds.slice(0, 3)) {
    await next();
    push(await graphql(deps, `job details ${id} (cookie token)`, JOB_DETAILS_QUERY, toQueryId(id), cookie));
  }

  const probeId = jobIds[0] ?? '~01000000000000000000';
  await next();
  push(await graphql(deps, 'unknown job id', JOB_DETAILS_QUERY, '~01000000000000000000', cookie));
  await next();
  push(await graphql(deps, 'no token (cookies only)', JOB_DETAILS_QUERY, toQueryId(probeId), null));
  await next();
  push(await graphql(deps, 'invalid token', JOB_DETAILS_QUERY, toQueryId(probeId), 'invalid-token-for-phase0-probe'));
  await next();
  push(await graphql(deps, 'misspelled field', JOB_DETAILS_QUERY.replace('contractorName', 'contractorNamee'), toQueryId(probeId), cookie));
  return steps;
}

/** The job-details fields split into groups, so a scope refusal can be traced to the groups it affects. */
export const FIELD_GROUPS: readonly { name: string; uses: string; selection: string }[] = [
  { name: 'job post', uses: 'S2 text, S2 files', selection: 'opening { job { info { title } description attachments { fileName uri length } } questions { question } }' },
  { name: 'company', uses: 'S1, S3', selection: 'buyer { info { company { name companyId contractDate profile { industry size } } } }' },
  { name: 'location', uses: 'S3', selection: 'buyer { info { location { city country countryTimezone } } }' },
  { name: 'enterprise flag', uses: 'S3', selection: 'buyer { enterprise }' },
  { name: 'spend and hires', uses: 'S3', selection: 'buyer { info { stats { totalCharges { amount } totalAssignments feedbackCount } } }' },
  { name: 'posted and open jobs', uses: 'S3', selection: 'buyer { info { jobs { postedCount openJobs { title } } } }' },
  { name: 'work history and reviews', uses: 'S3, S5', selection: 'buyer { workHistory { jobInfo { title } feedback { comment } feedbackToClient { comment } contractorInfo { contractorName } } }' },
];

export const groupQuery = (selection: string): string => `query ProbeGroup($id: ID!) { jobAuthDetails(id: $id) { ${selection} } }`;

function verdictOf(step: ProbeStep): string {
  if (step.status !== 200) return `failed (HTTP ${step.status ?? 'no response'})`;
  if (step.errors.some((e) => /permission|scope/i.test(e.message))) return 'REFUSED (scope)';
  if (step.errors.length) return `error: ${step.errors[0]?.code || step.errors[0]?.message.slice(0, 80)}`;
  return step.shape.some((s) => s.startsWith('data: null')) ? 'empty' : 'ALLOWED';
}

/**
 * Second probe: asks for each field group on its own with the cookie token, so the report shows which
 * groups the token may read. Then asks for an unknown job with only the job-post group, to see the
 * not-found shape without a scope refusal hiding it. 8 requests, 3 s apart.
 */
export async function probeFieldAccess(jobId: string, deps: ProbeDeps, onStep: (step: ProbeStep) => void): Promise<ProbeStep[]> {
  const steps: ProbeStep[] = [];
  const cookie = await deps.tokens.getCookie();
  if (!cookie) {
    const missing: ProbeStep = { label: `cookie ${TOKEN_COOKIE_NAME}`, status: null, contentType: null, shape: ['missing'], errors: [] };
    onStep(missing);
    return [missing];
  }
  for (const [i, group] of FIELD_GROUPS.entries()) {
    if (i > 0) await deps.pause(SPACING_MS);
    const step = await graphql(deps, `field group "${group.name}" (${group.uses})`, groupQuery(group.selection), toQueryId(jobId), cookie);
    step.note = verdictOf(step);
    steps.push(step);
    onStep(step);
  }
  await deps.pause(SPACING_MS);
  const unknown = await graphql(deps, 'unknown job id, job-post fields only', groupQuery(FIELD_GROUPS[0]!.selection), '~01000000000000000000', cookie);
  steps.push(unknown);
  onStep(unknown);
  return steps;
}

/** Downloads one attachment to learn its host, status and type. Reports no content. */
export async function probeAttachment(uri: string, deps: ProbeDeps): Promise<ProbeStep> {
  const url = resolveAllowedUrl(uri);
  if (!url) {
    let host = 'invalid';
    try {
      host = new URL(uri, 'https://www.upwork.com').hostname;
    } catch {
      /* keep "invalid" */
    }
    return { label: 'attachment', status: null, contentType: null, shape: [`host ${host} is not allowed yet — add it in config.ts and the manifest if Phase 0 confirms it`], errors: [] };
  }
  const token = await deps.tokens.getCookie();
  return deps.gate.run(async () => {
    const response = await deps.fetch(url.href, { credentials: 'include', headers: token ? { authorization: `Bearer ${token}` } : {} });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      label: `attachment on ${url.hostname}`,
      status: response.status,
      contentType: response.headers.get('content-type'),
      shape: [`${bytes.length} bytes`, `first bytes ${[...bytes.slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`],
      errors: [],
    };
  });
}
