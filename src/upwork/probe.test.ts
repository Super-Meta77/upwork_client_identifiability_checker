import { describe, expect, it } from 'vitest';
import { createGuardedFetch, jsonResponse } from '../../test/fakes/fetch';
import { errorFixture, jobFixture } from '../../test/fixtures';
import { createGate } from './gate';
import { describeShape, FIELD_GROUPS, groupQuery, probeAttachment, probeFieldAccess, runProbe, type ProbeDeps } from './probe';
import type { TokenSource } from './token';

const SECRET = 'probe-secret-token-value';

function deps(cookie: string | null, handler = () => jsonResponse(jobFixture('synthetic-01-s1-company'))) {
  const guarded = createGuardedFetch(handler);
  const pauses: number[] = [];
  const tokens: TokenSource = {
    getSession: async () => null,
    setSession: async () => {},
    clearSession: async () => {},
    getManual: async () => null,
    setManual: async () => {},
    clearManual: async () => {},
    getCookie: async () => cookie,
    listCookieTokens: async () => (cookie ? [{ token: cookie, source: 'cookie oauth2_global_js_token' }] : []),
  };
  const d: ProbeDeps = { fetch: guarded.fetch, tokens, gate: createGate(), pause: async (ms) => void pauses.push(ms) };
  return { d, guarded, pauses };
}

describe('Phase 0 probe', () => {
  it('describes shapes without values', () => {
    const shape = describeShape({ a: { name: 'Acme Ltd', n: 3, list: [null, { x: true }], none: null } }, 'data');
    expect(shape).toEqual(['data.a.name: string(8)', 'data.a.n: number', 'data.a.list: array(2)', 'data.a.list[].x: boolean', 'data.a.none: null']);
    expect(shape.join()).not.toContain('Acme');
  });

  it('stops when no login token is found', async () => {
    const { d, guarded } = deps(null);
    const steps = await runProbe(['~01a'], d, () => {});
    expect(steps).toHaveLength(1);
    expect(steps[0]?.label).toContain('login tokens found: 0');
    expect(guarded.calls).toHaveLength(0);
  });

  it('runs 7 requests, 3 s apart, for one refused token, and never reports the token or field contents', async () => {
    const { d, guarded, pauses } = deps(SECRET, () => jsonResponse(errorFixture('permission')));
    const seen: string[] = [];
    const steps = await runProbe(['~01a', '~01b', '~01c', '~01d'], d, (s) => seen.push(s.label));
    expect(guarded.calls).toHaveLength(7);
    expect(pauses).toEqual(Array(6).fill(3000));
    expect(seen[0]).toContain('login tokens found');
    // steps[1] is the first request: the one candidate token, refused for scope.
    expect(steps[1]?.errors[0]).toMatchObject({ code: 'FORBIDDEN', path: 'jobAuthDetails' });
    expect(steps[1]?.note).toBe('REFUSED (scope)');
    expect(guarded.calls.find((c) => !c.headers.authorization)).toBeTruthy();
    expect(guarded.calls.some((c) => c.body?.includes('contractorNamee'))).toBe(true);
    expect(JSON.stringify(steps)).not.toContain(SECRET);
  });

  it('tries each login token and stops at the first one Upwork accepts', async () => {
    const guarded = createGuardedFetch((call) => (call.headers.authorization === 'Bearer good' ? jsonResponse(jobFixture('synthetic-01-s1-company')) : jsonResponse(errorFixture('permission'))));
    const pauses: number[] = [];
    const tokens: TokenSource = {
      getSession: async () => null,
      setSession: async () => {},
      clearSession: async () => {},
      getManual: async () => 'good',
      setManual: async () => {},
      clearManual: async () => {},
      getCookie: async () => 'scoped',
      listCookieTokens: async () => [{ token: 'scoped', source: 'cookie oauth2_global_js_token' }],
    };
    const d: ProbeDeps = { fetch: guarded.fetch, tokens, gate: createGate(), pause: async (ms) => void pauses.push(ms) };
    const steps = await runProbe(['~01a'], d, () => {});
    // tokens-found, then manual 'good' (ALLOWED); the scoped cookie is never reached.
    expect(steps[0]?.shape).toEqual(['1. manual entry (4 chars)', '2. cookie oauth2_global_js_token (6 chars)']);
    expect(steps[1]).toMatchObject({ label: 'token from manual entry', note: 'ALLOWED' });
    expect(guarded.calls.some((c) => c.headers.authorization === 'Bearer scoped')).toBe(false);
  });

  it('reports a non-JSON response with its title and Cloudflare clues, and a failed request', async () => {
    const page = '<html><head><title>Access denied</title></head></html>';
    const html = deps(SECRET, () => new Response(page, { status: 403, headers: { 'content-type': 'text/html', server: 'cloudflare' } }));
    const [, first] = await runProbe(['~01a'], html.d, () => {});
    expect(first).toMatchObject({ status: 403, contentType: 'text/html' });
    expect(first?.shape).toEqual([`non-JSON body (${page.length} chars)`, 'title: Access denied', 'server: cloudflare', 'cf-mitigated: (none)', 'cloudflare challenge script: no']);
    const failing = deps(SECRET, () => Promise.reject(new TypeError('offline')) as never);
    const [, failed] = await runProbe(['~01a'], failing.d, () => {});
    expect(failed).toMatchObject({ status: null, note: 'TypeError' });
  });

  it('probes each field group on its own and labels refused groups', async () => {
    const { d, guarded, pauses } = deps(SECRET, (call?: unknown) => {
      const body = (call as { body?: string } | undefined)?.body ?? '';
      return body.includes('stats') || body.includes('workHistory')
        ? jsonResponse(errorFixture('probe-2026-10-22-scope-aborted'))
        : jsonResponse({ data: { jobAuthDetails: { opening: { job: { info: { title: 'Secret title' } } } } } });
    });
    const steps = await probeFieldAccess('~01a', d, () => {});
    expect(guarded.calls).toHaveLength(FIELD_GROUPS.length + 1);
    expect(pauses).toEqual(Array(FIELD_GROUPS.length).fill(3000));
    expect(steps.map((s) => s.note).slice(0, FIELD_GROUPS.length)).toEqual(['ALLOWED', 'ALLOWED', 'ALLOWED', 'ALLOWED', 'REFUSED (scope)', 'ALLOWED', 'REFUSED (scope)']);
    expect(guarded.calls.at(-1)?.body).toContain('~01000000000000000000');
    expect(JSON.stringify(steps)).not.toContain('Secret title');
    expect(JSON.stringify(steps)).not.toContain(SECRET);
    expect(groupQuery('buyer { enterprise }')).toBe('query ProbeGroup($id: ID!) { jobAuthDetails(id: $id) { buyer { enterprise } } }');
  });

  it('field-access probe stops without a login token', async () => {
    const { d, guarded } = deps(null);
    expect((await probeFieldAccess('~01a', d, () => {}))[0]?.shape).toEqual(['no login token found']);
    expect(guarded.calls).toHaveLength(0);
  });

  it('probes one attachment on an allowed host only', async () => {
    const { d } = deps(SECRET, () => new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 1]), { status: 200, headers: { 'content-type': 'application/pdf' } }));
    expect(await probeAttachment('/att/download/1', d)).toMatchObject({ status: 200, shape: ['5 bytes', 'first bytes 25 50 44 46'] });
    expect((await probeAttachment('https://files.example.net/x.pdf', d)).shape[0]).toContain('files.example.net is not allowed');
  });
});
