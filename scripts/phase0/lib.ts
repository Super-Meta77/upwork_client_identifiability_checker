// Phase 0 helpers: read HAR captures, report what the go/no-go gate needs, and anonymise saved
// responses into test fixtures. Reports carry names, counts, hosts and shapes only — never token
// values, cookie values or client data. Client data goes to files under phase0/raw/ (gitignored).

import nlp from 'compromise';
import { isPlaceholderCompanyName } from '../../src/extract/lists/placeholders';
import { scanText } from '../../src/extract/s2text';
import { parseJobId } from '../../src/links/parse';
import { registrableDomain } from '../../src/verdict/normalize';
import { describeShape } from '../../src/upwork/probe';
import { jobAuthDetailsSchema } from '../../src/upwork/schema';

export interface NameValue {
  name: string;
  value: string;
}

export interface HarEntry {
  request: { method: string; url: string; headers: NameValue[]; cookies?: NameValue[]; postData?: { text?: string } };
  response: { status: number; headers: NameValue[]; content: { text?: string; encoding?: string; mimeType?: string } };
}

export interface Har {
  log: { entries: HarEntry[] };
}

export function headerOf(headers: readonly NameValue[], name: string): string | null {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

export function responseText(entry: HarEntry): string | null {
  const { text, encoding } = entry.response.content;
  if (text === undefined) return null;
  return encoding === 'base64' ? Buffer.from(text, 'base64').toString('utf8') : text;
}

export function requestCookies(entry: HarEntry): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of entry.request.cookies ?? []) out.set(c.name, c.value);
  for (const part of (headerOf(entry.request.headers, 'cookie') ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0) out.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return out;
}

export function bearerToken(entry: HarEntry): string | null {
  const auth = headerOf(entry.request.headers, 'authorization');
  const m = auth ? /^bearer\s+(.+)$/i.exec(auth.trim()) : null;
  return m?.[1] ?? null;
}

export function isJobDetailsRequest(entry: HarEntry): boolean {
  return entry.request.url.includes('/api/graphql') && (entry.request.postData?.text ?? '').includes('jobAuthDetails');
}

const safeDecode = (v: string) => {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};

/** Names of cookies whose value equals the bearer token (FR-08). Values are never returned. */
export function cookieNamesForToken(entries: readonly HarEntry[], token: string): string[] {
  const names = new Set<string>();
  for (const e of entries) {
    for (const [name, value] of requestCookies(e)) if (value === token || safeDecode(value) === token) names.add(name);
  }
  return [...names].sort();
}

/** "/jobs/Some-title_~01abc" -> "/jobs/<slug>_~ID" */
export function pathPattern(url: string): string {
  try {
    const u = new URL(url.trim());
    return `${u.hostname}${u.pathname
      .replace(/\/[^/]*_~[a-z0-9]+/gi, '/<slug>_~ID')
      .replace(/~[a-z0-9]+/gi, '~ID')
      .replace(/\/\d{5,}/g, '/:n')
      .replace(/\/[a-f0-9]{16,}/gi, '/:hex')
      .replace(/\/+$/, '')}`;
  } catch {
    return '(not a URL)';
  }
}

interface GraphqlBody {
  query?: string;
  operationName?: string;
  variables?: Record<string, unknown>;
}

