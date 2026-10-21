// NFR-12: everything Upwork-specific (query, token, fetch, schema, mapper) lives in this module.

export { createUpworkClient, chromeUpworkDeps, type UpworkClient, type UpworkDeps } from './client';
export { createGate, upworkGate, type Gate } from './gate';
export { chromeTokenSource, type TokenSource } from './token';
export { readJobResponse, classifyGraphqlErrors } from './classify';
