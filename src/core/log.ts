// The only place allowed to write to the console (NFR-08). Anything that looks like a bearer
// token or a long opaque secret is redacted before it is printed.

const SECRET_PATTERNS: RegExp[] = [
  /bearer\s+[\w\-.~+/=]+/gi,
  /\b(?:oauth2?|token|authorization)["']?\s*[:=]\s*["']?[\w\-.~+/=]{8,}/gi,
  /\b[\w-]{32,}\b/g,
];

export function redact(text: string): string {
  return SECRET_PATTERNS.reduce((out, pattern) => out.replace(pattern, '[redacted]'), text);
}

function format(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

export const log = {
  warn(...args: unknown[]): void {
    console.warn(`[checker] ${redact(format(args))}`);
  },
  error(...args: unknown[]): void {
    console.error(`[checker] ${redact(format(args))}`);
  },
};