function parseBody(text: string | undefined): GraphqlBody[] {
  try {
    const parsed = JSON.parse(text ?? '') as GraphqlBody | GraphqlBody[];
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

const count = <T>(items: readonly T[]): Map<T, number> => {
  const m = new Map<T, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return m;
};

const table = (m: Map<string, number>, header: string): string[] =>
  m.size ? [`| ${header} | Count |`, '| --- | --- |', ...[...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k.replace(/\|/g, '\\|') || '(empty)'} | ${v} |`)] : ['(none)'];

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/** The parts of a raw (unvalidated) response the Phase 0 tools read. */
interface RawHistory {
  feedback?: { comment?: string | null } | null;
  feedbackToClient?: { comment?: string | null } | null;
  contractorInfo?: { contractorName?: string | null } | null;
}

interface RawJob {
  opening?: { job?: { attachments?: ({ uri?: string | null } | null)[] | null } | null } | null;
  buyer?: {
    info?: {
      company?: { name?: unknown; profile?: { size?: unknown; industry?: unknown } | null } | null;
      location?: { city?: unknown } | null;
    } | null;
    workHistory?: (RawHistory | null)[] | null;
  } | null;
}

interface RawBody {
  data?: { jobAuthDetails?: RawJob | null } | null;
  errors?: { message?: string; path?: unknown[]; extensions?: { code?: string } }[];
}

export interface HarAnalysis {
  report: string;
  trimmed: { name: string; body: unknown }[];
  privateNotes: string;
  query: string | null;
}

export function analyzeHar(entries: readonly HarEntry[], links: readonly string[]): HarAnalysis {
  const jobRequests = entries.filter(isJobDetailsRequest);
  const tokens = [...new Set(jobRequests.map(bearerToken).filter((t): t is string => !!t))];
  const cookieNames = [...new Set(tokens.flatMap((t) => cookieNamesForToken(entries, t)))];
  const headerNames = count(jobRequests.flatMap((e) => e.request.headers.map((h) => h.name.toLowerCase())).filter((n) => !n.startsWith(':')));
  const urlShapes = count(jobRequests.map((e) => {
    const u = new URL(e.request.url);
    return `${u.pathname}${[...u.searchParams.keys()].length ? `?${[...u.searchParams].map(([k, v]) => `${k}=${k === 'alias' ? v : '…'}`).join('&')}` : ''}`;
  }));
  const bodies = jobRequests.flatMap((e) => parseBody(e.request.postData?.text));
  const query = bodies.find((b) => b.query?.includes('jobAuthDetails'))?.query ?? null;
  const variableShapes = count(bodies.map((b) => Object.entries(b.variables ?? {}).map(([k, v]) => `${k}: ${typeof v === 'string' ? `string "${v.slice(0, 3)}…" (${v.length})` : typeof v}`).join(', ')));

  const statuses = count(jobRequests.map((e) => String(e.response.status)));
  const errorShapes: string[] = [];
  const shapes = new Map<string, number>();
  const companyNames: string[] = [];
  const sizes: string[] = [];
  const industries: string[] = [];
  const attachmentPaths: string[] = [];
  const historyLengths: number[] = [];
  const schemaIssues: string[] = [];
  const privateLines: string[] = [];
  const trimmed: { name: string; body: unknown }[] = [];

  jobRequests.forEach((entry, i) => {
    let body: RawBody | null;
    try {
      body = JSON.parse(responseText(entry) ?? '') as RawBody | null;
    } catch {
      errorShapes.push(`HTTP ${entry.response.status}: non-JSON body (${headerOf(entry.response.headers, 'content-type') ?? 'no content type'})`);
      return;
    }
    for (const err of body?.errors ?? []) {
      errorShapes.push(`HTTP ${entry.response.status} · code ${err.extensions?.code ?? '—'} · path ${(err.path ?? []).join('.') || '—'} · ${String(err.message ?? '').slice(0, 160)}`);
    }
    const details = body?.data?.jobAuthDetails;
    if (!details) return;
    for (const line of describeShape(details, 'jobAuthDetails')) shapes.set(line.replace(/\(\d+\)/g, ''), (shapes.get(line.replace(/\(\d+\)/g, '')) ?? 0) + 1);

    const company = details.buyer?.info?.company;
    companyNames.push(typeof company?.name === 'string' ? company.name.trim() : '');
    sizes.push(String(company?.profile?.size ?? '(empty)'));
    industries.push(String(company?.profile?.industry ?? '(empty)'));
    for (const a of details.opening?.job?.attachments ?? []) if (a?.uri) attachmentPaths.push(pathPattern(new URL(a.uri, 'https://www.upwork.com').href));
    const history = Array.isArray(details.buyer?.workHistory) ? details.buyer.workHistory : [];
    historyLengths.push(history.length);
    history.slice(0, 3).forEach((w: RawHistory | null, j: number) => {
      privateLines.push(`response ${i + 1} review ${j + 1}`, `  feedback:         ${w?.feedback?.comment ?? '—'}`, `  feedbackToClient: ${w?.feedbackToClient?.comment ?? '—'}`, `  contractorName:   ${w?.contractorInfo?.contractorName ?? '—'}`);
    });

    const parsed = jobAuthDetailsSchema.safeParse(details);
    if (!parsed.success) schemaIssues.push(`response ${i + 1}: ${parsed.error.issues.map((x) => x.path.join('.')).join(', ')}`);
    trimmed.push({ name: `response-${String(i + 1).padStart(2, '0')}`, body: { data: { jobAuthDetails: parsed.success ? parsed.data : details } } });
  });

  const attachmentHosts = count(attachmentPaths.map((p) => p.split('/')[0] ?? ''));
  const downloads = entries.filter((e) => attachmentPaths.length && /\/att\/|attachment/i.test(e.request.url) && !isJobDetailsRequest(e));
  const downloadLines = downloads.slice(0, 10).map((e) => {
    const u = new URL(e.request.url);
    return `| ${u.hostname} | ${pathPattern(e.request.url).replace(u.hostname, '')} | ${e.response.status} | ${bearerToken(e) ? 'yes' : 'no'} | ${[...requestCookies(e).keys()].length} cookies |`;
  });

  const filled = companyNames.filter((n) => n && !isPlaceholderCompanyName(n)).length;
  const placeholderLike = companyNames.filter((n) => isPlaceholderCompanyName(n) || n.length <= 3).map((n) => n || '(empty)');
  privateLines.unshift('Company names (review for placeholders, never commit):', ...companyNames.map((n, i) => `  ${i + 1}. ${n || '(empty)'}`), '');

  const linkIds = links.map((l) => parseJobId(l));
  const report = [
    '# Phase 0 report',
    '',
    `Generated by \`npm run phase0:analyze\` from ${entries.length} HAR entries. Contains no token values, cookie values or client data.`,
    '',
    '## Job-details request',
    '',
    `- Requests found: **${jobRequests.length}**; statuses: ${[...statuses].map(([k, v]) => `${k} × ${v}`).join(', ') || '—'}`,
    `- Cookie whose value equals the bearer token (FR-08): **${cookieNames.join(', ') || 'none found'}**`,
    `- Distinct bearer tokens seen: ${tokens.length}`,
    '',
    '### URL shapes',
    ...table(urlShapes, 'Path and query'),
    '',
    '### Header names sent (values omitted)',
    ...table(headerNames, 'Header'),
    '',
    '### Variables',
    ...table(variableShapes, 'Variables'),
    '',
    query ? 'The page’s own query was saved to `phase0/raw/upwork-query.graphql`. Compare it with `src/upwork/query.ts`.' : 'No query text containing jobAuthDetails was found.',
    '',
    '## Fields',
    '',
    `- company.name filled (not a placeholder): **${filled} of ${companyNames.length}**`,
    '- Placeholder-like company names:',
    ...table(count(placeholderLike), 'Value'),
    '',
    '### Company size values (smallest bucket for S3)',
    ...table(count(sizes), 'Size'),
    '',
    '### Industry values',
    ...table(count(industries), 'Industry'),
    '',
    `### Work history entries per response: min ${Math.min(...(historyLengths.length ? historyLengths : [0]))}, median ${median(historyLengths)}, max ${Math.max(...(historyLengths.length ? historyLengths : [0]))}`,
    '',
    'Review samples are in `phase0/raw/private-notes.txt` to decide which field holds the freelancer’s comment about the client.',
    '',
    '### Field presence (paths seen, with how many responses had them)',
    '',
    '```',
    ...[...shapes].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}  ×${v}`),
    '```',
    '',
    '### Schema check against src/upwork/schema.ts',
    ...(schemaIssues.length ? schemaIssues.map((s) => `- ${s}`) : ['- every response passed']),
    '',
    '## Attachments',
    '',
    ...table(attachmentHosts, 'Host'),
    '',
    ...table(count(attachmentPaths.map((p) => p.slice(p.indexOf('/')))), 'Path pattern'),
    '',
    downloadLines.length ? '| Host | Path | Status | Bearer token | Cookies |\n| --- | --- | --- | --- | --- |\n' + downloadLines.join('\n') : 'No attachment downloads were captured.',
    '',
    '## Errors seen',
    ...(errorShapes.length ? errorShapes.map((e) => `- ${e}`) : ['- none']),
    '',
    '## Links',
    '',
    `- ${links.length} links; accepted by the link parser: **${linkIds.filter(Boolean).length}**`,
    '',
    ...table(count(links.map(pathPattern)), 'Host and path pattern'),
    '',
    ...table(count(linkIds.filter((x): x is string => !!x).map((id) => id.slice(0, 3))), 'Job ID prefix'),
    '',
  ].join('\n');

  return { report, trimmed, privateNotes: privateLines.join('\n'), query };
}

