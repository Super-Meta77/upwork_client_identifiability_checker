// NFR-12: everything Upwork-specific (query, token, fetch, schema, mapper) lives in this module.

export { createUpworkClient, chromeUpworkDeps, type UpworkClient, type UpworkDeps } from './client';
export { createGate, upworkGate, type Gate } from './gate';
export { chromeTokenSource, isTokenShaped, type TokenSource } from './token';
export { readJobResponse, classifyGraphqlErrors } from './classify';

import { chromeTokenSource as makeTokenSource } from './token';

/** True when a token is set for this browser session. Never returns the token. */
export async function hasToken(): Promise<boolean> {
  return (await makeTokenSource().get()) !== null;
}

/** D-30: store the token the user pasted in Settings (session memory only, NFR-08). */
export function setToken(token: string): Promise<void> {
  return makeTokenSource().set(token);
}

/** D-30: forget the pasted token. */
export function clearToken(): Promise<void> {
  return makeTokenSource().clear();
}
