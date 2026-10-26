// D-32: the connection to the user's own Supabase project, which keeps the check history.
// The project URL and its public (anon) key come from .env.local at build time. The anon key reads
// nothing by itself: the table only lets a signed-in user see their own rows. The sign-in session is
// kept in chrome.storage.local and is never logged, exported or shown. Only this file may call
// fetch outside src/upwork, and only to the configured https://<project>.supabase.co (NFR-07).

import { CheckerError } from '../core/errors';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

/** The project from .env.local, or null when it is not set up. */
export function supabaseConfig(env: Record<string, unknown> = import.meta.env): SupabaseConfig | null {
  const url = String(env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const anonKey = String(env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  if (!anonKey || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) return null;
  return { url, anonKey };
}

export interface Account {
  userId: string;
  email: string;
}

interface Session extends Account {
  accessToken: string;
  refreshToken: string;
  /** Epoch seconds. */
  expiresAt: number;
}

export interface RestInit {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** PostgREST Prefer header, e.g. "resolution=merge-duplicates,return=minimal". */
  prefer?: string;
}

export interface Database {
  readonly configured: boolean;
  account(): Promise<Account | null>;
  /** Resolves with an error message for the user, or null when signed in. */
  signIn(email: string, password: string): Promise<string | null>;
  signOut(): Promise<void>;
  /** A request to `/rest/v1/<path>` as the signed-in user. Throws CheckerError E-STORAGE. */
  rest<T>(path: string, init?: RestInit): Promise<T>;
}

/** The part of chrome.storage.local the history code uses. */
export interface KeyValueStore {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface DatabaseDeps {
  config: SupabaseConfig | null;
  fetch: typeof fetch;
  storage: KeyValueStore;
  now: () => number;
  timeoutMs: number;
}

export const SESSION_KEY = 'supabaseSession';
/** Refresh the access token this long before it expires. */
const REFRESH_EARLY_S = 60;

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  user?: { id?: string; email?: string };
}

function errorText(body: unknown): string {
  const b = body as { error_description?: unknown; msg?: unknown; message?: unknown; error?: unknown } | null;
  const text = b?.error_description ?? b?.msg ?? b?.message ?? b?.error;
  return typeof text === 'string' ? text.slice(0, 160) : '';
}

export function createDatabase(deps: DatabaseDeps): Database {
  const { config } = deps;
  let refreshing: Promise<Session | null> | null = null;

  const call = async (path: string, init: RequestInit): Promise<Response> => {
    if (!config) throw new CheckerError('E-STORAGE', 'the database is not set up');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
    try {
      return await deps.fetch(`${config.url}${path}`, { ...init, redirect: 'error', signal: controller.signal });
    } catch {
      throw new CheckerError('E-STORAGE', 'no connection');
    } finally {
      clearTimeout(timer);
    }
  };

  const readSession = async (): Promise<Session | null> => {
    const value = (await deps.storage.get(SESSION_KEY))[SESSION_KEY] as Partial<Session> | undefined;
    return value?.accessToken && value.refreshToken && value.userId ? (value as Session) : null;
  };

  /** Signs in or refreshes; saves and returns the session, or an error message. */
  const token = async (grant: 'password' | 'refresh_token', body: object): Promise<Session | string> => {
    const response = await call(`/auth/v1/token?grant_type=${grant}`, {
      method: 'POST',
      headers: { apikey: config!.anonKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => null)) as TokenResponse | null;
    if (!response.ok || !data?.access_token || !data.refresh_token || !data.user?.id) {
      return errorText(data) || `sign-in failed (HTTP ${response.status})`;
    }
    const session: Session = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_at ?? Math.floor(deps.now() / 1000) + (data.expires_in ?? 3600),
      userId: data.user.id,
      email: data.user.email ?? '',
    };
    await deps.storage.set({ [SESSION_KEY]: session });
    return session;
  };

  /** One refresh at a time: Supabase refresh tokens can be used only once. */
  const refresh = (session: Session): Promise<Session | null> => {
    refreshing ??= token('refresh_token', { refresh_token: session.refreshToken })
      .then(async (result) => {
        if (typeof result !== 'string') return result;
        await deps.storage.remove(SESSION_KEY);
        return null;
      })
      .finally(() => (refreshing = null));
    return refreshing;
  };

  const validSession = async (): Promise<Session> => {
    const session = await readSession();
    if (!session) throw new CheckerError('E-STORAGE', 'not signed in');
    if (session.expiresAt - REFRESH_EARLY_S > deps.now() / 1000) return session;
    const fresh = await refresh(session);
    if (!fresh) throw new CheckerError('E-STORAGE', 'signed out, sign in again in Settings');
    return fresh;
  };

  return {
    configured: config !== null,

    async account() {
      const session = await readSession();
      return session ? { userId: session.userId, email: session.email } : null;
    },

    async signIn(email, password) {
      if (!config) return 'The results database is not set up.';
      try {
        const result = await token('password', { email: email.trim(), password });
        return typeof result === 'string' ? result : null;
      } catch (error) {
        return error instanceof CheckerError ? error.message : 'Sign-in failed.';
      }
    },

    async signOut() {
      const session = await readSession();
      await deps.storage.remove(SESSION_KEY);
      if (!session || !config) return;
      await call('/auth/v1/logout', { method: 'POST', headers: { apikey: config.anonKey, authorization: `Bearer ${session.accessToken}` } }).catch(() => undefined);
    },

    async rest<T>(path: string, init: RestInit = {}): Promise<T> {
      let session = await validSession();
      const send = (s: Session) =>
        call(`/rest/v1/${path}`, {
          method: init.method ?? 'GET',
          headers: {
            apikey: config!.anonKey,
            authorization: `Bearer ${s.accessToken}`,
            'content-type': 'application/json',
            ...(init.prefer ? { prefer: init.prefer } : {}),
          },
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        });
      let response = await send(session);
      if (response.status === 401) {
        // The access token was revoked or expired early: refresh once and retry.
        const fresh = await refresh(session);
        if (!fresh) throw new CheckerError('E-STORAGE', 'signed out, sign in again in Settings');
        session = fresh;
        response = await send(session);
      }
      const text = await response.text().catch(() => '');
      if (!response.ok) {
        let detail = '';
        try {
          detail = errorText(JSON.parse(text));
        } catch {
          // Not JSON; the status is enough.
        }
        throw new CheckerError('E-STORAGE', `HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
      }
      return (text ? JSON.parse(text) : undefined) as T;
    },
  };
}

let shared: Database | null = null;

/** The database the panel uses, built from .env.local. */
export function database(): Database {
  shared ??= createDatabase({
    config: supabaseConfig(),
    fetch: globalThis.fetch.bind(globalThis),
    storage: chrome.storage.local,
    now: () => Date.now(),
    timeoutMs: 20_000,
  });
  return shared;
}