// ---------------------------------------------------------------------------------------------
// Anonymisation

const FIRST = ['Avery', 'Blake', 'Casey', 'Darcy', 'Emery', 'Finley', 'Harper', 'Jordan', 'Kendall', 'Logan', 'Morgan', 'Noel', 'Parker', 'Quinn', 'Reese', 'Rowan', 'Sage', 'Skyler', 'Tatum', 'Wren'];
const LAST = ['Ashdown', 'Bramley', 'Calloway', 'Dunmore', 'Ellery', 'Fairbank', 'Galloway', 'Hartwell', 'Ingram', 'Kestrel', 'Lockhart', 'Merriweather', 'Northcott', 'Pemberton', 'Radley', 'Stanmore', 'Thackeray', 'Underhill', 'Wexley', 'Yardley'];
const STEMS = ['Zelvora', 'Quintaro', 'Brindlewick', 'Corvane', 'Duskhollow', 'Embervale', 'Fernhaven', 'Glimmerton', 'Hollowmere', 'Ironquill', 'Juniper Ridge', 'Kestrelmoor', 'Larkspire', 'Mistral Bay', 'Northwyn', 'Oakhurst Lane', 'Pinecrest Forge', 'Quillmark', 'Riverbend Works', 'Silverthorn'];
const CITIES = ['Aldermere', 'Brackenford', 'Coldwater', 'Dunhallow', 'Eastmarch', 'Fallowfield', 'Greystone', 'Highmoor', 'Ivybridge', 'Kingsreach'];

