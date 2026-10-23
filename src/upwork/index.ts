// NFR-12: everything Upwork-specific (query, token, fetch, schema, mapper) lives in this module.

export { createUpworkClient, chromeUpworkDeps, type UpworkClient, type UpworkDeps } from './client';
export { createGate, upworkGate, type Gate } from './gate';
export { chromeTokenSource, loginSourceLabel, type TokenSource } from './token';

import { chromeTokenSource as makeTokenSource, loginSourceLabel } from './token';

/** The current login source (e.g. "cookie UniversalSearchNuxt_vt"), or null. Never the token. */
export function getLoginStatus(): Promise<string | null> {
  return loginSourceLabel(makeTokenSource());
}
export { readJobResponse, classifyGraphqlErrors } from './classify';
