// D-32, D-33: the check history, in the Supabase table `job_checks` (supabase/migrations). One row per
// checked job: the job, the verdict and the findings. Failed checks are not stored, and what can be
// derived (the job link, finding IDs, "why" texts) is rebuilt on load. A result that cannot be
// uploaded waits in a local outbox and goes with the next save.

import { CheckerError } from '../core/errors';
import type { Confidence, Evidence, EvidenceKind, Result, SourceId, Verdict } from '../core/types';
import { jobUrl } from '../links/parse';
import { REASON_BY_SOURCE } from '../verdict/rules';
import { database, type Database, type KeyValueStore } from './supabase';

export type StoredVerdict = Exclude<Verdict, 'error'>;

export interface StoredEvidence {
  source: SourceId;
  kind: EvidenceKind;
  value: string;
  confidence: Confidence;
  /** Only when agreement with another source raised the confidence (D-03). */
  raised_from?: Confidence;
  /** Field path, or "attachment <file> > file name". */
  location: string;
  /** Left out when it equals the value. */
  snippet?: string;
  /** Left out when 1. */
  mentions?: number;
}

export interface CheckRow {
  job_id: string;
  checked_at: string;
  job_title: string;
  verdict: StoredVerdict;
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
}

/** Result -> row; null for a failed check. */
export function toRow(result: Result): CheckRow | null {
  if (result.verdict === 'error') return null;
  const best = result.evidence.find((e) => e.id === result.bestEvidenceId);
  const ordered = best ? [best, ...result.evidence.filter((e) => e !== best)] : result.evidence;
  return {
    job_id: result.jobId,
    checked_at: result.checkedAt,
    job_title: result.jobTitle ?? '',
    verdict: result.verdict,
    evidence: ordered.map((e) => ({
      source: e.source,
      kind: e.kind,
      value: e.value,
      confidence: e.confidence,
      ...(e.confidence !== e.baseConfidence ? { raised_from: e.baseConfidence } : {}),
      location: e.location,
      ...(e.snippet && e.snippet !== e.value ? { snippet: e.snippet } : {}),
      ...(e.mentions > 1 ? { mentions: e.mentions } : {}),
    })),
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
  return {
    jobId: row.job_id,
    url: jobUrl(row.job_id),
    checkedAt: row.checked_at,
    jobTitle: row.job_title,
    verdict: row.verdict,
    bestEvidenceId: evidence[0]?.id ?? null,
    evidence,
    error: null,
  };
}

const VERDICT_WORDS: Record<StoredVerdict, string> = {
  has_potential: 'has potential',
  no_potential: 'no potential',
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
/** The best finding is the first one, so the list reads its value from the JSON. */
const SUMMARY = 'job_id,job_title,verdict,checked_at,best_value:evidence->0->>value';
/** Supabase returns at most 1000 rows per request. */
const PAGE = 1000;
const OUTBOX_KEY = 'checksOutbox';

const params = (p: Record<string, string>) =>
  Object.entries(p)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
const inList = (values: readonly string[]) => `in.(${values.map(quote).join(',')})`;

type SummaryRow = Pick<CheckRow, 'job_id' | 'job_title' | 'verdict' | 'checked_at'> & { best_value: string | null };

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
  /** Full checks for an export: the given jobs, or every check. */
  fetch(jobIds: readonly string[] | 'all'): Promise<Result[]>;
  /** Checks waiting in the outbox. */
  pending(): Promise<number>;
  /** Uploads the outbox; returns how many were sent. */
  flush(): Promise<number>;
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
        rows: rows.slice(0, limit).map((r) => ({ jobId: r.job_id, jobTitle: r.job_title, verdict: r.verdict, checkedAt: r.checked_at, bestValue: r.best_value })),
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

    async fetch(jobIds) {
      if (jobIds === 'all') return (await pages({})).map(fromRow);
      const out: CheckRow[] = [];
      for (let i = 0; i < jobIds.length; i += 100) out.push(...(await pages({ job_id: inList(jobIds.slice(i, i + 100)) })));
      return out.map(fromRow);
    },

    async pending() {
      return (await outbox()).length;
    },

    flush,
  };
}

let shared: ChecksStore | null = null;

/** The history store the panel uses. */
export function checksStore(): ChecksStore {
  shared ??= createChecksStore(database(), chrome.storage.local);
  return shared;
}
