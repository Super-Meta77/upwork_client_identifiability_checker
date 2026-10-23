// NFR-12: everything Upwork-specific (query, token, fetch, schema, mapper) lives in this module.

export { createUpworkClient, chromeUpworkDeps, type UpworkClient, type UpworkDeps } from './client';
export { createGate, upworkGate, type Gate } from './gate';
export { chromeTokenSource, isTokenShaped, loginSourceLabel, type TokenSource } from './token';

import { chromeTokenSource as makeTokenSource, loginSourceLabel } from './token';

/** The current login source (e.g. "manual entry", "cookie UniversalSearchNuxt_vt"), or null. Never the token. */
export function getLoginStatus(): Promise<string | null> {
  return loginSourceLabel(makeTokenSource());
}

/** D-30: store the token the user pasted in Settings (session memory only, NFR-08). */
export function setManualToken(token: string): Promise<void> {
  return makeTokenSource().setManual(token);
}

/** D-30: forget the manually entered token. */
export function clearManualToken(): Promise<void> {
  return makeTokenSource().clearManual();
}
export { readJobResponse, classifyGraphqlErrors } from './classify';
