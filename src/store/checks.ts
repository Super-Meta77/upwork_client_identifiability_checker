// D-32: the check history, in the Supabase table `job_checks` (supabase/migrations). One row per
// checked job, holding only what the panel shows or uses. Failed checks are not stored, and what
// can be derived (the job link, finding IDs, "why" texts, matches with a known name) is rebuilt on
// load. A result that cannot be uploaded waits in a local outbox and goes with the next save.

import { CheckerError } from '../core/errors';
import type { Confidence, Evidence, EvidenceKind, GroundTruth, Result, S3Detail, SourceId, Verdict } from '../core/types';
import { withMatches } from '../eval/match';
import { jobUrl } from '../links/parse';
import { REASON_BY_SOURCE } from '../verdict/rules';
import { deleteLegacyResults, readLegacyResults } from './legacy';
import type { PeerCounts } from './peers';
import { database, type Database, type KeyValueStore } from './supabase';

export type StoredVerdict = Exclude<Verdict, 'error'>;

export interface StoredEvidence {
  source: Exclude<SourceId, 'S3'>;
  kind: EvidenceKind;
  value: string;
  confidence: Confidence;
  /** Only when agreement with another source raised the confidence (D-03). */
  raised_from?: Confidence;
  /** Field path, or "attachment <file> > <part> > <field>". */
  location: string;
  /** Left out when it equals the value. */
  snippet?: string;
  /** Left out when 1. */
  mentions?: number;
}

export interface KnownClient {
  known_person: string | null;
  known_company: string | null;
  known_website: string | null;
}

export interface CheckRow extends Partial<KnownClient> {
  job_id: string;
  checked_at: string;
  job_title: string;
  verdict: StoredVerdict;
  best_value: string | null;
  s3_score: number;
  s3_details: S3Detail[];
  client_company_id: string | null;
  client_country: string | null;
  client_city: string | null;
  client_industry: string | null;
  client_size: string | null;
  client_since: number | null;
  /** Best finding first. */
  evidence: StoredEvidence[];
}

/** One line of the History list. */
export interface CheckSummary {
  jobId: string;
  jobTitle: string;
  verdict: StoredVerdict;
  checkedAt: string;
  bestValue: string | null;
  s3Score: number;
}

export function knownClient(gt: GroundTruth | null | undefined): KnownClient {
  return { known_person: gt?.personName ?? null, known_company: gt?.companyName ?? null, known_website: gt?.website ?? null };
}

/** Result -> row; null for a failed check. The known name is included only when asked for. */
export function toRow(result: Result, withKnownClient = false): CheckRow | null {
  if (result.verdict === 'error' || !result.distinctiveness) return null;
  const best = result.evidence.find((e) => e.id === result.bestEvidenceId);
  const ordered = best ? [best, ...result.evidence.filter((e) => e !== best)] : result.evidence;
  const p = result.profile;
  return {
    job_id: result.jobId,
    checked_at: result.checkedAt,
    job_title: result.jobTitle ?? '',
    verdict: result.verdict,
    best_value: best?.value ?? null,
    s3_score: result.distinctiveness.score,
    s3_details: result.distinctiveness.details,
    client_company_id: p?.companyId ?? null,
    client_country: p?.country ?? null,
    client_city: p?.city ?? null,
    client_industry: p?.industry ?? null,
    client_size: p?.size ?? null,
    client_since: p?.memberSinceYear ?? null,
    evidence: ordered.map((e) => ({
      source: e.source as StoredEvidence['source'],
      kind: e.kind,
      value: e.value,
      confidence: e.confidence,
      ...(e.confidence !== e.baseConfidence ? { raised_from: e.baseConfidence } : {}),
      location: e.location,
      ...(e.snippet && e.snippet !== e.value ? { snippet: e.snippet } : {}),
      ...(e.mentions > 1 ? { mentions: e.mentions } : {}),
    })),
    ...(withKnownClient ? knownClient(result.groundTruth) : {}),
  };
}

/** Row -> the Result the panel shows. */
export function fromRow(row: CheckRow): Result {
  const evidence: Evidence[] = row.evidence.map((e, i) => ({
    id: `e${i}`,
    source: e.source,
    kind: e.kind,
    location: e.location,
    value: e.value,
    snippet: e.snippet ?? e.value,
    confidence: e.confidence,
    baseConfidence: e.raised_from ?? e.confidence,
    reasonId: REASON_BY_SOURCE[e.source],
    mentions: e.mentions ?? 1,
    agreesWith: [],
  }));
  const result: Result = {
    jobId: row.job_id,
    url: jobUrl(row.job_id),
    checkedAt: row.checked_at,
    jobTitle: row.job_title,
    verdict: row.verdict,
    bestEvidenceId: evidence[0]?.id ?? null,
    distinctiveness: { score: row.s3_score, attributes: row.s3_details.map((d) => d.attribute), details: row.s3_details },
    evidence,
    error: null,
    groundTruth: null,
    attachmentNotes: [],
    profile: {
      companyId: row.client_company_id,
      country: row.client_country,
      city: row.client_city,
      industry: row.client_industry,
      size: row.client_size,
      memberSinceYear: row.client_since,
    },
  };
  const known = { personName: row.known_person ?? undefined, companyName: row.known_company ?? undefined, website: row.known_website ?? undefined };
  if (known.personName || known.companyName || known.website) result.groundTruth = withMatches(result, known);
  return result;
}

