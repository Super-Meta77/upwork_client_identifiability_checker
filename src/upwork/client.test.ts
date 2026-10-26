import { describe, expect, it } from 'vitest';
import { CheckerError } from '../core/errors';
import type { ErrorCode } from '../core/types';
import { createGuardedFetch, htmlResponse, jsonResponse, type FetchHandler } from '../../test/fakes/fetch';
import { errorFixture, jobFixture, jobFixtures } from '../../test/fixtures';
import { readJobResponse } from './classify';
import { createUpworkClient, type UpworkDeps } from './client';
import { createGate } from './gate';
import { isAllowedUrl } from './hosts';
import { JOB_DETAILS_QUERY } from './query';
import type { TokenSource } from './token';

const JOB_ID = '~01a2b3c4d5e6f7a8b9';

interface SetupOpts {
  token?: string | null;
  timeoutMs?: number;
}

function setup(handler: FetchHandler, opts: SetupOpts = {}) {
  const guarded = createGuardedFetch(handler);
  const state = { token: opts.token === undefined ? 'pasted-token' : opts.token, requests: 0 };
  const tokens: TokenSource = {
    get: async () => state.token,
    set: async (t) => void (state.token = t),
    clear: async () => void (state.token = null),
  };
  const deps: UpworkDeps = { fetch: guarded.fetch, tokens, gate: createGate(), timeoutMs: opts.timeoutMs ?? 1000, onJobRequest: () => void (state.requests += 1) };
  return { client: createUpworkClient(deps), guarded, state };
}

async function codeOf(promise: Promise<unknown>): Promise<ErrorCode | 'ok'> {
  try {
    await promise;
    return 'ok';
  } catch (e) {
    if (e instanceof CheckerError) return e.code;
    throw e;
  }
}

describe('schema and mapping (FR-14)', () => {
  it.each(jobFixtures().map((f) => [f.name, f.body] as const))('%s validates and maps', async (_name, body) => {
    const job = await readJobResponse(JOB_ID, jsonResponse(body));
    expect(job.jobId).toBe(JOB_ID);
    expect(job.title.length).toBeGreaterThan(0);
  });

  it('ignores unknown fields and trims text', async () => {
    const job = await readJobResponse(JOB_ID, jsonResponse(jobFixture('synthetic-08-extra-fields')));
    expect(job.title).toBe('Logo for a bakery');
    expect(job.questions).toEqual(['Can you show bakery logos?']);
    expect(job.attachmentNames).toEqual([]);
    expect(job.buyer.workHistory).toEqual([]);
    expect(JSON.stringify(job)).not.toContain('unexpectedTopLevel');
  });

  it('maps a minimal response to empty values', async () => {
    const job = await readJobResponse(JOB_ID, jsonResponse(jobFixture('synthetic-04-minimal')));
    expect(job).toMatchObject({ description: '', questions: [], attachmentNames: [], buyer: { companyName: null, workHistory: [] } });
  });

  it('keeps only attachment file names', async () => {
    const job = await readJobResponse(JOB_ID, jsonResponse(jobFixture('synthetic-05-attachments')));
    expect(job.attachmentNames).toContain('Tailspin_Toys_Catalogue_2026.docx');
    expect(JSON.stringify(job)).not.toContain('/att/');
  });
});

