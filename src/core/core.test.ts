import { describe, expect, it } from 'vitest';
import { CheckerError, errorMessage } from './errors';
import { newId } from './ids';

describe('errors', () => {
  it('has a message for every code', () => {
    for (const code of ['E-AUTH', 'E-SCOPE', 'E-NOTFOUND', 'E-RATE', 'E-FORMAT', 'E-NETWORK', 'E-STORAGE', 'E-BLOCKED'] as const) {
      expect(errorMessage(code).length).toBeGreaterThan(10);
    }
    expect(errorMessage('E-RATE', '5')).toBe('Upwork is limiting requests. Paused for 5 minutes.');
    expect(errorMessage('E-FORMAT', 'opening.job')).toContain('(field: opening.job)');
  });

  it('carries codes and details', () => {
    expect(new CheckerError('E-NETWORK', 'HTTP 502', { serverError: true })).toMatchObject({ code: 'E-NETWORK', detail: 'HTTP 502', serverError: true });
    expect(newId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
