import { describe, expect, it } from 'vitest';
import { AttachError, CheckerError } from '../core/errors';
import type { ErrorCode } from '../core/types';
import { fakeChrome } from '../../test/fakes/chrome';
import { createGuardedFetch, htmlResponse, jsonResponse, type FetchHandler } from '../../test/fakes/fetch';
import { errorFixture, jobFixture, jobFixtures } from '../../test/fixtures';
import { readJobResponse } from './classify';
import { createUpworkClient, type UpworkDeps } from './client';
import { TOKEN_COOKIE_NAME } from './config';
import { createGate } from './gate';
import { resolveAllowedUrl } from './hosts';
import { JOB_DETAILS_QUERY } from './query';
import { candidateTokens, chromeTokenSource, type TokenSource } from './token';

const JOB_ID = '~01a2b3c4d5e6f7a8b9';

function setup(handler: FetchHandler, opts: { session?: string | null; cookie?: string | null; timeoutMs?: number } = {}) {
  const guarded = createGuardedFetch(handler);
  const state = { session: opts.session ?? null, requests: 0 };
  const tokens: TokenSource = {
    getSession: async () => state.session,
    setSession: async (t) => void (state.session = t),
    clearSession: async () => void (state.session = null),
    getCookie: async () => (opts.cookie === undefined ? 'cookie-token' : opts.cookie),
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

  it('ignores unknown fields, trims text and coerces numbers', async () => {
    const job = await readJobResponse(JOB_ID, jsonResponse(jobFixture('synthetic-08-extra-fields')));
    expect(job.title).toBe('Logo for a bakery');
    expect(job.questions).toEqual(['Can you show bakery logos?']);
    expect(job.attachments).toEqual([]);
    expect(job.buyer.size).toBe('2');
    expect(job.buyer.totalCharges).toBeNull();
    expect(job.buyer.openJobTitles).toEqual(['Logo for a bakery']);
    expect(job.buyer.workHistory).toEqual([]);
    expect(JSON.stringify(job)).not.toContain('unexpectedTopLevel');
  });

  it('maps a minimal response to empty values', async () => {
    const job = await readJobResponse(JOB_ID, jsonResponse(jobFixture('synthetic-04-minimal')));
    expect(job).toMatchObject({ description: '', questions: [], attachments: [], buyer: { companyName: null, workHistory: [], openJobTitles: [] } });
  });

  it('maps numbers sent as strings', async () => {
    const job = await readJobResponse(JOB_ID, jsonResponse(jobFixture('synthetic-06-reviews')));
    expect(job.buyer).toMatchObject({ totalCharges: 3120, totalAssignments: 6, feedbackCount: 5 });
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

describe('token handling (FR-07–FR-09, FR-11)', () => {
  it('sends one POST to the GraphQL endpoint with the cookie token and only the listed fields (FR-12)', async () => {
    const { client, guarded, state } = setup(() => jsonResponse(jobFixture('synthetic-01-s1-company')));
    await client.fetchJob(JOB_ID);
    expect(guarded.calls).toHaveLength(1);
    expect(guarded.calls[0]).toMatchObject({ url: 'https://www.upwork.com/api/graphql/v1', method: 'POST' });
    expect(guarded.calls[0]?.headers.authorization).toBe('Bearer cookie-token');
    expect(JSON.parse(guarded.calls[0]!.body!)).toEqual({ query: JOB_DETAILS_QUERY, variables: { id: JOB_ID } });
    expect(state.session).toBe('cookie-token');
    expect(state.requests).toBe(1);
  });

  it('tries the last working token first (FR-09)', async () => {
    const { client, guarded } = setup(() => jsonResponse(jobFixture('synthetic-01-s1-company')), { session: 'session-token' });
    await client.fetchJob(JOB_ID);
    expect(guarded.calls[0]?.headers.authorization).toBe('Bearer session-token');
  });

  it('drops a stale session token and retries once with the cookie token', async () => {
    const { client, guarded, state } = setup(
      (call) => (call.headers.authorization === 'Bearer stale' ? jsonResponse({}, 401) : jsonResponse(jobFixture('synthetic-01-s1-company'))),
      { session: 'stale' },
    );
    await client.fetchJob(JOB_ID);
    expect(guarded.calls.map((c) => c.headers.authorization)).toEqual(['Bearer stale', 'Bearer cookie-token']);
    expect(state.session).toBe('cookie-token');
  });

  it('falls back to the cookie token when a stale token gets the 403 HTML page (Phase 0 finding)', async () => {
    const { client, guarded, state } = setup(
      (call) => (call.headers.authorization === 'Bearer stale' ? htmlResponse('<html><title>Upwork</title></html>', 403) : jsonResponse(jobFixture('synthetic-01-s1-company'))),
      { session: 'stale' },
    );
    await client.fetchJob(JOB_ID);
    expect(guarded.calls.map((c) => c.headers.authorization)).toEqual(['Bearer stale', 'Bearer cookie-token']);
    expect(state.session).toBe('cookie-token');
  });

  it('fails with E-AUTH without any token and makes no request (FR-11)', async () => {
    const { client, guarded } = setup(() => jsonResponse({}), { cookie: null });
    expect(await codeOf(client.fetchJob(JOB_ID))).toBe('E-AUTH');
    expect(guarded.calls).toHaveLength(0);
  });

  it('never puts the token in an error message (NFR-08)', async () => {
    const { client } = setup(() => jsonResponse(errorFixture('unauthenticated')), { cookie: 'SECRET-TOKEN-123' });
    const error = (await client.fetchJob(JOB_ID).catch((e: unknown) => e)) as Error;
    expect(`${error.message} ${JSON.stringify(error)}`).not.toContain('SECRET-TOKEN-123');
  });

  it('reads the named cookie and keeps the token only in session storage', async () => {
    const chrome = fakeChrome();
    chrome._cookies.set(TOKEN_COOKIE_NAME, 'abc%3D');
    const source = chromeTokenSource();
    expect(await candidateTokens(source)).toEqual(['abc=']);
    await source.setSession('abc=');
    expect(chrome.storage.session.dump()).toEqual({ upworkToken: 'abc=' });
    expect(chrome.storage.local.dump()).toEqual({});
    await source.clearSession();
    expect(await source.getSession()).toBeNull();
  });
});

describe('request volume and hosts (NFR-01, NFR-07)', () => {
  it('keeps at most one request in flight', async () => {
    const gate = createGate();
    const guarded = createGuardedFetch(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return jsonResponse(jobFixture('synthetic-01-s1-company'));
    });
    const tokens: TokenSource = { getSession: async () => 't', setSession: async () => {}, clearSession: async () => {}, getCookie: async () => 't' };
    const client = createUpworkClient({ fetch: guarded.fetch, tokens, gate, timeoutMs: 1000 });
    await Promise.all([client.fetchJob(JOB_ID), client.fetchJob(JOB_ID), client.downloadAttachment({ fileName: 'a.pdf', uri: '/att/1', length: 10 }).catch(() => null)]);
    expect(guarded.maxInFlight()).toBe(1);
    expect(gate.inFlight()).toBe(0);
  });

  it('resolves attachment locations only on allowed hosts', () => {
    expect(resolveAllowedUrl('/att/download/1')?.href).toBe('https://www.upwork.com/att/download/1');
    expect(resolveAllowedUrl('https://evil.example/x')).toBeNull();
    expect(resolveAllowedUrl('http://www.upwork.com/x')).toBeNull();
    expect(resolveAllowedUrl('http://[bad')).toBeNull();
  });
});

describe('attachment downloads (FR-15, D-15)', () => {
  const pdfBytes = new TextEncoder().encode('%PDF-1.4 tiny');
  const att = (over: Partial<{ fileName: string; uri: string | null; length: number | null }> = {}) => ({ fileName: 'brief.pdf', uri: '/att/download/1', length: 100, ...over });

  it('downloads an allowed file with the session token', async () => {
    const { client, guarded } = setup(() => new Response(pdfBytes, { status: 200 }), { session: 'session-token' });
    expect(await client.downloadAttachment(att())).toEqual(pdfBytes);
    expect(guarded.calls[0]?.headers.authorization).toBe('Bearer session-token');
  });

  it.each([
    ['an unsupported type', att({ fileName: 'notes.txt' }), 'not analysed'],
    ['a declared size over 10 MB', att({ length: 11 * 1024 * 1024 }), 'larger than 10 MB'],
    ['no download location', att({ uri: null }), 'no download location'],
    ['another host', att({ uri: 'https://files.example.net/a.pdf' }), 'may not contact'],
  ])('rejects %s without a request', async (_label, attachment, message) => {
    const { client, guarded } = setup(() => new Response(pdfBytes));
    await expect(client.downloadAttachment(attachment)).rejects.toThrow(message);
    expect(guarded.calls).toHaveLength(0);
  });

  it('rejects HTTP errors and failed connections', async () => {
    await expect(setup(() => new Response('', { status: 404 })).client.downloadAttachment(att())).rejects.toThrow('HTTP 404');
    await expect(setup(() => Promise.reject(new TypeError('x'))).client.downloadAttachment(att())).rejects.toBeInstanceOf(AttachError);
  });

  it('stops a download that grows past 10 MB, whatever the reported size', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        if (sent > 12) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const { client } = setup(() => new Response(stream, { status: 200 }));
    await expect(client.downloadAttachment(att({ length: 100 }))).rejects.toThrow('larger than 10 MB');
    expect(sent).toBeLessThanOrEqual(12);
  });

  it('rejects a Content-Length over 10 MB before reading', async () => {
    const { client } = setup(() => new Response(pdfBytes, { status: 200, headers: { 'content-length': String(20 * 1024 * 1024) } }));
    await expect(client.downloadAttachment(att())).rejects.toThrow('larger than 10 MB');
  });
});
