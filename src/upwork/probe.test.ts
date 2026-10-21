import { describe, expect, it } from 'vitest';
import { createGuardedFetch, jsonResponse } from '../../test/fakes/fetch';
import { errorFixture, jobFixture } from '../../test/fixtures';
import { createGate } from './gate';
import { describeShape, probeAttachment, runProbe, type ProbeDeps } from './probe';
import type { TokenSource } from './token';

const SECRET = 'probe-secret-token-value';

function deps(cookie: string | null, handler = () => jsonResponse(jobFixture('synthetic-01-s1-company'))) {
  const guarded = createGuardedFetch(handler);
  const pauses: number[] = [];
  const tokens: TokenSource = { getSession: async () => null, setSession: async () => {}, clearSession: async () => {}, getCookie: async () => cookie };
  const d: ProbeDeps = { fetch: guarded.fetch, tokens, gate: createGate(), pause: async (ms) => void pauses.push(ms) };
  return { d, guarded, pauses };
}

describe('Phase 0 probe', () => {
  it('describes shapes without values', () => {
    const shape = describeShape({ a: { name: 'Acme Ltd', n: 3, list: [null, { x: true }], none: null } }, 'data');
    expect(shape).toEqual(['data.a.name: string(8)', 'data.a.n: number', 'data.a.list: array(2)', 'data.a.list[].x: boolean', 'data.a.none: null']);
    expect(shape.join()).not.toContain('Acme');
  });

  it('stops when the cookie is missing', async () => {
    const { d, guarded } = deps(null);
    const steps = await runProbe(['~01a'], d, () => {});
    expect(steps).toHaveLength(1);
    expect(steps[0]?.shape).toEqual(['missing']);
    expect(guarded.calls).toHaveLength(0);
  });

  it('runs at most 7 requests, 3 s apart, and never reports the token or field contents', async () => {
    const { d, guarded, pauses } = deps(SECRET, () => jsonResponse(errorFixture('permission')));
    const seen: string[] = [];
    const steps = await runProbe(['~01a', '~01b', '~01c', '~01d'], d, (s) => seen.push(s.label));
    expect(guarded.calls).toHaveLength(7);
    expect(pauses).toEqual(Array(6).fill(3000));
    expect(seen[0]).toContain('cookie');
    expect(steps[1]?.errors[0]).toMatchObject({ code: 'FORBIDDEN', path: 'jobAuthDetails' });
    expect(guarded.calls.find((c) => !c.headers.authorization)).toBeTruthy();
    expect(guarded.calls.some((c) => c.body?.includes('contractorNamee'))).toBe(true);
    expect(JSON.stringify(steps)).not.toContain(SECRET);
  });

  it('reports a non-JSON response and a failed request', async () => {
    const html = deps(SECRET, () => new Response('<html>', { status: 403, headers: { 'content-type': 'text/html' } }));
    const [, first] = await runProbe(['~01a'], html.d, () => {});
    expect(first).toMatchObject({ status: 403, contentType: 'text/html', shape: ['non-JSON body (6 chars)'] });
    const failing = deps(SECRET, () => Promise.reject(new TypeError('offline')) as never);
    const [, failed] = await runProbe(['~01a'], failing.d, () => {});
    expect(failed).toMatchObject({ status: null, note: 'TypeError' });
  });

  it('probes one attachment on an allowed host only', async () => {
    const { d } = deps(SECRET, () => new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 1]), { status: 200, headers: { 'content-type': 'application/pdf' } }));
    expect(await probeAttachment('/att/download/1', d)).toMatchObject({ status: 200, shape: ['5 bytes', 'first bytes 25 50 44 46'] });
    expect((await probeAttachment('https://files.example.net/x.pdf', d)).shape[0]).toContain('files.example.net is not allowed');
  });
});
