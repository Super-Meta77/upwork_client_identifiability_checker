import { describe, expect, it, vi } from 'vitest';
import { AttachError, CheckerError, errorMessage } from './errors';
import { newId } from './ids';
import { log, redact } from './log';

describe('log redaction (NFR-08)', () => {
  it('removes bearer tokens and long secrets', () => {
    expect(redact('Authorization: Bearer abc.def-123')).not.toContain('abc.def-123');
    expect(redact('token=eyJhbGciOiJIUzI1NiJ9xyz')).not.toContain('eyJhbGciOiJIUzI1NiJ9xyz');
    expect(redact('cookie 0123456789abcdef0123456789abcdef01 end')).toBe('cookie [redacted] end');
    expect(redact('Job ~01abc failed')).toBe('Job ~01abc failed');
  });

  it('redacts everything it prints', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    log.warn('request failed', { authorization: 'Bearer SECRETSECRETSECRET' });
    log.error(new Error('Bearer SECRETSECRETSECRET'));
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    log.warn(circular);
    const printed = [...warn.mock.calls, ...error.mock.calls].flat().join(' ');
    expect(printed).not.toContain('SECRETSECRETSECRET');
    expect(printed).toContain('[checker]');
  });
});

describe('errors', () => {
  it('has a message for every code', () => {
    for (const code of ['E-LINK', 'E-AUTH', 'E-SCOPE', 'E-NOTFOUND', 'E-RATE', 'E-FORMAT', 'E-ATTACH', 'E-NETWORK', 'E-STORAGE', 'E-BLOCKED'] as const) {
      expect(errorMessage(code).length).toBeGreaterThan(10);
    }
    expect(errorMessage('E-RATE', '5')).toBe('Upwork is limiting requests. Paused for 5 minutes.');
    expect(errorMessage('E-FORMAT', 'opening.job')).toContain('(field: opening.job)');
  });

  it('carries codes and details', () => {
    expect(new CheckerError('E-NETWORK', 'HTTP 502', { serverError: true })).toMatchObject({ code: 'E-NETWORK', detail: 'HTTP 502', serverError: true });
    expect(new AttachError('a.pdf', 'too big')).toMatchObject({ fileName: 'a.pdf', reason: 'too big', message: 'a.pdf: too big' });
    expect(newId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