describe('error codes (spec "Error handling")', () => {
  const cases: [string, FetchHandler, ErrorCode][] = [
    ['HTTP 401 → E-AUTH', () => jsonResponse({}, 401), 'E-AUTH'],
    ['HTTP 403 with JSON → E-AUTH', () => jsonResponse({ error: 'forbidden' }, 403), 'E-AUTH'],
    ['HTTP 403 with a challenge page → E-BLOCKED (D-12)', () => htmlResponse('<html><head><title>Just a moment...</title></head></html>', 403), 'E-BLOCKED'],
    ['HTTP 403 with a Cloudflare challenge script → E-BLOCKED', () => htmlResponse('<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1"></script>', 403), 'E-BLOCKED'],
    ['HTTP 403 flagged by cf-mitigated → E-BLOCKED', () => new Response('<html></html>', { status: 403, headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' } }), 'E-BLOCKED'],
    ['HTTP 403 with an ordinary HTML page (invalid token, seen in Phase 0) → E-AUTH', () => htmlResponse('<html><head><title>Upwork</title></head><body>captcha recaptcha</body></html>', 403), 'E-AUTH'],
    ['real scope error from the Phase 0 probe → E-SCOPE', () => jsonResponse(errorFixture('probe-2026-10-22-scope-aborted')), 'E-SCOPE'],
    ['real validation error from the Phase 0 probe → E-FORMAT', () => jsonResponse(errorFixture('probe-2026-10-22-validation')), 'E-FORMAT'],
    ['GraphQL unauthenticated → E-AUTH', () => jsonResponse(errorFixture('unauthenticated')), 'E-AUTH'],
    ['GraphQL permission error → E-SCOPE', () => jsonResponse(errorFixture('permission')), 'E-SCOPE'],
    ['per-field permission error with partial data → E-SCOPE, not "no evidence" (D-11)', () => jsonResponse(errorFixture('partial-permission')), 'E-SCOPE'],
    ['GraphQL not found → E-NOTFOUND', () => jsonResponse(errorFixture('not-found')), 'E-NOTFOUND'],
    ['null job without errors → E-NOTFOUND', () => jsonResponse(errorFixture('null-data')), 'E-NOTFOUND'],
    ['HTTP 429 → E-RATE', () => jsonResponse({}, 429), 'E-RATE'],
    ['GraphQL validation error → E-FORMAT', () => jsonResponse(errorFixture('validation'), 400), 'E-FORMAT'],
    ['missing required field → E-FORMAT', () => jsonResponse(errorFixture('missing-title')), 'E-FORMAT'],
    ['non-JSON body → E-FORMAT', () => new Response('<html></html>', { status: 200 }), 'E-FORMAT'],
    ['JSON 4xx without errors → E-FORMAT', () => jsonResponse({ data: null }, 400), 'E-FORMAT'],
    ['unknown GraphQL error → E-FORMAT', () => jsonResponse({ errors: [{ message: 'Something odd' }] }), 'E-FORMAT'],
    ['HTTP 502 → E-NETWORK (server error)', () => jsonResponse({}, 502), 'E-NETWORK'],
    ['connection failure → E-NETWORK', () => Promise.reject(new TypeError('Failed to fetch')), 'E-NETWORK'],
  ];

  it.each(cases)('%s', async (_label, handler, code) => {
    const { client } = setup(handler);
    expect(await codeOf(client.fetchJob(JOB_ID))).toBe(code);
  });

  it('names the missing field in E-FORMAT', async () => {
    const { client } = setup(() => jsonResponse(errorFixture('missing-title')));
    await expect(client.fetchJob(JOB_ID)).rejects.toThrow('opening.job.info.title');
    const v = setup(() => jsonResponse(errorFixture('validation')));
    await expect(v.client.fetchJob(JOB_ID)).rejects.toThrow('contractorName');
    const real = setup(() => jsonResponse(errorFixture('probe-2026-10-22-validation')));
    await expect(real.client.fetchJob(JOB_ID)).rejects.toThrow('field: jobAuthDetails.buyer.workHistory.contractorInfo.contractorNamee');
  });

  it('flags 5xx as a server error so the runner can count them', async () => {
    const { client } = setup(() => jsonResponse({}, 503));
    const error = await client.fetchJob(JOB_ID).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'E-NETWORK', serverError: true });
  });

  it('times out after the configured limit with E-NETWORK', async () => {
    const hang: FetchHandler = (_call, signal) =>
      new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    const { client } = setup(hang, { timeoutMs: 20 });
    const error = await client.fetchJob(JOB_ID).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'E-NETWORK', detail: 'timeout' });
  });
});