const VERDICT_WORDS: Record<StoredVerdict, string> = {
  identified: 'identified before contact',
  partial: 'partially identified',
  narrowable: 'narrowable',
  not_identifiable: 'not identifiable before contact',
};

/** PostgREST filter value in double quotes, so commas and brackets in it are kept. */
const quote = (value: string) => `"${value.replace(/[\\"]/g, '\\$&')}"`;

/** FR-32: search by job ID, title or verdict, as a PostgREST `or` filter; null for no search. */
export function searchFilter(query: string): string | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const like = quote(`*${q}*`);
  const verdicts = (Object.keys(VERDICT_WORDS) as StoredVerdict[]).filter((v) => v.includes(q.replace(/\s+/g, '_')) || VERDICT_WORDS[v].includes(q));
  const parts = [`job_title.ilike.${like}`, `job_id.ilike.${like}`];
  if (verdicts.length) parts.push(`verdict.in.(${verdicts.join(',')})`);
  return `(${parts.join(',')})`;
}

const TABLE = 'job_checks';
const SUMMARY = 'job_id,job_title,verdict,checked_at,best_value,s3_score';
/** Supabase returns at most 1000 rows per request. */
const PAGE = 1000;
const OUTBOX_KEY = 'checksOutbox';

const params = (p: Record<string, string>) =>
  Object.entries(p)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
const inList = (values: readonly string[]) => `in.(${values.map(quote).join(',')})`;

type SummaryRow = Pick<CheckRow, 'job_id' | 'job_title' | 'verdict' | 'checked_at' | 'best_value' | 's3_score'>;
interface PeerRow {
  country: number | null;
  city: number | null;
  industry: number | null;
  size: number | null;
  member_since: number | null;
}

export interface ChecksStore {
  /** Saves a check; failed checks are skipped and an upload that fails waits in the outbox. */
  save(result: Result): Promise<void>;
  get(jobId: string): Promise<Result | null>;
  /** History newest first, `limit` rows from `offset`. */
  list(query: string, offset: number, limit?: number): Promise<{ rows: CheckSummary[]; more: boolean }>;
  /** The jobs among `jobIds` that have a saved check (uploaded or waiting). */
  checkedIds(jobIds: readonly string[]): Promise<Set<string>>;
  remove(jobId: string): Promise<void>;
  removeAll(): Promise<void>;
  setKnownClient(jobId: string, gt: GroundTruth | null): Promise<Result | null>;
  /** Checks with a known client name, for the accuracy report (FR-36). */
  withKnownClient(): Promise<Result[]>;
  /** Full checks for an export: the given jobs, or every check. */
  fetch(jobIds: readonly string[] | 'all'): Promise<Result[]>;
  /** FR-22: how many other clients share each detail, counted in the database. */
  peers(jobId: string): Promise<PeerCounts>;
  /** Checks waiting in the outbox. */
  pending(): Promise<number>;
  /** Uploads the outbox; returns how many were sent. */
  flush(): Promise<number>;
  /** Uploads the history of earlier versions once, then deletes it; returns how many moved. */
  moveLegacyHistory(factory?: IDBFactory): Promise<number>;
}

