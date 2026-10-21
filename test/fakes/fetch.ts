// A fetch stand-in that fails on any host outside the allowlist (NFR-07) and records how many
// requests were in flight at once (NFR-01).

export const ALLOWED_TEST_HOSTS = new Set(['www.upwork.com']);

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

export type FetchHandler = (call: RecordedCall, signal: AbortSignal | undefined) => Response | Promise<Response>;

export interface GuardedFetch {
  fetch: typeof fetch;
  calls: RecordedCall[];
  maxInFlight: () => number;
}

export function createGuardedFetch(handler: FetchHandler): GuardedFetch {
  const calls: RecordedCall[] = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const guarded = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (!ALLOWED_TEST_HOSTS.has(url.hostname)) {
      throw new Error(`NFR-07 violation: request to ${url.hostname}`);
    }
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const call: RecordedCall = {
      url: url.href,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : null,
    };
    calls.push(call);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      return await handler(call, init?.signal ?? undefined);
    } finally {
      inFlight -= 1;
    }
  }) as typeof fetch;

  return { fetch: guarded, calls, maxInFlight: () => maxInFlight };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export function htmlResponse(body: string, status: number): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html' } });
}