describe('token handling (FR-07–FR-11, D-30)', () => {
  it('sends one POST to the GraphQL endpoint with the pasted token and only the listed fields (FR-12)', async () => {
    const { client, guarded, state } = setup(() => jsonResponse(jobFixture('synthetic-01-s1-company')));
    await client.fetchJob(JOB_ID);
    expect(guarded.calls).toHaveLength(1);
    expect(guarded.calls[0]).toMatchObject({ url: 'https://www.upwork.com/api/graphql/v1?alias=gql-query-get-auth-job-details-v2', method: 'POST' });
    expect(guarded.calls[0]?.headers.authorization).toBe('Bearer pasted-token');
    expect(JSON.parse(guarded.calls[0]!.body!)).toEqual({ query: JOB_DETAILS_QUERY, variables: { id: JOB_ID } });
    expect(state.requests).toBe(1);
  });

  it('fails with E-AUTH without a token and makes no request (FR-11)', async () => {
    const { client, guarded } = setup(() => jsonResponse({}), { token: null });
    expect(await codeOf(client.fetchJob(JOB_ID))).toBe('E-AUTH');
    expect(guarded.calls).toHaveLength(0);
  });

  it.each([
    ['a GraphQL unauthenticated error', () => jsonResponse(errorFixture('unauthenticated'))],
    ['the 403 HTML page Upwork sends for an invalid token', () => htmlResponse('<html><title>Upwork</title></html>', 403)],
  ])('clears an expired token on %s, so Settings asks for a fresh one (D-30)', async (_label, handler) => {
    const { client, guarded, state } = setup(handler);
    expect(await codeOf(client.fetchJob(JOB_ID))).toBe('E-AUTH');
    expect(guarded.calls).toHaveLength(1);
    expect(state.token).toBeNull();
  });

  it('keeps a token refused only for scope (E-SCOPE): it is a real token', async () => {
    const { client, state } = setup(() => jsonResponse(errorFixture('permission')));
    expect(await codeOf(client.fetchJob(JOB_ID))).toBe('E-SCOPE');
    expect(state.token).toBe('pasted-token');
  });

  it('sends nothing after Stop (FR-13)', async () => {
    const stop = new AbortController();
    stop.abort();
    const { client, guarded } = setup(() => jsonResponse(jobFixture('synthetic-01-s1-company')));
    await expect(client.fetchJob(JOB_ID, stop.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(guarded.calls).toHaveLength(0);
  });

  it('never puts the token in an error message (NFR-08)', async () => {
    const { client } = setup(() => jsonResponse(errorFixture('unauthenticated')), { token: 'SECRET-TOKEN-123' });
    const error = (await client.fetchJob(JOB_ID).catch((e: unknown) => e)) as Error;
    expect(`${error.message} ${JSON.stringify(error)}`).not.toContain('SECRET-TOKEN-123');
  });
});

describe('request volume and hosts (NFR-01, NFR-07)', () => {
  it('keeps at most one request in flight', async () => {
    const gate = createGate();
    const guarded = createGuardedFetch(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return jsonResponse(jobFixture('synthetic-01-s1-company'));
    });
    const tokens: TokenSource = { get: async () => 't', set: async () => {}, clear: async () => {} };
    const client = createUpworkClient({ fetch: guarded.fetch, tokens, gate, timeoutMs: 1000 });
    await Promise.all([client.fetchJob(JOB_ID), client.fetchJob(JOB_ID), client.fetchJob(JOB_ID)]);
    expect(guarded.maxInFlight()).toBe(1);
    expect(gate.inFlight()).toBe(0);
  });

  it('allows only https://www.upwork.com', () => {
    expect(isAllowedUrl(new URL('https://www.upwork.com/api/graphql/v1'))).toBe(true);
    expect(isAllowedUrl(new URL('http://www.upwork.com/x'))).toBe(false);
    expect(isAllowedUrl(new URL('https://evil.example/x'))).toBe(false);
  });
});