export function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const pick = <T>(list: readonly T[], key: string): T => list[hash(key) % list.length]!;

export type EntityKind = 'person' | 'company' | 'domain' | 'email' | 'city';

export interface Entity {
  kind: EntityKind;
  value: string;
}

/** A fake with the same shape: same word count for people, same legal ending for companies. */
export function fakeFor(entity: Entity): string {
  const { kind, value } = entity;
  switch (kind) {
    case 'person': {
      const words = value.split(/\s+/);
      const first = pick(FIRST, value);
      if (words.length === 1) return first;
      const initial = /^\p{Lu}\.?$/u.test(words[words.length - 1] ?? '');
      return initial ? `${first} ${pick(LAST, `${value}#`).charAt(0)}.` : `${first} ${pick(LAST, `${value}#`)}`;
    }
    case 'company': {
      const ending = /\s(LLC|L\.L\.C\.|Inc\.?|Ltd\.?|Limited|GmbH|Corp\.?|Co\.|PLC|LLP|Pty Ltd|S\.A\.|BV|B\.V\.)$/.exec(value)?.[0] ?? '';
      return `${pick(STEMS, value)}${ending}`;
    }
    case 'domain':
      return `${pick(STEMS, value).toLowerCase().replace(/\s+/g, '-')}.com`;
    case 'email':
      return `${pick(FIRST, value).toLowerCase()}@${pick(STEMS, value.split('@')[1] ?? value).toLowerCase().replace(/\s+/g, '-')}.com`;
    case 'city':
      return pick(CITIES, value);
  }
}

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out));
  return out;
}

