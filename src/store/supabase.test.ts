import { describe, expect, it } from 'vitest';
import { fakeChrome } from '../../test/fakes/chrome';
import { createDatabase, SESSION_KEY, supabaseConfig, type SupabaseConfig } from './supabase';

const CONFIG: SupabaseConfig = { url: 'https://abcd1234.supabase.co', anonKey: 'anon-key' };
const NOW = Date.parse('2026-10-25T09:00:00Z');

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const tokens = (access: string, refresh = `${access}-refresh`) => ({ access_token: access, refresh_token: refresh, expires_in: 3600, user: { id: 'user-1', email: 'me@example.com' } });

function setup(handler: (call: Call) => Response | Promise<Response>, config: SupabaseConfig | null = CONFIG) {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const call: Call = { url: String(input), method: init?.method ?? 'GET', headers, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null };
    calls.push(call);
    return handler(call);
  }) as typeof globalThis.fetch;
  const storage = fakeChrome().storage.local;
  const db = createDatabase({ config, fetch, storage, now: () => NOW, timeoutMs: 1000 });
  return { db, calls, storage };
}

const signedIn = async (storage: ReturnType<typeof setup>['storage'], expiresAt = NOW / 1000 + 3600) =>
  storage.set({ [SESSION_KEY]: { accessToken: 'old', refreshToken: 'old-refresh', expiresAt, userId: 'user-1', email: 'me@example.com' } });

describe('Supabase connection (D-32)', () => {
  it('accepts only a https://<project>.supabase.co URL with a key', () => {
    expect(supabaseConfig({ VITE_SUPABASE_URL: 'https://abcd1234.supabase.co/', VITE_SUPABASE_ANON_KEY: ' k ' })).toEqual({ url: 'https://abcd1234.supabase.co', anonKey: 'k' });
    expect(supabaseConfig({ VITE_SUPABASE_URL: 'https://abcd1234.supabase.co' })).toBeNull();
    expect(supabaseConfig({ VITE_SUPABASE_URL: 'http://abcd1234.supabase.co', VITE_SUPABASE_ANON_KEY: 'k' })).toBeNull();
    expect(supabaseConfig({ VITE_SUPABASE_URL: 'https://evil.example', VITE_SUPABASE_ANON_KEY: 'k' })).toBeNull();
  });

  it('signs in with email and password and keeps the session in local storage', async () => {
    const { db, calls, storage } = setup(() => json(tokens('access-1')));
    expect(await db.account()).toBeNull();
    expect(await db.signIn(' me@example.com ', 'secret')).toBeNull();
    expect(calls[0]).toMatchObject({ url: 'https://abcd1234.supabase.co/auth/v1/token?grant_type=password', method: 'POST', body: { email: 'me@example.com', password: 'secret' } });
    expect(calls[0]!.headers.apikey).toBe('anon-key');
    expect(await db.account()).toEqual({ userId: 'user-1', email: 'me@example.com' });
    expect(storage.dump()[SESSION_KEY]).toMatchObject({ accessToken: 'access-1', expiresAt: NOW / 1000 + 3600 });
  });

  it("shows Supabase's reason when sign-in fails", async () => {
    const { db } = setup(() => json({ error: 'invalid_grant', error_description: 'Invalid login credentials' }, 400));
    expect(await db.signIn('me@example.com', 'wrong')).toBe('Invalid login credentials');
    expect(await db.account()).toBeNull();
  });

  it('sends REST requests as the signed-in user', async () => {
    const { db, calls, storage } = setup((call) => (call.method === 'GET' ? json([{ job_id: '~01a' }]) : new Response(null, { status: 201 })));
    await signedIn(storage);
    expect(await db.rest('job_checks?select=job_id')).toEqual([{ job_id: '~01a' }]);
    expect(await db.rest('job_checks', { method: 'POST', body: [{ a: 1 }], prefer: 'return=minimal' })).toBeUndefined();
    expect(calls[0]).toMatchObject({ url: 'https://abcd1234.supabase.co/rest/v1/job_checks?select=job_id', headers: { apikey: 'anon-key', authorization: 'Bearer old' } });
    expect(calls[1]).toMatchObject({ method: 'POST', body: [{ a: 1 }], headers: { prefer: 'return=minimal' } });
  });

  it('refreshes an expiring session before the request, once for parallel requests', async () => {
    const { db, calls, storage } = setup((call) => (call.url.includes('grant_type=refresh_token') ? json(tokens('new')) : json([])));
    await signedIn(storage, NOW / 1000 + 30);
    await Promise.all([db.rest('job_checks'), db.rest('job_checks')]);
    expect(calls.filter((c) => c.url.includes('refresh_token'))).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ refresh_token: 'old-refresh' });
    expect(calls.filter((c) => c.url.includes('/rest/')).map((c) => c.headers.authorization)).toEqual(['Bearer new', 'Bearer new']);
  });

  it('refreshes and retries once when the database answers 401', async () => {
    let first = true;
    const { db, calls, storage } = setup((call) => {
      if (call.url.includes('refresh_token')) return json(tokens('new'));
      if (first) {
        first = false;
        return json({ message: 'JWT expired' }, 401);
      }
      return json([]);
    });
    await signedIn(storage);
    expect(await db.rest('job_checks')).toEqual([]);
    expect(calls.map((c) => c.headers.authorization ?? '')).toEqual(['Bearer old', '', 'Bearer new']);
  });

  it('signs out when the session cannot be refreshed', async () => {
    const { db, storage } = setup(() => json({ error_description: 'Invalid Refresh Token' }, 400));
    await signedIn(storage, NOW / 1000 - 10);
    await expect(db.rest('job_checks')).rejects.toMatchObject({ code: 'E-STORAGE', detail: 'signed out, sign in again in Settings' });
    expect(await db.account()).toBeNull();
  });

  it('reports errors, missing sign-in and lost connections as E-STORAGE', async () => {
    const signedOut = setup(() => json([]));
    await expect(signedOut.db.rest('job_checks')).rejects.toMatchObject({ code: 'E-STORAGE', detail: 'not signed in' });

    const failing = setup(() => json({ message: 'new row violates row-level security policy' }, 403));
    await signedIn(failing.storage);
    await expect(failing.db.rest('job_checks')).rejects.toMatchObject({ code: 'E-STORAGE', detail: 'HTTP 403: new row violates row-level security policy' });

    const offline = setup(() => Promise.reject(new TypeError('Failed to fetch')));
    await signedIn(offline.storage);
    await expect(offline.db.rest('job_checks')).rejects.toMatchObject({ code: 'E-STORAGE', detail: 'no connection' });
    // Being offline does not sign the user out.
    expect(await offline.db.account()).not.toBeNull();
  });

  it('works without a project only to say it is not set up', async () => {
    const { db, calls } = setup(() => json([]), null);
    expect(db.configured).toBe(false);
    expect(await db.signIn('a@b.c', 'p')).toBe('The results database is not set up.');
    await expect(db.rest('job_checks')).rejects.toMatchObject({ code: 'E-STORAGE' });
    expect(calls).toHaveLength(0);
  });

  it('signs out locally and at Supabase', async () => {
    const { db, calls, storage } = setup(() => new Response(null, { status: 204 }));
    await signedIn(storage);
    await db.signOut();
    expect(await db.account()).toBeNull();
    expect(calls[0]).toMatchObject({ url: 'https://abcd1234.supabase.co/auth/v1/logout', method: 'POST', headers: { authorization: 'Bearer old' } });
  });
});
