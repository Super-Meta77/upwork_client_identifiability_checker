// FR-12, FR-15, NFR-01, NFR-07: one job-details request per attempt and attachment downloads,
// all through the serial gate and only to allowed hosts.

import { AttachError, CheckerError } from '../core/errors';
import { log } from '../core/log';
import type { AttachmentRef, JobData } from '../core/types';
import { expectedKind, MAX_ATTACHMENT_BYTES } from '../extract/props/sniff';
import { readJobResponse } from './classify';
import { ATTACHMENTS_NEED_TOKEN, GRAPHQL_URL, MAX_TOKEN_ATTEMPTS, REQUEST_TIMEOUT_MS, toQueryId } from './config';
import { upworkGate, type Gate } from './gate';
import { isAllowedUrl, resolveAllowedUrl } from './hosts';
import { JOB_DETAILS_QUERY } from './query';
import { candidateTokens, chromeTokenSource, type TokenSource } from './token';

/** D-29: codes that mean "this token was refused; try the next candidate". */
const TOKEN_RETRY_CODES: ReadonlySet<string> = new Set(['E-AUTH', 'E-SCOPE']);

export interface UpworkDeps {
  fetch: typeof fetch;
  tokens: TokenSource;
  gate: Gate;
  timeoutMs: number;
  /** Called once per job-details request, for the daily count (NFR-02). */
  onJobRequest?: () => void | Promise<void>;
}

export interface UpworkClient {
  fetchJob(jobId: string): Promise<JobData>;
  downloadAttachment(attachment: AttachmentRef): Promise<Uint8Array>;
}

export function chromeUpworkDeps(overrides: Partial<UpworkDeps> = {}): UpworkDeps {
  return {
    fetch: globalThis.fetch.bind(globalThis),
    tokens: chromeTokenSource(),
    gate: upworkGate,
    timeoutMs: REQUEST_TIMEOUT_MS,
    ...overrides,
  };
}

async function withTimeout<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export function createUpworkClient(deps: UpworkDeps): UpworkClient {
  const guardedFetch = (url: string, init: RequestInit): Promise<Response> => {
    if (!isAllowedUrl(new URL(url))) throw new Error('NFR-07: host not allowed');
    return deps.fetch(url, init);
  };

  async function requestJob(jobId: string, token: string): Promise<JobData> {
    await deps.onJobRequest?.();
    return withTimeout(deps.timeoutMs, async (signal) => {
      let response: Response;
      try {
        response = await guardedFetch(GRAPHQL_URL, {
          method: 'POST',
          credentials: 'include',
          // NFR-07: refuse redirects so a redirect can never reach a host the fetch guard did not check.
          redirect: 'error',
          headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ query: JOB_DETAILS_QUERY, variables: { id: toQueryId(jobId) } }),
          signal,
        });
        return await readJobResponse(jobId, response);
      } catch (error) {
        if (error instanceof CheckerError) throw error;
        throw new CheckerError('E-NETWORK', signal.aborted ? 'timeout' : 'connection');
      }
    });
  }

  return {
    async fetchJob(jobId) {
      // D-29: try candidates (last working token, captured page token, then cookies) until one is
      // accepted. A token refused for login (E-AUTH) or scope (E-SCOPE) falls through to the next.
      const candidates = (await candidateTokens(deps.tokens)).slice(0, MAX_TOKEN_ATTEMPTS);
      if (!candidates.length) throw new CheckerError('E-AUTH');
      let lastError: CheckerError = new CheckerError('E-AUTH');
      for (let i = 0; i < candidates.length; i += 1) {
        const { token, source } = candidates[i]!;
        try {
          const job = await deps.gate.run(() => requestJob(jobId, token));
          await deps.tokens.setSession(token);
          return job;
        } catch (error) {
          if (!(error instanceof CheckerError) || !TOKEN_RETRY_CODES.has(error.code)) throw error;
          lastError = error;
          // FR-09: drop the remembered session token once it is refused, so it is not tried again.
          if (source === 'session') await deps.tokens.clearSession();
          log.warn(`token from ${source} refused (${error.code}); trying the next login source`);
        }
      }
      throw lastError;
    },

    async downloadAttachment({ fileName, uri, length }) {
      if (!expectedKind(fileName)) throw new AttachError(fileName, 'this file type is not analysed');
      if (length !== null && length > MAX_ATTACHMENT_BYTES) throw new AttachError(fileName, 'the file is larger than 10 MB');
      if (!uri) throw new AttachError(fileName, 'Upwork gave no download location');
      const url = resolveAllowedUrl(uri);
      if (!url) throw new AttachError(fileName, 'the file is stored on a host this extension may not contact');

      const token = ATTACHMENTS_NEED_TOKEN ? await deps.tokens.getSession() : null;
      return deps.gate.run(() =>
        withTimeout(deps.timeoutMs, async (signal) => {
          let response: Response;
          try {
            response = await guardedFetch(url.href, {
              credentials: 'include',
              // NFR-07: an attachment that redirects (e.g. to a CDN Phase 0 has not confirmed) is not
              // followed; it fails as E-ATTACH rather than reaching an unchecked host.
              redirect: 'error',
              headers: token ? { authorization: `Bearer ${token}` } : {},
              signal,
            });
          } catch {
            throw new AttachError(fileName, 'the download failed');
          }
          if (!response.ok) throw new AttachError(fileName, `the download failed (HTTP ${response.status})`);
          return readCapped(fileName, response);
        }),
      );
    },
  };
}

/** D-15: enforce the 10 MB limit while downloading instead of trusting the reported size. */
async function readCapped(fileName: string, response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_ATTACHMENT_BYTES) throw new AttachError(fileName, 'the file is larger than 10 MB');
  if (!response.body) return new Uint8Array(await response.arrayBuffer());

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_ATTACHMENT_BYTES) {
        await reader.cancel();
        throw new AttachError(fileName, 'the file is larger than 10 MB');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AttachError) throw error;
    throw new AttachError(fileName, 'the download was interrupted');
  }
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}