/** Every name-like value in one trimmed response that must not survive into a fixture. */
export function entitiesIn(body: unknown): Entity[] {
  const d = (body as RawBody | null)?.data?.jobAuthDetails;
  const found: Entity[] = [];
  const add = (kind: EntityKind, value: unknown) => {
    if (typeof value === 'string' && value.trim().length >= 2) found.push({ kind, value: value.trim() });
  };
  if (!d) return found;
  const companyName = d.buyer?.info?.company?.name;
  if (typeof companyName === 'string' && !isPlaceholderCompanyName(companyName)) add('company', companyName);
  add('city', d.buyer?.info?.location?.city);
  for (const w of d.buyer?.workHistory ?? []) {
    const name = w?.contractorInfo?.contractorName;
    add('person', name);
    if (typeof name === 'string') add('person', name.split(/\s+/)[0]);
  }
  for (const text of strings(d)) {
    for (const det of scanText(text, undefined, true)) {
      if (det.kind === 'email') add('email', det.value);
      else if (det.kind === 'website') add('domain', registrableDomain(det.value));
      else if (det.kind === 'company_name') add('company', det.value);
      else add('person', det.value);
    }
    for (const person of nlp(text).people().out('array') as string[]) {
      const clean = person.replace(/[^\p{L}\s'.-]/gu, '').trim();
      if (clean.length >= 2 && /^\p{Lu}/u.test(clean)) {
        add('person', clean);
        add('person', clean.split(/\s+/)[0]);
      }
    }
  }
  return found;
}

export type Mapping = Map<string, string>;

export function buildMapping(bodies: readonly unknown[]): Mapping {
  const mapping: Mapping = new Map();
  for (const body of bodies) {
    for (const e of entitiesIn(body)) {
      if (!mapping.has(e.value)) mapping.set(e.value, fakeFor(e));
      if (e.kind === 'domain') {
        const label = e.value.split('.')[0] ?? '';
        if (label.length >= 3 && !mapping.has(label)) mapping.set(label, (mapping.get(e.value) ?? '').split('.')[0] ?? label);
      }
    }
  }
  return mapping;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function replaceAll(text: string, mapping: Mapping): string {
  const keys = [...mapping.keys()].sort((a, b) => b.length - a.length);
  if (!keys.length) return text;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${keys.map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  const lower = new Map([...mapping].map(([k, v]) => [k.toLowerCase(), v]));
  return text.replace(re, (m) => lower.get(m.toLowerCase()) ?? m);
}

export function anonymise(body: unknown, mapping: Mapping, index: number): unknown {
  const walk = (value: unknown, key: string): unknown => {
    if (typeof value === 'string') {
      if (key === 'companyId') return `1100000000${String(hash(value) % 1e9).padStart(9, '0')}`;
      if (key === 'uri') return `/att/download/openings/${index}/attachments/${hash(value).toString(16)}/download`;
      return replaceAll(value, mapping);
    }
    if (Array.isArray(value)) return value.map((v) => walk(v, key));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, k)]));
    return value;
  };
  return walk(body, '');
}

/** Originals (3+ characters) that still appear in a fixture. */
export function findLeaks(fixtureText: string, originals: readonly string[]): string[] {
  const text = fixtureText.toLowerCase();
  return originals.filter((o) => {
    if (o.length < 3) return false;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(o.toLowerCase())}(?![\\p{L}\\p{N}])`, 'u');
    return re.test(text);
  });
}