export function createChecksStore(db: Database, local: KeyValueStore): ChecksStore {
  // Outbox changes run one at a time, so a save during an upload is never lost.
  let outboxQueue: Promise<unknown> = Promise.resolve();
  const withOutbox = <T>(work: (rows: CheckRow[]) => Promise<{ rows: CheckRow[]; value: T }>): Promise<T> => {
    const next = outboxQueue.then(async () => {
      const rows = ((await local.get(OUTBOX_KEY))[OUTBOX_KEY] as CheckRow[] | undefined) ?? [];
      const out = await work(rows);
      if (out.rows !== rows) await local.set({ [OUTBOX_KEY]: out.rows });
      return out.value;
    });
    outboxQueue = next.catch(() => undefined);
    return next;
  };
  const outbox = () => withOutbox(async (rows) => ({ rows, value: rows }));

  const upsert = (rows: CheckRow[]) =>
    db.rest<void>(`${TABLE}?on_conflict=user_id,job_id`, { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=minimal' });

  const pages = async (filter: Record<string, string>): Promise<CheckRow[]> => {
    const out: CheckRow[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const rows = await db.rest<CheckRow[]>(`${TABLE}?${params({ select: '*', ...filter, order: 'checked_at.desc', offset: String(offset), limit: String(PAGE) })}`);
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  };

  const flush = () =>
    withOutbox(async (rows) => {
      if (!rows.length) return { rows, value: 0 };
      await upsert(rows);
      return { rows: [], value: rows.length };
    });

  return {
    async save(result) {
      const row = toRow(result);
      if (!row) return;
      try {
        await upsert([row]);
      } catch (error) {
        if (!(error instanceof CheckerError)) throw error;
        await withOutbox(async (rows) => ({ rows: [...rows.filter((r) => r.job_id !== row.job_id), row], value: undefined }));
        return;
      }
      await flush().catch(() => 0);
    },

    async get(jobId) {
      const waiting = async () => (await outbox()).find((r) => r.job_id === jobId);
      let row: CheckRow | undefined;
      try {
        [row] = await db.rest<CheckRow[]>(`${TABLE}?${params({ select: '*', job_id: `eq.${jobId}` })}`);
      } catch (error) {
        // Offline: a check waiting in the outbox can still be opened.
        if (!(error instanceof CheckerError) || !(row = await waiting())) throw error;
      }
      row ??= await waiting();
      return row ? fromRow(row) : null;
    },

    async list(query, offset, limit = 100) {
      const filter = searchFilter(query);
      const rows = await db.rest<SummaryRow[]>(
        `${TABLE}?${params({ select: SUMMARY, ...(filter ? { or: filter } : {}), order: 'checked_at.desc', offset: String(offset), limit: String(limit + 1) })}`,
      );
      return {
        rows: rows.slice(0, limit).map((r) => ({ jobId: r.job_id, jobTitle: r.job_title, verdict: r.verdict, checkedAt: r.checked_at, bestValue: r.best_value, s3Score: r.s3_score })),
        more: rows.length > limit,
      };
    },

    async checkedIds(jobIds) {
      if (!jobIds.length) return new Set();
      const known = new Set((await outbox()).map((r) => r.job_id));
      try {
        const rows = await db.rest<{ job_id: string }[]>(`${TABLE}?${params({ select: 'job_id', job_id: inList(jobIds) })}`);
        for (const r of rows) known.add(r.job_id);
      } catch (error) {
        // Offline: only the outbox is known. The watcher's own memory still prevents repeats.
        if (!(error instanceof CheckerError)) throw error;
      }
      return new Set(jobIds.filter((id) => known.has(id)));
    },

    async remove(jobId) {
      await withOutbox(async (rows) => ({ rows: rows.filter((r) => r.job_id !== jobId), value: undefined }));
      await db.rest(`${TABLE}?${params({ job_id: `eq.${jobId}` })}`, { method: 'DELETE' });
    },

    async removeAll() {
      await withOutbox(async () => ({ rows: [], value: undefined }));
      // Supabase refuses a DELETE without a filter; the table's access rule limits it to the user's rows.
      await db.rest(`${TABLE}?job_id=not.is.null`, { method: 'DELETE' });
    },

    async setKnownClient(jobId, gt) {
      const [row] = await db.rest<CheckRow[]>(`${TABLE}?${params({ job_id: `eq.${jobId}` })}`, { method: 'PATCH', body: knownClient(gt), prefer: 'return=representation' });
      return row ? fromRow(row) : null;
    },

    async withKnownClient() {
      return (await pages({ or: '(known_person.not.is.null,known_company.not.is.null,known_website.not.is.null)' })).map(fromRow);
    },

    async fetch(jobIds) {
      if (jobIds === 'all') return (await pages({})).map(fromRow);
      const out: CheckRow[] = [];
      for (let i = 0; i < jobIds.length; i += 100) out.push(...(await pages({ job_id: inList(jobIds.slice(i, i + 100)) })));
      return out.map(fromRow);
    },

    async peers(jobId) {
      const [row] = await db.rest<PeerRow[]>('rpc/peer_counts', { method: 'POST', body: { p_job_id: jobId } });
      return { country: row?.country ?? null, city: row?.city ?? null, industry: row?.industry ?? null, size: row?.size ?? null, memberSinceYear: row?.member_since ?? null };
    },

    async pending() {
      return (await outbox()).length;
    },

    flush,

    async moveLegacyHistory(factory) {
      const results = await readLegacyResults(factory);
      if (results === null) return 0;
      const rows = results.map((r) => toRow(r, true)).filter((r): r is CheckRow => r !== null);
      for (let i = 0; i < rows.length; i += 500) await upsert(rows.slice(i, i + 500));
      await deleteLegacyResults(factory);
      return rows.length;
    },
  };
}

let shared: ChecksStore | null = null;

/** The history store the panel uses. */
export function checksStore(): ChecksStore {
  shared ??= createChecksStore(database(), chrome.storage.local);
  return shared;
}
