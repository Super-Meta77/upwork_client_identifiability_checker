// Loads saved Upwork responses. Job fixtures are invented; the error fixtures named probe-* are real
// error bodies Upwork returned on 2026-10-22.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export interface Fixture {
  name: string;
  body: unknown;
}

function load(folder: string): Fixture[] {
  const dir = join(here, folder);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ name: f.replace(/\.json$/, ''), body: JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown }));
}

export const jobFixtures = (): Fixture[] => load('jobs');
export const errorFixtures = (): Fixture[] => load('errors');

export function jobFixture(name: string): unknown {
  const found = jobFixtures().find((f) => f.name === name);
  if (!found) throw new Error(`no job fixture ${name}`);
  return found.body;
}

export function errorFixture(name: string): unknown {
  const found = errorFixtures().find((f) => f.name === name);
  if (!found) throw new Error(`no error fixture ${name}`);
  return found.body;
}
