// FR-12, NFR-01, NFR-07: one job-details request per check, through the serial gate and only to
// www.upwork.com.

import { CheckerError } from '../core/errors';
import type { JobData } from '../core/types';
import { readJobResponse } from './classify';
import { GRAPHQL_URL, REQUEST_TIMEOUT_MS } from './config';
import { upworkGate, type Gate } from './gate';
import { isAllowedUrl } from './hosts';
import { JOB_DETAILS_QUERY } from './query';
import { chromeTokenSource, type TokenSource } from './token';

export interface UpworkDeps {
  fetch: typeof fetch;
  tokens: TokenSource;
  gate: Gate;
  timeoutMs: number;
  /** Called once per job-details request, for the daily count (NFR-02). */
  onJobRequest?: () => void | Promise<void>;
}

export interface UpworkClient {
  /** `signal`: after Stop, the request is not sent (FR-13). */
  fetchJob(jobId: string, signal?: AbortSignal): Promise<JobData>;
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

export function createUpworkClient(deps: UpworkDeps): UpworkClient {
  async function requestJob(jobId: string, token: string): Promise<JobData> {
    await deps.onJobRequest?.();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
    try {
      if (!isAllowedUrl(new URL(GRAPHQL_URL))) throw new Error('NFR-07: host not allowed');
      const response = await deps.fetch(GRAPHQL_URL, {
        method: 'POST',
        credentials: 'include',
        // NFR-07: refuse redirects so a redirect can never reach another host.
        redirect: 'error',
        headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ query: JOB_DETAILS_QUERY, variables: { id: jobId } }),
        signal: controller.signal,
      });
      return await readJobResponse(jobId, response);
    } catch (error) {
      if (error instanceof CheckerError) throw error;
      throw new CheckerError('E-NETWORK', controller.signal.aborted ? 'timeout' : 'connection');
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async fetchJob(jobId, signal) {
      const token = await deps.tokens.get();
      if (!token) throw new CheckerError('E-AUTH');
      signal?.throwIfAborted();
      try {
        return await deps.gate.run(() => requestJob(jobId, token));
      } catch (error) {
        // An invalid or expired token is dropped, so Settings asks for a fresh one (D-30). A token
        // refused for scope (E-SCOPE) is a real token and is kept.
        if (error instanceof CheckerError && error.code === 'E-AUTH') await deps.tokens.clear();
        throw error;
      }
    },
  };
}
