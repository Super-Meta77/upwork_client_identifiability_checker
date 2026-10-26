import { beforeEach } from 'vitest';
import { createFakeChrome } from './fakes/chrome';

beforeEach(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = createFakeChrome();
});
